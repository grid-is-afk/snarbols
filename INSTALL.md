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

## macOS

File: `Snarbols_<version>_aarch64.dmg` (Apple Silicon) or the `x64` dmg (Intel).

1. Open the `.dmg` and drag **Snarbols** into **Applications**.
2. **Do not** double-click it the first time — macOS will say it "cannot be opened because the
   developer cannot be verified" (or "is damaged").
3. Instead: open **Applications**, **right-click** Snarbols → **Open** → **Open** again in the dialog.
   (Right-click → Open only needs to be done once; afterwards it launches normally.)

If right-click → Open still refuses (newer macOS can be stricter), run this in **Terminal** once:

```bash
xattr -dr com.apple.quarantine /Applications/Snarbols.app
```

Then open the app normally.

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
