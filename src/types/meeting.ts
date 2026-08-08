/**
 * Meeting Intelligence types.
 *
 * A meeting is a recording session that listens to BOTH audio sources at once:
 * system audio (the far end, labelled "Speaker") and the microphone (the local
 * user, labelled "You"). Unlike the chat modes, the default behaviour is
 * silence — the analysis pass emits a signal only when something crosses a bar.
 */

/** Which capture path produced a turn. Labels are by SOURCE, not by voice. */
export type MeetingTurnSource = "system" | "mic";

/**
 * `pending` — audio captured, transcription in flight.
 * `final`   — transcription returned usable text.
 * `failed`  — transcription errored or returned nothing.
 */
export type MeetingTurnStatus = "pending" | "final" | "failed";

export interface MeetingTurn {
  id: string;
  meetingId: string;
  source: MeetingTurnSource;
  /**
   * Stamped when the audio blob is handed to STT, BEFORE the network call.
   * Transcript order is always this, never transcription-completion order —
   * the two streams resolve at different speeds and completion order scrambles
   * the conversation.
   */
  capturedAt: number;
  text: string;
  status: MeetingTurnStatus;
}

export type MeetingSignalKind =
  | "scope"
  | "suggestion"
  | "question"
  | "commitment";

export interface MeetingSignal {
  id: string;
  meetingId: string;
  /** The turn that triggered this signal. Null if it survived a turn deletion. */
  turnId: string | null;
  kind: MeetingSignalKind;
  /** The move, not a script. Read at a glance. */
  headline: string;
  /** Supporting facts drawn from the brief. */
  detail: string;
  confidence: number;
  createdAt: number;
  dismissedAt: number | null;
}

/** A distilled summary of the project folder's documents, cached by fingerprint. */
export interface MeetingBrief {
  id: string;
  folderPath: string;
  /** Hash over each readable file's relative path, size and mtime. */
  fingerprint: string;
  content: string;
  createdAt: number;
}

export interface MeetingRecord {
  id: string;
  title: string;
  folderPath: string | null;
  briefId: string | null;
  startedAt: number;
  endedAt: number | null;
  recap: string | null;
}

/**
 * `starting` is explicit and visible: it either reaches `live` or fails loudly.
 * There is deliberately no half-started state that looks running but hears
 * nothing — that ambiguity is what made the old system-audio mode confusing.
 */
export type MeetingPhase = "idle" | "starting" | "live" | "ending";

/** One readable document found under the project folder. */
export interface MeetingContextDoc {
  relPath: string;
  text: string;
  /** True when the document was truncated to fit the per-file budget. */
  truncated: boolean;
}

export interface MeetingContextScan {
  folderPath: string;
  fingerprint: string;
  docs: MeetingContextDoc[];
  /** Files found but not read: unsupported type, unreadable, or over budget. */
  skipped: string[];
}

/** Why the meeting is running in a degraded mode. Each maps to a visible banner. */
export interface MeetingWarnings {
  /** Microphone permission denied — running Speaker-only. */
  micUnavailable: boolean;
  /** No folder selected, unreadable, or brief generation failed. */
  contextUnavailable: boolean;
  /** Analysis paused after consecutive failures. */
  analysisPaused: boolean;
  /** No audio from either source for the silence threshold. */
  noAudio: boolean;
}
