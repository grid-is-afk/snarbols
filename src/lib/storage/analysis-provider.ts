import { STORAGE_KEYS } from "@/config";
import { safeLocalStorage } from "@/lib/storage/helper";

/**
 * The model used for the meeting analysis hot path.
 *
 * Stored as a MODEL OVERRIDE rather than a second provider selection: the
 * analysis call runs through the main provider's credentials with `MODEL`
 * swapped, so there is no duplicate copy of the API key to leak or to go stale
 * when the key is rotated. That also means this value is not a secret and does
 * not need the vault.
 *
 * Empty means "use the main chat model" — meetings work before this is ever
 * configured, they just cost more per turn.
 */

export function getAnalysisModel(): string {
  return safeLocalStorage.getItem(STORAGE_KEYS.ANALYSIS_MODEL)?.trim() || "";
}

export function setAnalysisModel(model: string): void {
  const trimmed = model.trim();
  if (trimmed) {
    safeLocalStorage.setItem(STORAGE_KEYS.ANALYSIS_MODEL, trimmed);
  } else {
    safeLocalStorage.removeItem(STORAGE_KEYS.ANALYSIS_MODEL);
  }
}

/** The remembered project folder. Not a secret — stored in the clear. */
export function getMeetingFolder(): string | null {
  return safeLocalStorage.getItem(STORAGE_KEYS.MEETING_FOLDER);
}

export function setMeetingFolder(path: string | null): void {
  if (path) {
    safeLocalStorage.setItem(STORAGE_KEYS.MEETING_FOLDER, path);
  } else {
    safeLocalStorage.removeItem(STORAGE_KEYS.MEETING_FOLDER);
  }
}
