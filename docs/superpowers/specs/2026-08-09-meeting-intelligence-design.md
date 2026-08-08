# Meeting Intelligence — Design Spec

**Date:** 2026-08-09
**Status:** Approved, ready for implementation
**Branch:** `feat/meeting-intelligence`

## Problem

Snarbols' existing system-audio mode is a voice assistant: every detected utterance is
transcribed and sent to the chat model, which replies. Used in a real client meeting this
behaves badly, and the reasons are structural, not bugs:

1. **It answers everything.** Every speech segment triggers a full AI response
   (`useSystemAudio.ts:289`). A meeting produces a firehose of unrequested replies.
2. **It only hears the far end.** System audio capture records speaker output. The user's
   microphone is not captured in that mode, so the transcript is one-sided and the model has
   no idea what the user already said.
3. **Two hidden modes.** The `vadConfig.enabled` toggle silently switches between auto-detect
   and press-to-record. Same button, opposite behaviour. A user in continuous mode expecting
   auto-detect sees nothing happen.
4. **Turns are chopped.** A turn ends after ~1s of silence, so normal speaking pauses split one
   thought into several turns — each triggering its own reply.
5. **The window moves on its own.** Popover open state is derived from processing/error/response
   state (`useSystemAudio.ts:685`), so the bar grows and shrinks mid-meeting.

Meeting Intelligence inverts the default: **silence, not answers.** It watches both sides of a
conversation against the user's own project documents and surfaces something only when it
crosses a bar.

## Scope

**In scope (V1)**

- Source-based diarization: system audio = `Speaker`, microphone = `You`
- Project context from a local folder (`.txt`, `.md`, `.pdf`)
- Cached "meeting brief" distilled from those docs, regenerated only on document change
- Per-turn analysis on a separate, cheaper model
- Four signal kinds: scope flag, suggested response, clarifying question, commitment
- On-demand answer via global hotkey, using the **main** chat model
- Overlay showing live transcript (left) and signals (right)
- Saved meeting record: transcript + signals + generated recap, browsable and exportable

**Explicitly out of scope (V1)**

- Real per-speaker diarization (voice fingerprinting)
- Google Docs / URL / cloud context sources
- Pre-meeting prep sheet (deferred; cheap fast-follow since the brief already exists)
- Live translation
- Audio retention — transcribed text is stored, WAV data is not
- Calendar integration

## Architecture

### Capture

Meeting mode starts both existing capture paths simultaneously. Neither is modified.

- **System audio** — Rust/`cpal` with VAD, already emits one `speech-detected` event per
  completed utterance carrying base64 WAV.
- **Microphone** — a dedicated `useMicVAD` (`@ricky0123/vad-react`) instance with
  `onSpeechEnd`, mirroring `AutoSpeechVad.tsx`.

Both already funnel into `fetchSTT`, which has primary + fallback provider failover.

### Turn ordering — the primary correctness risk

The two streams transcribe independently and STT latency varies, so a short microphone turn can
resolve *before* a system-audio turn that happened earlier. Ordering by transcription-completion
time would scramble the conversation.

**Rule:** every utterance is stamped `capturedAt` at the moment its audio blob is handed to STT,
before the network call. The transcript orders by `capturedAt`, never by resolution time.

A turn is inserted immediately in `pending` status and rendered as a placeholder, then resolves
in place when its transcription returns. A **reorder window of 1500 ms** governs rendering: a
pending turn older than the window that has not resolved is rendered as `failed` and no longer
holds up display of later turns.

### Analysis

Triggered by each committed (`final`) turn, with three guards:

- **Single flight.** At most one analysis request is in the air. Turns arriving during a request
  are queued and coalesced into the next one — rapid back-and-forth produces *fewer* calls, not
  more.
- **Word floor.** Turns under 4 words are appended to the transcript but never trigger analysis.
  "yeah", "mhm", "right" are free.
- **Defensive parse.** The response must be JSON matching the signal schema. A malformed response
  is dropped silently. A bad parse must never interrupt a meeting.

Cost per turn is **constant, not growing**: context is `brief + rolling window of recent turns`,
so a 90-minute meeting does not cost progressively more per turn than a 10-minute one.

### Context and the brief

Selecting a folder produces a **fingerprint**: a hash over each readable file's relative path,
size and mtime. The brief cache is keyed on `folder_path + fingerprint`.

- Fingerprint unchanged → cached brief reused verbatim, zero cost.
- Fingerprint changed → brief regenerated once, in the background. A meeting started during
  regeneration runs on the previous brief rather than blocking.

The brief is a fixed structure: in scope, out of scope / deferred, decisions already made,
constraints (dates, budget, stack), key facts and numbers.

### Native surface

Only two plugin additions: **`tauri-plugin-fs`** and **`tauri-plugin-dialog`**. No new Tauri
commands, no new Rust modules.

- Window growth reuses the existing `set_window_height` command (`window.rs:74`).
- Storage uses `sql:allow-execute`, already granted, so tables are created from TypeScript with
  no Rust migration.
- The main window is already `contentProtected: true`, so the expanded overlay remains invisible
  to screen sharing with no change.

## Data model

Created from TypeScript at startup via `CREATE TABLE IF NOT EXISTS`.

**`meeting_briefs`** — `id`, `folder_path`, `fingerprint`, `content`, `created_at`
Cache lookup on `(folder_path, fingerprint)`.

