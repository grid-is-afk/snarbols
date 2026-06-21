# Security hardening — proposed changes (NEEDS RUNTIME VERIFICATION)

This branch (`feat/security-tauri-hardening`) collects security fixes that touch
the Tauri/Rust layer. **It is intentionally not merged to `master`** because they
cannot be built or smoke-tested without the Rust toolchain (`cargo` / `tauri`),
which was unavailable in the environment where these were authored.

Verify each item with a real build + manual smoke test before merging:

```bash
npm install
npm run tauri dev     # smoke test the running app
npm run tauri build   # confirm release build succeeds
```

---

## 1. Applied on this branch (config only) — needs runtime confirmation

### `http` capability scoped to TLS + localhost
`src-tauri/capabilities/{cross-platform,default}.json`

Before: `http://**` + `https://**` (any plaintext host, anywhere).
After: `https://**`, `http://localhost:*`, `http://127.0.0.1:*`.

This keeps local self-hosted models (Ollama, LM Studio, etc.) working over
`http://localhost` while disallowing arbitrary plaintext requests to remote
hosts. **Confirm** your STT/LLM providers still reach their endpoints after this.

---

## 2. NOT yet applied — recommended, higher risk, must be done with the toolchain

### 2a. Enable a Content-Security-Policy (currently `null`)
`src-tauri/tauri.conf.json` → `app.security.csp` is `null`, which disables CSP
entirely. Candidate policy (TIGHTEN/TEST — a wrong value will break IPC/assets):

```jsonc
"security": {
  "csp": "default-src 'self'; img-src 'self' data: blob: asset: https://asset.localhost; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; media-src 'self' blob: data:; connect-src 'self' ipc: http://ipc.localhost https: http://localhost:* http://127.0.0.1:*"
}
```

Notes / things to verify when testing:
- `ipc:` + `http://ipc.localhost` and `asset:`/`https://asset.localhost` are
  required for Tauri IPC and the asset protocol — omitting them bricks the app.
- `style-src 'unsafe-inline'` is needed because Tailwind/shadcn inject inline
  styles. `script-src` stays `'self'` (no inline scripts).
- `connect-src https:` is deliberately broad: the app calls arbitrary
  user-configured LLM/STT endpoints. Narrow it only if you enumerate providers.
- Confirm PostHog analytics, the updater endpoint (`https://pluely.com`), and
  license activation still work under the policy.

### 2b. Store secrets in the OS keychain, not plaintext JSON
`src-tauri/src/activate.rs` — `secure_storage_save/get/remove` currently
`serde_json::to_string` + `fs::write` the license key and instance id to
`app_data_dir/secure_storage.json` **in plaintext**, despite the "secure" name.
`src-tauri/src/api.rs` reads the same file.

The `tauri-plugin-keychain` plugin is already initialized (`lib.rs`) and its
permissions are already granted in both capability files
(`keychain:allow-save-item` / `-get-item` / `-remove-item`). Route the three
`secure_storage_*` commands through the keychain instead of the JSON file
(keep a one-time migration that imports any existing `secure_storage.json` then
deletes it). This is the highest-impact fix and the most on-brand for a
"privacy-first" app — but it is a Rust change and must compile + be tested.

### 2c. Don't log secrets
`src-tauri/src/lib.rs` / `activate.rs` — audit `eprintln!`/`println!` around
activation and requests; mask any license key in logs (`key[..4] + "****"`).

---

## Already shipped to `master` (frontend, build-verified)
- Reject non-`http(s)` URLs in custom-provider cURL (`src/lib/curl-validator.ts`).
