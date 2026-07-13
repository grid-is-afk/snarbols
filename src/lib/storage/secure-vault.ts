import { getItem, saveItem } from "tauri-plugin-keychain";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { safeLocalStorage } from "@/lib/storage/helper";

/**
 * Encryption-at-rest vault for Snarbols' BYO API keys.
 *
 * Secret-bearing values (custom provider curls + selected-provider variable
 * maps) are AES-GCM encrypted with a 256-bit master key that lives in the OS
 * keychain (via `tauri-plugin-keychain`). Ciphertext is persisted in
 * localStorage in place of the old plaintext.
 *
 * Design notes:
 * - The master key never touches localStorage; only the OS keychain holds it.
 * - `decryptValue` is a passthrough for any value lacking the `enc:v1:` prefix,
 *   so legacy plaintext keeps working until migration re-encrypts it.
 * - When the OS keychain is unavailable (e.g. a Linux box with no secret
 *   service), the vault degrades to PASSTHROUGH mode: `encryptValue` returns
 *   plaintext unchanged and the app never blocks. A non-blocking UI banner
 *   surfaces this to the user.
 * - Dev fallback: outside the Tauri runtime (`npm run dev` / browser) the
 *   keychain does not exist, so a fixed, clearly-insecure dev key is used. This
 *   lets the full crypto + migration path be exercised in the browser. It is
 *   NEVER reachable in a real Tauri build.
 */

/** localStorage/keychain marker for AES-GCM v1 blobs. */
export const ENC_PREFIX = "enc:v1:";

/** Keychain identifier for the vault master key. */
const MASTER_KEY_ID = "snarbols.vault.masterKey.v1";

/**
 * Window label allowed to CREATE the master key and run migration. Only this
 * window may generate the key; every other window reads the existing key to
 * decrypt for display and never creates a competing one (see
 * `loadOrCreateMasterKeyBytes`).
 *
 * `main` is the config-defined primary window (src-tauri/tauri.conf.json) and is
 * created unconditionally at startup (`setup_main_window(...).expect(...)` in
 * window.rs), so it always exists as the single deterministic owner. The
 * `dashboard` window (and any other window mounting AppProvider) is a reader;
 * `capture-overlay-*` windows never mount the vault at all.
 */
const VAULT_OWNER_WINDOW_LABEL = "main";

/** AES-GCM recommended IV length in bytes. */
const IV_BYTES = 12;

/** AES key length in bytes (256-bit). */
const KEY_BYTES = 32;

/**
 * DEV-ONLY, clearly-insecure master key seed (exactly 32 ASCII chars → 32
 * bytes). Used solely outside the Tauri runtime so the crypto/migration logic
 * runs in the browser during `npm run dev`. NEVER used in a Tauri build.
 */
const DEV_FALLBACK_SEED = "snarbols.dev.insecure.master.key";

/** True when running inside the Tauri v2 runtime (keychain invoke transport present). */
const isTauriRuntime = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// -- binary/base64 helpers ---------------------------------------------------

/** Encode raw bytes to base64 without corrupting binary (chunked to avoid arg limits). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/** Decode base64 back to raw bytes. */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// -- window ownership --------------------------------------------------------

/**
 * Thrown when a non-owner window asks for the master key before the owner window
 * has created it. Distinct from a genuine keychain failure: it means "not yet",
 * not "never" — so the availability probe treats it as transient and does NOT
 * latch the vault into passthrough mode.
 */
class MasterKeyNotReadyError extends Error {
  constructor() {
    super(
      "[secure-vault] master key not yet created by the owner window; retry shortly"
    );
    this.name = "MasterKeyNotReadyError";
  }
}

/**
 * True when THIS window is the single window permitted to CREATE the master key
 * and run migration. Outside the Tauri runtime (dev/browser) there is only one
 * JS context, so it is always the owner. If the label can't be resolved we
 * conservatively return `false`, so two windows can never both claim ownership
 * and generate divergent keys (permanent key loss) — the worst case is then a
 * benign wait, not data loss.
 */
export function isVaultOwnerWindow(): boolean {
  if (!isTauriRuntime()) return true;
  try {
    return getCurrentWindow().label === VAULT_OWNER_WINDOW_LABEL;
  } catch {
    return false;
  }
}

// -- master key --------------------------------------------------------------

let cachedKey: CryptoKey | null = null;
let keyPromise: Promise<CryptoKey> | null = null;

