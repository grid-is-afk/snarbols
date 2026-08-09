# Code signing

Everything that can be fixed without paying for a certificate has been fixed. What remains is the
security prompt itself: **Windows SmartScreen** and **macOS Gatekeeper**. Both require a purchased
certificate, and neither can be worked around from the code.

The CI is already wired for both. Adding the secrets below is the only step — no code changes.

## Current state

| | Now | With a certificate |
|---|---|---|
| Windows | SmartScreen "Windows protected your PC" → More info → Run anyway | Installs with no prompt |
| macOS | "Developer cannot be verified" → `xattr -dr com.apple.quarantine` | Opens by double-click |
| macOS architecture | Universal — Apple Silicon **and** Intel | unchanged |
| macOS signature | Ad-hoc (`-`), applied automatically in CI | Developer ID + notarised |

The ad-hoc signature matters even without a certificate: macOS refuses to run an **unsigned**
arm64 binary outright, reporting it as damaged. Ad-hoc signing is what reduces that to the normal
Gatekeeper prompt, which the documented `xattr` command clears.

## macOS — Apple Developer ID

Cost: **$99/year** (Apple Developer Program). This removes the prompt entirely and enables
notarisation.

1. Enrol at <https://developer.apple.com/programs/>.
2. In Xcode or the developer portal, create a **Developer ID Application** certificate.
3. Export it as a `.p12` with a password.
4. Base64-encode it: `base64 -i certificate.p12 | pbcopy`
5. Create an **app-specific password** at <https://appleid.apple.com> for notarisation.
6. Add these repository secrets:

| Secret | Value |
|---|---|
| `APPLE_CERTIFICATE` | base64 of the `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | the `.p12` password |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | your Apple ID email |
| `APPLE_PASSWORD` | the app-specific password |
| `APPLE_TEAM_ID` | your 10-character team id |

`release.yml` already passes all six to `tauri-action`. `APPLE_SIGNING_IDENTITY` falls back to `-`
when unset, so setting it is what switches the build from ad-hoc to real signing.

## Windows — Authenticode

Two routes:

**Azure Trusted Signing** — roughly **$10/month**, no hardware token, and available to individuals
after an identity check. This is the cheaper and simpler option. It needs a `signCommand` entry
under `bundle.windows` in `tauri.conf.json` plus Azure credentials as secrets.

**Traditional OV/EV certificate** — roughly **$200–600/year** from a CA (DigiCert, Sectigo).
EV certificates ship on a hardware token, which does not work on a hosted CI runner without extra
infrastructure. An OV certificate can be used in CI, but note that OV certificates still show
SmartScreen until the signature accumulates reputation; EV clears it immediately.

Recommendation: **Azure Trusted Signing**, unless there's a reason to prefer a named CA.

## What is not worth doing

- Self-signed certificates change nothing — neither OS trusts them.
- Asking teammates to disable SmartScreen or Gatekeeper trades a one-time prompt for a permanently
  weakened machine.
