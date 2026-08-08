import { TYPE_PROVIDER } from "@/types";
import { MeetingBrief } from "@/types/meeting";
import { getCachedBrief, saveBrief } from "@/lib/database/meeting.action";
import { renderDocsForBrief, scanProjectFolder } from "./context-reader";
import { BRIEF_SYSTEM_PROMPT, buildBriefUserMessage } from "./prompts";
import { collectModelText, ProviderSelection } from "./analysis";

export interface BriefLoadResult {
  brief: MeetingBrief | null;
  /** True when the cached brief was reused and no model call was made. */
  fromCache: boolean;
  /** Documents found but not read — surfaced so the UI can be honest. */
  skipped: string[];
  /** Set when no brief could be produced. The meeting still runs without one. */
  error: string | null;
}

/**
 * Resolve the brief for a project folder, distilling it only when the folder's
 * content fingerprint has changed.
 *
 * Cost behaviour: a folder that has not changed since the last meeting costs
 * ZERO model calls. Distillation is the expensive call in this feature, and it
 * is deliberately keyed to document change rather than to meeting start.
 *
 * Failure behaviour: never throws. A meeting without context is degraded but
 * still useful, so every failure path returns `brief: null` with a reason for
 * the caller to display.
 */
export async function loadOrBuildBrief(params: {
  folderPath: string;
  provider: TYPE_PROVIDER | undefined;
  selectedProvider: ProviderSelection;
  signal?: AbortSignal;
}): Promise<BriefLoadResult> {
  const { folderPath, provider, selectedProvider, signal } = params;

  let scan;
  try {
    scan = await scanProjectFolder(folderPath);
  } catch (error) {
    console.warn(
      "Failed to scan project folder:",
      error instanceof Error ? error.name : "unknown error"
    );
    return {
      brief: null,
      fromCache: false,
      skipped: [],
      error: "Project folder could not be read.",
    };
  }

  if (scan.docs.length === 0) {
    return {
      brief: null,
      fromCache: false,
      skipped: scan.skipped,
      error: "No readable .txt, .md or .pdf documents in that folder.",
    };
  }

  try {
    const cached = await getCachedBrief(folderPath, scan.fingerprint);
    if (cached) {
      return {
        brief: cached,
        fromCache: true,
        skipped: scan.skipped,
        error: null,
      };
    }
  } catch (error) {
    // A cache read failure is not fatal — fall through and distill fresh.
    console.warn(
      "Brief cache lookup failed:",
      error instanceof Error ? error.name : "unknown error"
    );
  }

  if (!provider) {
    return {
      brief: null,
      fromCache: false,
      skipped: scan.skipped,
      error: "No analysis provider configured.",
    };
  }

  const result = await collectModelText({
    provider,
    selectedProvider,
    systemPrompt: BRIEF_SYSTEM_PROMPT,
    userMessage: buildBriefUserMessage(renderDocsForBrief(scan)),
    signal,
  });

  if (signal?.aborted) {
    return { brief: null, fromCache: false, skipped: scan.skipped, error: null };
  }

  if (result.failed || !result.text) {
    return {
      brief: null,
      fromCache: false,
      skipped: scan.skipped,
      error: "Could not distill the project documents.",
    };
  }

  const brief: MeetingBrief = {
    id: `brief-${crypto.randomUUID()}`,
    folderPath,
    fingerprint: scan.fingerprint,
    content: result.text,
    createdAt: Date.now(),
  };

  try {
    await saveBrief(brief);
  } catch (error) {
    // The brief is still usable in memory for this meeting even if it could not
    // be cached — the only cost is redistilling next time.
    console.warn(
      "Failed to cache brief:",
      error instanceof Error ? error.name : "unknown error"
    );
  }

  return { brief, fromCache: false, skipped: scan.skipped, error: null };
}