/** Bounded poll for a master key created by the owner window (~2s budget). */
async function waitForMasterKeyBytes(): Promise<Uint8Array> {
  const maxAttempts = 20;
  const delayMs = 100;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rawB64 = await getItem(MASTER_KEY_ID);
    if (rawB64) return base64ToBytes(rawB64);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new MasterKeyNotReadyError();
}

/**
 * Read or create the raw master-key bytes.
 *
 * Concurrency contract (never lose a user's key):
 *  - Dev/browser: fixed insecure seed (crypto path still exercised).
 *  - If a key already exists in the keychain, adopt it verbatim.
 *  - If none exists yet, ONLY the owner window creates one; every other window
 *    polls briefly and adopts whatever the owner persists — never creating a
 *    competing key. This prevents two windows generating divergent keys and
 *    orphaning blobs encrypted under the loser.
 *  - After the owner writes, it reads the value BACK and adopts the persisted
 *    bytes as authoritative, so even a racing concurrent write converges on a
 *    single key rather than leaving two windows on divergent in-memory keys.
 */
async function loadOrCreateMasterKeyBytes(): Promise<Uint8Array> {
  if (!isTauriRuntime()) {
    // DEV ONLY — see DEV_FALLBACK_SEED. Not reachable in a Tauri build.
    return new TextEncoder().encode(DEV_FALLBACK_SEED);
  }

  const existing = await getItem(MASTER_KEY_ID);
  if (existing) return base64ToBytes(existing);

  // No key yet. Non-owner windows must NOT create one — wait for the owner.
  if (!isVaultOwnerWindow()) {
    return waitForMasterKeyBytes();
  }

  // Owner: generate, persist, then read the STORED value back and adopt it as
  // the authoritative key (belt-and-suspenders convergence under a race).
  const bytes = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  const rawB64 = bytesToBase64(bytes);
  await saveItem(MASTER_KEY_ID, rawB64);

  const readBack = await getItem(MASTER_KEY_ID);
  if (!readBack) {
    // Write did not persist (keychain denied/full). Refuse to use an
    // unpersisted in-memory key — that would orphan every blob next launch.
    throw new Error(
      "[secure-vault] master key failed to persist to the OS keychain"
    );
  }
  return base64ToBytes(readBack);
}

/**
 * Get-or-create the AES-GCM master CryptoKey, cached for the session.
 * Concurrent callers share a single in-flight creation via `keyPromise`.
 */
export async function getMasterKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  if (!keyPromise) {
    keyPromise = (async () => {
      const keyBytes = await loadOrCreateMasterKeyBytes();
      return crypto.subtle.importKey(
        "raw",
        keyBytes,
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"]
      );
    })();
  }
  try {
    cachedKey = await keyPromise;
    return cachedKey;
  } catch (error) {
    // Allow a later retry rather than caching a rejected promise forever.
    keyPromise = null;
    throw error;
  }
}

// -- availability probe ------------------------------------------------------

let vaultAvailableCache: boolean | null = null;

/**
 * Probe (cached) whether the vault can ACTUALLY protect and recover data.
 *
 * Rather than testing an arbitrary keychain slot, this exercises the real master
 * key end to end: obtain it (creating it in the owner window) and round-trip a
 * probe value through AES-GCM. Availability therefore means "we can decrypt our
 * own data", not merely "some keychain slot is writable" — so a missing or
 * denied master key correctly flips the app into passthrough mode instead of
 * reporting available while every `enc:v1:` decrypt silently fails.
 *
 * In dev-fallback mode this is always true. A transient "owner hasn't created
 * the key yet" state (non-owner window at cold start) is reported as
 * temporarily unavailable but is NOT cached, so it re-probes once the owner
 * catches up.
 */
export async function isVaultAvailable(): Promise<boolean> {
  if (vaultAvailableCache !== null) return vaultAvailableCache;

  if (!isTauriRuntime()) {
    vaultAvailableCache = true;
    return vaultAvailableCache;
  }

  try {
    const key = await getMasterKey();
    const probe = `probe-${Date.now()}`;
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(probe)
    );
    const roundTripped = new TextDecoder().decode(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext)
    );
    vaultAvailableCache = roundTripped === probe;
  } catch (error) {
    if (error instanceof MasterKeyNotReadyError) {
      // Transient: the owner window hasn't created the key yet. Don't latch
      // into passthrough — report unavailable for now and re-probe next call.
      return false;
    }
    console.warn(
      "[secure-vault] OS keychain / master key unavailable — running in passthrough mode:",
      error instanceof Error ? error.name : "unknown error"
    );
    vaultAvailableCache = false;
  }
  return vaultAvailableCache;
}

