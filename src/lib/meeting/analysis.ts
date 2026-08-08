import { fetchAIResponse } from "@/lib/functions";
import { TYPE_PROVIDER } from "@/types";
import { MEETING } from "@/config/meeting.constants";
import { MeetingSignalKind } from "@/types/meeting";
import { SIGNAL_KINDS } from "./prompts";

/** A provider plus the variables needed to call it. */
export interface ProviderSelection {
  provider: string;
  variables: Record<string, string>;
}

/**
 * `fetchAIResponse` reports transport and HTTP failures by YIELDING an error
 * string rather than throwing, so a naive collector would treat "API request
 * failed: 401" as a successful model answer. These are the prefixes it uses.
 */
const ERROR_PREFIXES = [
  "API request failed:",
  "Network error during API request:",
  "Failed to parse non-streaming response:",
  "Error reading stream:",
  "Streaming not supported",
];

export interface ModelResult {
  text: string;
  failed: boolean;
}

/**
 * Run a provider to completion and return the whole answer.
 *
 * Never throws for a model or network problem — callers decide what a failure
 * means, and in a live meeting an exception escaping into a React effect is
 * far worse than a flagged result.
 */
export async function collectModelText(params: {
  provider: TYPE_PROVIDER | undefined;
  selectedProvider: ProviderSelection;
  systemPrompt: string;
  userMessage: string;
  signal?: AbortSignal;
  onChunk?: (chunk: string) => void;
}): Promise<ModelResult> {
  const { provider, selectedProvider, systemPrompt, userMessage, signal, onChunk } =
    params;

  if (!provider) return { text: "", failed: true };

  let text = "";
  try {
    for await (const chunk of fetchAIResponse({
      provider,
      selectedProvider,
      systemPrompt,
      history: [],
      userMessage,
      imagesBase64: [],
      signal,
      rawSystemPrompt: true,
    })) {
      text += chunk;
      onChunk?.(chunk);
    }
  } catch (error) {
    if (signal?.aborted) return { text: "", failed: false };
    console.warn(
      "Meeting model call failed:",
      error instanceof Error ? error.name : "unknown error"
    );
    return { text: "", failed: true };
  }

  if (signal?.aborted) return { text: "", failed: false };

  const trimmed = text.trim();
  const failed =
    !trimmed || ERROR_PREFIXES.some((prefix) => trimmed.startsWith(prefix));

  return { text: trimmed, failed };
}

export interface ParsedSignal {
  kind: MeetingSignalKind;
  headline: string;
  detail: string;
  confidence: number;
}

/** Strip markdown fences a model may wrap JSON in despite instructions. */
function stripFences(raw: string): string {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fence ? fence[1] : raw).trim();
}

/** Isolate the outermost JSON object, ignoring any stray leading commentary. */
function isolateObject(raw: string): string | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return raw.slice(start, end + 1);
}

function clampWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  return words.length <= maxWords ? text.trim() : words.slice(0, maxWords).join(" ");
}

/**
 * Parse an analysis response into renderable signals.
 *
 * Returns null for anything unparseable — which the caller counts as a failure
 * — and an empty array for a valid "nothing to flag" response, which is the
 * expected outcome for most turns. Those two cases must not be conflated: one
 * means the analysis is broken, the other means the meeting is going fine.
 */
export function parseSignals(raw: string): ParsedSignal[] | null {
  const candidate = isolateObject(stripFences(raw));
  if (!candidate) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const signals = (parsed as { signals?: unknown }).signals;
  if (!Array.isArray(signals)) return null;

  const result: ParsedSignal[] = [];

  for (const entry of signals) {
    if (!entry || typeof entry !== "object") continue;
    const candidateSignal = entry as Record<string, unknown>;

    const kind = candidateSignal.kind;
    if (typeof kind !== "string") continue;
    if (!SIGNAL_KINDS.includes(kind as MeetingSignalKind)) continue;

    const headline =
      typeof candidateSignal.headline === "string"
        ? candidateSignal.headline.trim()
        : "";
    if (!headline) continue;

    const detail =
      typeof candidateSignal.detail === "string"
        ? candidateSignal.detail.trim()
        : "";

    const rawConfidence = candidateSignal.confidence;
    const confidence =
      typeof rawConfidence === "number" && Number.isFinite(rawConfidence)
        ? Math.min(1, Math.max(0, rawConfidence))
        : 0;

    if (confidence < MEETING.CONFIDENCE_FLOOR) continue;

    result.push({
      kind: kind as MeetingSignalKind,
      headline: clampWords(headline, 12),
      detail: clampWords(detail, 30),
      confidence,
    });
  }

  // The prompt caps output at 2; enforce it here too so a misbehaving model
  // cannot flood the panel mid-meeting.
  return result.slice(0, 2);
}

/**
 * Signals repeat across turns because the conversation keeps circling the same
 * point. Dedupe on kind plus a normalised headline so the panel does not fill
 * with the same warning five times.
 */
export function signalDedupeKey(kind: string, headline: string): string {
  return `${kind}::${headline.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
}
