import { STORAGE_KEYS } from "@/config";
import { decryptValue, encryptValue } from "@/lib/storage/secure-vault";
import { safeLocalStorage } from "@/lib/storage/helper";

/**
 * The provider used for the meeting analysis hot path.
 *
 * Kept separate from the main chat provider so the per-turn call can run on a
 * cheap model while chat and the on-demand answer stay on the good one. When
 * unset, callers fall back to the main AI provider — meetings must work before
 * this is ever configured.
 *
 * The stored value contains API keys, so it is encrypted at rest by the same
 * vault as the other provider selections (see SECRET_STORAGE_KEYS).
 */

export interface AnalysisProviderSelection {
  provider: string;
  variables: Record<string, string>;
}

export const EMPTY_ANALYSIS_PROVIDER: AnalysisProviderSelection = {
  provider: "",
  variables: {},
};

export async function getAnalysisProvider(): Promise<AnalysisProviderSelection> {
  const raw = safeLocalStorage.getItem(STORAGE_KEYS.SELECTED_ANALYSIS_PROVIDER);
  if (!raw) return EMPTY_ANALYSIS_PROVIDER;

  try {
    const parsed = JSON.parse(await decryptValue(raw));
    if (!parsed || typeof parsed !== "object") return EMPTY_ANALYSIS_PROVIDER;
    return {
      provider: typeof parsed.provider === "string" ? parsed.provider : "",
      variables:
        parsed.variables && typeof parsed.variables === "object"
          ? parsed.variables
          : {},
    };
  } catch (error) {
    // Runs downstream of decrypt, so an error message can embed a fragment of
    // the secret. Log the name only.
    console.warn(
      "Failed to load analysis provider:",
      error instanceof Error ? error.name : "unknown error"
    );
    return EMPTY_ANALYSIS_PROVIDER;
  }
}

/**
 * Persist the analysis provider. Returns false when the write failed — callers
 * MUST NOT report success on a failed persist, that silently drops an API key.
 */
export async function setAnalysisProvider(
  selection: AnalysisProviderSelection
): Promise<boolean> {
  try {
    const encrypted = await encryptValue(JSON.stringify(selection));
    safeLocalStorage.setItem(
      STORAGE_KEYS.SELECTED_ANALYSIS_PROVIDER,
      encrypted
    );
    return (
      safeLocalStorage.getItem(STORAGE_KEYS.SELECTED_ANALYSIS_PROVIDER) ===
      encrypted
    );
  } catch (error) {
    console.warn(
      "Failed to save analysis provider:",
      error instanceof Error ? error.name : "unknown error"
    );
    return false;
  }
}

export function clearAnalysisProvider(): void {
  safeLocalStorage.removeItem(STORAGE_KEYS.SELECTED_ANALYSIS_PROVIDER);
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
