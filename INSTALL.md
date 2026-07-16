# Installing Snarbols

Snarbols is distributed as **unsigned** installers (no paid code-signing certificate yet), so
Windows and macOS will show a security warning the first time you open it. This is expected —
the steps below get you past it. The app is safe; the warning only means the OS can't verify a
signing certificate.

Download the installer for your platform from the private repo's
**Releases** page, then follow the matching section.

---

## Windows

Files: `Snarbols_<version>_x64-setup.exe` (recommended) or `Snarbols_<version>_x64_en-US.msi`.

1. Double-click the installer.
2. Windows SmartScreen shows **"Windows protected your PC."**
3. Click **More info**.
4. Click **Run anyway**.
5. Finish the installer.

> If **Run anyway** doesn't appear, right-click the file → **Properties** → check **Unblock** at
> the bottom → **OK**, then re-run.

---

## macOS  (Apple Silicon only — M1/M2/M3/M4)

File: `Snarbols_<version>_aarch64.dmg`. **There is no Intel (x86) macOS build yet** — if your Mac
is Intel-based, tell the person who sent you this; the app won't run.

1. Open the `.dmg` and drag **Snarbols** into **Applications**.
2. macOS will say **"Snarbols is damaged and can't be opened"** (or "developer cannot be verified").
   The app is **not** damaged — this is just macOS blocking an app that isn't signed with a paid
   Apple certificate yet.
3. **The fix (required for the "damaged" message — right-click → Open does NOT work for this one):**
   open **Terminal** (Applications → Utilities → Terminal) and run:
   ```bash
   xattr -dr com.apple.quarantine /Applications/Snarbols.app
   ```
   (If you put Snarbols somewhere other than Applications, drag the app onto the Terminal window
   after typing `xattr -dr com.apple.quarantine ` to fill in the correct path.)
4. Now open Snarbols normally (double-click). It launches from here on.

---

## Linux

Files: `Snarbols_<version>_amd64.AppImage`, `Snarbols_<version>_amd64.deb`, or
`Snarbols-<version>-1.x86_64.rpm`.

- **AppImage:** make it executable, then run it.
  ```bash
  chmod +x Snarbols_<version>_amd64.AppImage
  ./Snarbols_<version>_amd64.AppImage
  ```
- **Debian/Ubuntu:** `sudo dpkg -i Snarbols_<version>_amd64.deb` (or `sudo apt install ./<file>.deb`).
- **Fedora/RHEL:** `sudo rpm -i Snarbols-<version>-1.x86_64.rpm` (or `sudo dnf install ./<file>.rpm`).

> Encrypted API-key storage on Linux uses the OS secret service (GNOME Keyring / KWallet). On a
> minimal desktop without one, Snarbols still runs but stores keys unencrypted and shows a banner
> saying so.

---

## First run — add your API keys

Snarbols is **bring-your-own-key**. Nothing is sent to any Snarbols/Pluely server; your keys go
directly to the providers you configure and are stored encrypted at rest in your OS keychain.

1. Open **Settings** (or the dashboard) → add an AI provider.
2. Built-in providers include **OpenAI, Anthropic (Claude), Gemini, Groq**. Pick one and paste your
   API key.
3. For voice, add a **Speech-to-Text** provider (e.g. **Deepgram**, OpenAI/Groq Whisper, ElevenLabs,
   Google, Azure) and paste that key.

That's it — no account, no license, nothing to buy.

---

## Updating to a new version

There is **no auto-update**. To update, download the newer installer from the Releases page and
install it over the top (same steps as above). Your settings and API keys are preserved.
