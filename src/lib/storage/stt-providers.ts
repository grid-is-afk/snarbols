import { STORAGE_KEYS } from "@/config";
import { TYPE_PROVIDER } from "@/types";
import { decryptValue, encryptValue } from "@/lib/storage/secure-vault";

export async function getCustomSttProviders(): Promise<TYPE_PROVIDER[]> {
  try {
    if (typeof window === "undefined") return [];
    const saved = localStorage.getItem(STORAGE_KEYS.CUSTOM_SPEECH_PROVIDERS);
    if (!saved) return [];
    const decrypted = await decryptValue(saved);
    const parsed = JSON.parse(decrypted);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p: any) => p.id && p.isCustom);
  } catch (error) {
    // Log only the error name: this runs downstream of decrypt, so a
    // decrypt/JSON.parse error message can embed a fragment of the secret.
    console.error(
      "Error retrieving custom STT providers:",
      error instanceof Error ? error.name : "unknown error"
    );
    return [];
  }
}

/**
 * Persist the custom STT providers, encrypting at rest. Returns `true` only when
 * the write actually succeeded — callers MUST NOT treat a failed persist as a
 * successful save (that would silently drop a user's API key).
 */
export async function setCustomSttProviders(
  providers: TYPE_PROVIDER[]
): Promise<boolean> {
  try {
    if (typeof window === "undefined") return false;
    const encrypted = await encryptValue(JSON.stringify(providers));
    localStorage.setItem(STORAGE_KEYS.CUSTOM_SPEECH_PROVIDERS, encrypted);
    return true;
  } catch (error) {
    console.error(
      "Error setting custom STT providers:",
      error instanceof Error ? error.name : "unknown error"
    );
    return false;
  }
}

export async function addCustomSttProvider(
  newProvider: Omit<TYPE_PROVIDER, "id" | "isCustom">
): Promise<TYPE_PROVIDER | null> {
  try {
    const providers = await getCustomSttProviders();
    const id = `custom-stt-${Date.now()}`;
    const provider: TYPE_PROVIDER = {
      ...newProvider,
      id,
      isCustom: true,
    };
    providers.push(provider);
    const persisted = await setCustomSttProviders(providers);
    if (!persisted) return null; // save failed — signal, don't fake success
    return provider;
  } catch (error) {
    console.error(
      "Error adding custom STT provider:",
      error instanceof Error ? error.name : "unknown error"
    );
    return null;
  }
}

export async function updateCustomSttProvider(
  id: string,
  updates: Partial<TYPE_PROVIDER>
): Promise<boolean> {
  try {
    const providers = await getCustomSttProviders();
    const index = providers.findIndex((p) => p.id === id && p.isCustom);
    if (index === -1) return false;
    providers[index] = { ...providers[index], ...updates };
    return await setCustomSttProviders(providers);
  } catch (error) {
    console.error(
      "Error updating custom STT provider:",
      error instanceof Error ? error.name : "unknown error"
    );
    return false;
  }
}

export async function removeCustomSttProvider(id: string): Promise<boolean> {
  try {
    const providers = await getCustomSttProviders();
    const filtered = providers.filter((p) => p.id !== id);
    if (filtered.length === providers.length) return false;
    return await setCustomSttProviders(filtered);
  } catch (error) {
    console.error(
      "Error removing custom STT provider:",
      error instanceof Error ? error.name : "unknown error"
    );
    return false;
  }
}
