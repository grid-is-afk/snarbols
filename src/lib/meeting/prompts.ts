import { MEETING } from "@/config/meeting.constants";
import { MeetingSignalKind, MeetingTurn } from "@/types/meeting";
import { renderTranscriptWindow, speakerLabel } from "./transcript";

/**
 * Every prompt in Meeting Intelligence, kept together because they are tuned as
 * a set: the analysis prompt's silence bar only makes sense against the shape
 * the brief prompt produces.
 */

export const BRIEF_SYSTEM_PROMPT = `You distill project documents into a reference brief that will be consulted during a live client meeting.

Write plain text under exactly these headings, in this order:

IN SCOPE
OUT OF SCOPE / DEFERRED
DECISIONS ALREADY MADE
CONSTRAINTS
KEY FACTS AND NUMBERS

Rules:
- Use short bullet lines starting with "- ".
- Record only what the documents actually state. Never infer, extrapolate or invent.
- Preserve exact figures, dates, versions and names as written.
- If a heading has no supporting content, write "- (nothing recorded)" under it.
- No preamble, no closing commentary, no markdown formatting beyond the bullets.`;

export function buildBriefUserMessage(docsText: string): string {
  return `Project documents follow. Distill them into the brief.\n\n${docsText}`;
}

export const ANALYSIS_SYSTEM_PROMPT = `You silently monitor a live meeting on behalf of the user ("You" in the transcript). The other party is "Speaker".

You return JSON only. No prose, no markdown, no code fences.

Schema:
{"signals":[{"kind":"scope|suggestion|question|commitment","headline":"string","detail":"string","confidence":0.0}]}

Emit a signal ONLY when one of these is clearly true:
- "scope": the Speaker asked for or assumed something the brief places out of scope, deferred, or contradicting a recorded decision.
- "suggestion": the Speaker put the user on the spot and a specific, well-grounded reply would help. Give the angle to take, never a script to read aloud.
- "question": a clarifying question the user should ask now to avoid a costly misunderstanding later.
- "commitment": someone committed to a deliverable, date, price or action. Record who owes what.

Hard rules:
- SILENCE IS THE CORRECT DEFAULT. Most turns warrant nothing. Return {"signals":[]} and that is a complete, successful answer.
- Never emit a signal that merely restates or summarises what was said.
- Never emit a signal you already emitted for earlier turns in this transcript.
- "headline": at most 12 words. It is read at a single glance, mid-conversation.
- "detail": at most 30 words, and it must cite a concrete fact, figure or line from the brief. If the brief does not support it, do not emit the signal.
- "confidence": 0.0-1.0, your honest probability that this is worth interrupting the user for.
- Emit at most 2 signals per response.`;

export function buildAnalysisUserMessage(params: {
  brief: string | null;
  windowTurns: MeetingTurn[];
  newTurns: MeetingTurn[];
}): string {
  const { brief, windowTurns, newTurns } = params;

  const briefSection = brief
    ? `PROJECT BRIEF\n${brief}`
    : `PROJECT BRIEF\n(none available — emit only signals that stand on the conversation alone, and be markedly more conservative)`;

  const recent = renderTranscriptWindow(
    windowTurns,
    MEETING.ANALYSIS_WINDOW_TURNS,
    MEETING.ANALYSIS_WINDOW_CHARS
  );

  const incoming = newTurns
    .map((t) => `${speakerLabel(t.source)}: ${t.text}`)
    .join("\n");

  return `${briefSection}\n\nRECENT TRANSCRIPT\n${
    recent || "(nothing yet)"
  }\n\nNEW TURNS TO ASSESS\n${incoming}\n\nReturn the JSON object now.`;
}

export const ONDEMAND_SYSTEM_PROMPT = `You are helping the user ("You" in the transcript) respond during a live meeting with "Speaker".

Answer the Speaker's most recent point directly and concretely, grounded in the project brief. Lead with the answer itself — the user is mid-conversation and will read only the first line before speaking.

Keep it under 80 words. No preamble, no restating the question, no offers of further help. If the brief does not contain what is needed, say exactly what is missing in one line rather than inventing it.`;

export function buildOnDemandUserMessage(params: {
  brief: string | null;
  turns: MeetingTurn[];
}): string {
  const { brief, turns } = params;

  const briefSection = brief ? `PROJECT BRIEF\n${brief}\n\n` : "";
  const transcript = renderTranscriptWindow(
    turns,
    MEETING.ONDEMAND_WINDOW_TURNS,
    MEETING.ONDEMAND_WINDOW_CHARS
  );

  return `${briefSection}TRANSCRIPT\n${
    transcript || "(nothing captured yet)"
  }\n\nWhat should the user say back?`;
}

export const RECAP_SYSTEM_PROMPT = `You write the record of a meeting that just ended, for the user ("You" in the transcript). "Speaker" is the other party.

Write plain markdown under exactly these headings:

## Decisions
## Commitments
## Open questions
## Scope changes

Rules:
- Under "Commitments", every line must name who owes what, and by when if stated.
- Record only what the transcript supports. Never infer or invent.
- If a heading has nothing, write "- None recorded." under it.
- No preamble and no closing summary.`;

export function buildRecapUserMessage(params: {
  brief: string | null;
  turns: MeetingTurn[];
}): string {
  const { brief, turns } = params;
  const briefSection = brief ? `PROJECT BRIEF\n${brief}\n\n` : "";
  const transcript = turns
    .map((t) => `${speakerLabel(t.source)}: ${t.text}`)
    .join("\n");

  return `${briefSection}FULL TRANSCRIPT\n${transcript}\n\nWrite the record now.`;
}

export const SIGNAL_KINDS: MeetingSignalKind[] = [
  "scope",
  "suggestion",
  "question",
  "commitment",
];
