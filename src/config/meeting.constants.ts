/**
 * Meeting Intelligence tuning constants.
 *
 * These are the knobs that decide cost, latency and noise. They live in one
 * place because they will need tuning against real meetings — signal quality is
 * not a build-time property.
 */
export const MEETING = {
  /**
   * How long a pending (still-transcribing) turn may block the turns behind it
   * from reaching analysis. The two capture streams resolve at different
   * speeds, so some waiting is required to keep conversational order — but STT
   * can legitimately take tens of seconds, and analysis must not stall that
   * long. Past this budget we advance; a late arrival is still displayed in its
   * correct position and joins the next analysis batch.
   */
  COMMIT_BLOCK_MS: 4000,

  /**
   * Turns shorter than this never trigger an analysis request. "yeah", "mhm"
   * and "right" are appended to the transcript for free.
   */
  MIN_WORDS_FOR_ANALYSIS: 4,

  /** Rolling context window for per-turn analysis. Caps cost per turn. */
  ANALYSIS_WINDOW_TURNS: 14,
  ANALYSIS_WINDOW_CHARS: 4000,

  /** Wider window for the on-demand hotkey, which uses the main chat model. */
  ONDEMAND_WINDOW_TURNS: 30,
  ONDEMAND_WINDOW_CHARS: 8000,

  /** Signals below this confidence are discarded before rendering. */
  CONFIDENCE_FLOOR: 0.5,

  /**
   * Consecutive analysis failures before showing the "analysis paused" notice.
   * Individual failures stay silent because silence is the normal output — but
   * sustained silence caused by breakage would be misread as "nothing to flag".
   */
  CONSECUTIVE_FAILURE_LIMIT: 3,

  /**
   * No audio from EITHER source for this long raises a visible warning. Silent
   * failure is the worst possible outcome for this tool.
   */
  NO_AUDIO_WARNING_MS: 120_000,

  /** Document budgets for brief distillation. */
  MAX_DOC_CHARS: 20_000,
  MAX_TOTAL_DOC_CHARS: 120_000,
  MAX_DOC_FILES: 40,
  /** Directory recursion depth under the selected project folder. */
  MAX_DOC_DEPTH: 3,

  /** Expanded window height while a meeting is live. */
  WINDOW_HEIGHT: 600,
} as const;

export const MEETING_SUPPORTED_EXTENSIONS = [
  ".txt",
  ".md",
  ".markdown",
  ".pdf",
] as const;

/** Directory names never descended into when scanning a project folder. */
export const MEETING_IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  ".obsidian",
  ".vscode",
  "dist",
  "build",
  "target",
  "__pycache__",
]);

export const MEETING_SIGNAL_LABELS: Record<string, string> = {
  scope: "SCOPE",
  suggestion: "SUGGESTED",
  question: "ASK",
  commitment: "COMMITMENT",
};
