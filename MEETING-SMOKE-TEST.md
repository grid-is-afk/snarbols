# Meeting Intelligence — smoke test

Everything below needs a real machine. CI proves the app compiles and that the
Tauri capability permissions are valid on all three platforms; it cannot prove
that audio is captured, that the keychain survives a restart, or that the
signals are any good. That is what this checklist is for.

Install per `INSTALL.md` (the build is unsigned — Windows SmartScreen "More
info → Run anyway", macOS right-click → Open).

> **Wear headphones.** Labels are by audio source, not by voice. If meeting
> audio comes out of your speakers your microphone hears it too, and every
> remote turn will appear twice — once as `Speaker`, once as `You`.

## 0. Base app still works

This branch touched shared code (`useApp`, `useSystemAudio`, `useWindow`,
`ai-response.function`), so confirm the existing app before the new feature.
This also finally clears the v0.1.13/v0.1.14 smoke test that has been open
since July.

- [ ] App launches; the bar appears at the top of the screen
- [ ] Chat works with your BYO key (CSP is not blocking the webview)
- [ ] A response containing a mermaid diagram and a math block renders
- [ ] Speech-to-text works in normal chat
- [ ] **Quit and relaunch — your API key is still there** (keychain vault)
- [ ] The old system-audio button still starts and stops capture, and its
      global shortcut still toggles it

## 1. Project context

- [ ] Click the folder button on the bar; the OS folder picker opens
      *(this is the only genuinely new native surface — `tauri-plugin-dialog`)*
- [ ] Pick a folder with a few `.txt` / `.md` files; the folder name appears
      on the bar and the icon settles from spinner to folder
- [ ] Hover the folder chip — it reports context ready, or names what failed
- [ ] Relaunch the app; the folder is remembered
- [ ] Click the folder button again and pick the SAME folder — it should
      return effectively instantly (cached brief, no model call)
- [ ] Add a file to that folder, pick it again — it re-distills this time
- [ ] Point it at a folder with no readable documents; it says so rather than
      failing silently

## 2. A real meeting

Join an actual call. Two minutes is enough.

- [ ] Press the meeting button; the bar grows into the panel
- [ ] The panel **stays open** and does not collapse on its own
- [ ] The other party's speech appears on the left labelled `Speaker`
- [ ] Your speech appears labelled `You`
- [ ] **Turns are in the order they were actually said** — this is the one
      most likely to be subtly wrong; watch a fast back-and-forth
- [ ] The right panel says "watching — nothing to flag" when nothing is
      happening, rather than sitting blank
- [ ] The panel is invisible in a screen share (`contentProtected`)

## 3. Signals

- [ ] Ask the other party to request something outside your scope doc — a
      SCOPE card should appear within a few seconds
- [ ] Commit to something out loud ("I'll send that Friday") — a COMMITMENT
      card should appear
- [ ] Signals persist until dismissed; the × dismisses one
- [ ] Judge the quality honestly: how many were useful vs noise? Note it —
      the confidence floor and prompt are meant to be tuned from this.

## 4. On-demand answer

- [ ] Press the **system-audio global shortcut** while the meeting is live —
      it should give an answer to the last thing said, not toggle capture
- [ ] The answer streams in rather than appearing all at once
- [ ] It is short enough to actually glance at mid-conversation
- [ ] The "What do I say?" button in the panel does the same thing

## 5. Failure behaviour

The rule is that a meeting never silently stops working. Each of these should
produce a visible banner:

- [ ] Deny microphone permission → runs Speaker-only and says so
- [ ] Break the STT key mid-meeting → after ~3 failures, a banner names it
- [ ] Mute everything for two minutes → "no audio detected" warning
- [ ] Start a meeting with no project folder → runs and says it has no context

## 6. Ending and records

- [ ] Press End; the recap generates with a visible spinner
- [ ] The record has Decisions / Commitments / Open questions / Scope changes
- [ ] Copy button puts it on the clipboard
- [ ] Dev Space → Meetings lists it
- [ ] Open it: recap, signals and full transcript are all there
- [ ] **Force-quit mid-meeting, relaunch, open Meetings** — the meeting is
      listed with its transcript and says the record is missing (turns are
      written as they finalize, so only the recap is lost)

## 7. Cost

- [ ] Dev Space → "Meeting analysis model": set a cheap model id
      (lowercase-hyphenated, e.g. `claude-haiku-4-5` — display names 404)
- [ ] Run a short meeting and check the provider dashboard. Note the split
      between STT and analysis; STT is expected to be the larger line.

---

**Report back**: which boxes failed, plus your honest read on signal quality.
Signal tuning is a real second pass, not a bug fix.