// -- encrypt / decrypt -------------------------------------------------------

/**
 * Encrypt a plaintext string. Returns `enc:v1:<base64(iv ++ ciphertext)>`.
 * In passthrough mode (keychain unavailable) returns the plaintext unchanged so
 * the app keeps working with unencrypted values.
 */
export async function encryptValue(plaintext: string): Promise<string> {
  if (!(await isVaultAvailable())) {
    return plaintext; // passthrough — no keychain to protect the master key
  }

  const key = await getMasterKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plaintext)
    )
  );

  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv, 0);
  combined.set(ciphertext, iv.length);
  return ENC_PREFIX + bytesToBase64(combined);
}

/**
 * Decrypt a stored value. Values without the `enc:v1:` prefix (legacy plaintext)
 * are returned unchanged. Throws if a prefixed value cannot be decrypted so
 * callers can decide how to degrade — the stored ciphertext is never mutated.
 */
export async function decryptValue(stored: string): Promise<string> {
  if (!stored.startsWith(ENC_PREFIX)) {
    return stored; // plaintext / legacy passthrough
  }

  const combined = base64ToBytes(stored.slice(ENC_PREFIX.length));
  const iv = combined.subarray(0, IV_BYTES);
  const ciphertext = combined.subarray(IV_BYTES);
  const key = await getMasterKey();
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );
  return new TextDecoder().decode(plaintext);
}

// -- migration ---------------------------------------------------------------

/**
 * Idempotently migrate the given localStorage keys from plaintext to encrypted.
 *
 * Safety contract (never lose a user's key):
 *   1. Skip keys that are absent or already encrypted.
 *   2. Verify the encrypt→decrypt round-trip IN MEMORY before touching the
 *      stored plaintext.
 *   3. Only then persist the ciphertext, read it back, and re-verify the stored
 *      copy. If persistence fails verification, restore the plaintext.
 *   4. On ANY error, leave the plaintext in place and retry on next launch.
 *
 * A no-op in passthrough mode (nothing to migrate without a keychain).
 */
export async function migrateSecretsToVault(keys: string[]): Promise<void> {
  if (!(await isVaultAvailable())) return;

  for (const key of keys) {
    try {
      const raw = safeLocalStorage.getItem(key);
      if (!raw || raw.startsWith(ENC_PREFIX)) continue; // absent or already migrated

      const ciphertext = await encryptValue(raw);
      // Guard: if the vault flipped to passthrough mid-run, don't "migrate".
      if (!ciphertext.startsWith(ENC_PREFIX)) continue;

      // 1) Verify round-trip before overwriting the plaintext (HARD RULE).
      const memoryCheck = await decryptValue(ciphertext);
      if (memoryCheck !== raw) {
        console.warn(
          `[secure-vault] migration verify failed for "${key}" (in-memory round-trip mismatch); leaving plaintext in place`
        );
        continue;
      }

      // 2) Persist, then confirm the STORED bytes are EXACTLY our ciphertext.
      //    Comparing against the ciphertext (not merely "decrypts back to raw")
      //    catches a swallowed QuotaExceededError: on quota failure the write is
      //    a silent no-op, localStorage still holds the plaintext, and a
      //    "decrypts to raw" check would falsely pass (plaintext decrypts to
      //    itself) — looping invisibly every launch. An exact match can't be
      //    fooled that way.
      safeLocalStorage.setItem(key, ciphertext);
      const readBack = safeLocalStorage.getItem(key);
      if (readBack !== ciphertext) {
        // Write did not take (most likely localStorage quota exceeded). The
        // original plaintext is still present; ensure it, then surface this
        // distinctly instead of pretending the migration succeeded.
        if (readBack !== raw) safeLocalStorage.setItem(key, raw);
        console.error(
          `[secure-vault] migration persist FAILED for "${key}" — stored value does not match ciphertext (likely localStorage quota exceeded); plaintext preserved, will retry next launch`
        );
        continue;
      }

      // 3) Belt-and-suspenders: the stored ciphertext must still round-trip.
      if ((await decryptValue(readBack)) !== raw) {
        safeLocalStorage.setItem(key, raw); // restore — never lose the key
        console.warn(
          `[secure-vault] migration round-trip verify failed for "${key}"; restored plaintext`
        );
        continue;
      }
    } catch (error) {
      console.warn(
        `[secure-vault] migration error for "${key}"; leaving plaintext in place (will retry next launch)`,
        error
      );
    }
  }
}
