import { MEETING } from "@/config/meeting.constants";
import { MeetingTurn, MeetingTurnSource } from "@/types/meeting";

/**
 * Ordered buffer reconciling the two independent capture streams.
 *
 * THE PROBLEM: system audio and microphone transcribe independently, and STT
 * latency varies per provider and per clip. A short microphone turn can resolve
 * BEFORE a system-audio turn that actually happened earlier. Appending in
 * resolution order scrambles the conversation, which both misleads the reader
 * and feeds the analysis model a false sequence of events.
 *
 * THE RULE: every turn is stamped `capturedAt` when its audio is handed to STT,
 * before the network call. This buffer orders by that stamp and nothing else.
 *
 * Pure and synchronous by design — `now` is always passed in rather than read
 * from the clock, so the ordering behaviour is deterministic and testable
 * without a real meeting or a real STT provider.
 */
export class TranscriptBuffer {
  private turns: MeetingTurn[] = [];
  /** Ids already handed to analysis; never emitted twice. */
  private emitted = new Set<string>();

  constructor(private readonly meetingId: string) {}

  /**
   * Register a captured utterance whose transcription is in flight.
   * `capturedAt` must be stamped by the caller before it calls STT.
   */
  open(id: string, source: MeetingTurnSource, capturedAt: number): MeetingTurn {
    const turn: MeetingTurn = {
      id,
      meetingId: this.meetingId,
      source,
      capturedAt,
      text: "",
      status: "pending",
    };
    this.turns.push(turn);
    this.turns.sort((a, b) => a.capturedAt - b.capturedAt);
    return turn;
  }

  /** Resolve a pending turn. Empty or whitespace-only text counts as failure. */
  resolve(id: string, text: string): MeetingTurn | null {
    const turn = this.turns.find((t) => t.id === id);
    if (!turn || turn.status !== "pending") return null;

    const trimmed = text.trim();
    turn.text = trimmed;
    turn.status = trimmed ? "final" : "failed";
    return turn;
  }

  /** Mark a pending turn as failed (STT threw, or both providers gave up). */
  fail(id: string): MeetingTurn | null {
    const turn = this.turns.find((t) => t.id === id);
    if (!turn || turn.status !== "pending") return null;
    turn.status = "failed";
    return turn;
  }

  /** All turns in true conversational order, for display. */
  list(): MeetingTurn[] {
    return [...this.turns];
  }

  /** Turns that resolved with usable text, in order. */
  finalTurns(): MeetingTurn[] {
    return this.turns.filter((t) => t.status === "final");
  }

  hasPending(): boolean {
    return this.turns.some((t) => t.status === "pending");
  }

  /**
   * Take the next run of turns that are safe to send to analysis, in order.
   *
   * Walks the buffer from the oldest un-emitted turn. A `pending` turn blocks
   * everything behind it — that is what preserves conversational order — but
   * only until `COMMIT_BLOCK_MS` has elapsed since it was captured. Past that
   * budget we step over it rather than stalling analysis for the full STT
   * timeout. A turn that resolves after being stepped over still displays in
   * its correct position and is picked up by a later drain, since emission is
   * tracked per id rather than by position.
   *
   * Returns only `final` turns; failed and skipped ones are consumed silently.
   */
  drainForAnalysis(now: number): MeetingTurn[] {
    const ready: MeetingTurn[] = [];

    for (const turn of this.turns) {
      if (this.emitted.has(turn.id)) continue;

      if (turn.status === "pending") {
        if (now - turn.capturedAt < MEETING.COMMIT_BLOCK_MS) {
          // Still within its grace period: it must not be overtaken.
          break;
        }
        // Over budget — step over it without consuming it, so it can still be
        // emitted if the transcription lands later.
        continue;
      }

      this.emitted.add(turn.id);
      if (turn.status === "final") ready.push(turn);
    }

    return ready;
  }

  /** Turns already emitted to analysis, oldest first — the rolling window source. */
  emittedTurns(): MeetingTurn[] {
    return this.turns.filter((t) => this.emitted.has(t.id) && t.status === "final");
  }
}

/** How a turn is labelled everywhere it is shown or sent to a model. */
export function speakerLabel(source: MeetingTurnSource): string {
  return source === "system" ? "Speaker" : "You";
}

/**
 * Render turns as a plain transcript for a model prompt, newest last, trimmed
 * to fit both a turn count and a character budget. The character budget is
 * applied from the END so the most recent exchange always survives.
 */
export function renderTranscriptWindow(
  turns: MeetingTurn[],
  maxTurns: number,
  maxChars: number
): string {
  const recent = turns.slice(-maxTurns);
  const lines: string[] = [];
  let total = 0;

  for (let i = recent.length - 1; i >= 0; i--) {
    const line = `${speakerLabel(recent[i].source)}: ${recent[i].text}`;
    if (total + line.length > maxChars && lines.length > 0) break;
    lines.unshift(line);
    total += line.length;
  }

  return lines.join("\n");
}

/** Words in a turn, used for the analysis word floor. */
export function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}