**`meetings`** — `id`, `title`, `folder_path`, `brief_id`, `started_at`, `ended_at`, `recap`

**`meeting_turns`** — `id`, `meeting_id`, `source` (`system` | `mic`), `captured_at`, `text`,
`status` (`pending` | `final` | `failed`)
Always ordered by `captured_at`.

**`meeting_signals`** — `id`, `meeting_id`, `turn_id`, `kind`, `headline`, `detail`,
`confidence`, `created_at`, `dismissed_at`

Turns are persisted as they finalize, so a crash loses the recap, not the meeting — the recap can
be regenerated later from stored turns.

## Model calls

### The analysis model

The cheap model is stored as a **`MODEL` override applied to the main provider**, not as a second
provider selection. Both run on the same credentials with a different model id, which means there
is no duplicate copy of the API key to leak or to go stale when the key is rotated. An empty
override means "use the main model", so meetings work before the setting is ever touched — they
just cost more per turn.

### 1. Brief distillation

Runs on folder selection and on fingerprint change. Reads doc text with a per-file character
budget and a total budget. Uses the **analysis** model. Output is prose in a fixed section
structure, stored and later injected verbatim.

### 2. Per-turn analysis (hot path)

Input: brief + rolling transcript window + new turn(s).
Output: strict JSON.

```json
{ "signals": [ { "kind": "scope|suggestion|question|commitment",
                 "headline": "<= 12 words",
                 "detail": "<= 30 words",
                 "confidence": 0.0 } ] }
```

An **empty array is the expected result.** The prompt instructs silence unless a threshold is
crossed. Signals below the confidence floor are discarded before rendering.

### 3. On-demand answer (hotkey)

Uses the **main** chat provider with a wider transcript window and an instruction to directly
answer what was just asked. Streams into its own card so text appears immediately.

## UI

### Overlay states

- **Idle** — current bar, plus a meeting button and an indicator of the loaded project folder.
- **Starting** — one explicit state while permissions are checked and capture spins up. It either
  reaches live or fails loudly. No half-started state that looks running but hears nothing.
- **Live, quiet** — transcript left, signals right. The empty signal panel carries an explicit
  label ("watching — nothing to flag") because an unexplained blank panel is precisely what made
  the old mode confusing.
- **Live, signal** — cards stack newest-first, persisting until dismissed or meeting end. They do
  not auto-dismiss.
- **Ending** — visible recap generation, then collapse to the bar.

### Window height

Meeting mode **pins** the window height. `useWindowResize` currently runs a `MutationObserver`
that collapses the window whenever no Radix popover is open; meeting mode must suppress that
collapse for its duration, or the panel will snap shut mid-meeting.

### Signal card format

Headline first — the move, not a script. Then supporting facts drawn from the brief. The user
gets roughly one glance, so a suggestion must be readable at a glance:

```
SUGGESTED
Don't commit — anchor to phase 2.
Proposal p.3: auth deferred. SSO ≈ +2 wks, +$8k.
```

## Failure behaviour

**Rule: a meeting never silently stops working.** Every degraded mode recovers or says so.

| Failure | Behaviour |
|---|---|
| STT fails for a turn | Fallback provider fires first; if both fail the turn shows as failed, meeting continues |
| Analysis call fails | Dropped with no banner (silence is normal). **Three consecutive failures** show one persistent notice that analysis is paused |
| Analysis returns malformed JSON | Dropped, counted as a failure for the consecutive-failure rule |
| Microphone permission denied | Meeting runs Speaker-only with a banner stating the user's side is not captured |
| System audio permission missing | Caught at start via existing `check_system_audio_access`; meeting does not start half-working |
| Folder unreadable / brief missing | Meeting runs without context, banner says so |
| No audio from either source for 2 minutes | Explicit on-screen warning. Silent failure is the worst outcome for this tool |
| App closed mid-meeting | Turns already persisted; recap regenerable from stored transcript |

## Known limitations

- **Headphones required.** Meeting audio through laptop speakers is picked up by the microphone,
  producing every remote turn twice — once as `Speaker`, once as `You`.
- **All remote participants are `Speaker`.** Labels are by audio source, not voice.
- **The transcript looks choppy** even though analysis is coalesced; turns still break on pauses.
- **Suggestions arrive 2–5s after a turn ends**, which is later than the natural ~1s answering
  pause. This is why the on-demand hotkey exists — the user controls its timing.
- **False positives are expected early.** Signal quality is a tuning exercise against real
  meetings, not a build-time property.

## Verification

No `cargo` or MSVC on the development machine, so Rust changes are CI-verifiable only.

1. **Isolate the native change.** One commit adds `tauri-plugin-fs` and `tauri-plugin-dialog`:
   Cargo entries, JS deps, and matching permissions in **both** `capabilities/default.json` and
   `capabilities/cross-platform.json`. Tauri validates capabilities at build time before compile;
   a plugin added without its permissions fails CI. This is the posthog and updater lesson.
2. **Everything else is TypeScript**, gated on `tsc && vite build` green locally.
3. **Tag and build on CI** for all three platforms.
4. **Nate's real-machine smoke test** on the installer is the final gate.

### Dependency

The **v0.1.13 / v0.1.14 smoke test is still outstanding** from July: CSP not bricking the webview,
BYO chat and STT working, mermaid/katex rendering, and keychain vault persistence across restart.
If any of those are broken, meeting mode is being built on an unverified base.
