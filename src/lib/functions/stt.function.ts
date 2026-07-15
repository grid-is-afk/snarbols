import {
  deepVariableReplacer,
  getByPath,
  blobToBase64,
  canonicalStringify,
} from "./common.function";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

import { TYPE_PROVIDER } from "@/types";
import curl2Json from "@bany/curl-to-json";

/** A single STT provider + its selected variables (primary or fallback). */
interface STTAttempt {
  provider: TYPE_PROVIDER | undefined;
  selectedProvider: {
    provider: string;
    variables: Record<string, string>;
  };
}

export interface STTParams {
  provider: TYPE_PROVIDER | undefined;
  selectedProvider: {
    provider: string;
    variables: Record<string, string>;
  };
  audio: File | Blob;
  /**
   * Optional fallback provider. Tried ONLY if the primary attempt THROWS and the
   * fallback is not an exact duplicate of the primary. A successful return from
   * the primary — including the empty "No transcription found" sentinel — never
   * triggers the fallback.
   */
  fallback?: {
    provider: TYPE_PROVIDER | undefined;
    selectedProvider: {
      provider: string;
      variables: Record<string, string>;
    };
  };
  /** Per-attempt timeout in ms. Applied independently to primary and fallback. */
  timeoutMs?: number;
}

/** Default per-attempt timeout. A hung provider counts as a failed attempt. */
const DEFAULT_STT_TIMEOUT_MS = 30000;

/**
 * Performs one STT request against a single provider. Keeps the exact throw/
 * return semantics the original `fetchSTT` had:
 *  - THROWS on: missing provider/selectedProvider/audio, curl parse failure,
 *    empty audio, network error, and `!response.ok`.
 *  - RETURNS the transcription string on success, INCLUDING the
 *    "No transcription found" sentinel when the response carried no text.
 */
async function performSTT(
  attempt: STTAttempt,
  audio: File | Blob,
  signal?: AbortSignal
): Promise<string> {
  let warnings: string[] = [];

  try {
    const { provider, selectedProvider } = attempt;

    if (!provider) throw new Error("Provider not provided");
    if (!selectedProvider) throw new Error("Selected provider not provided");
    if (!audio) throw new Error("Audio file is required");

    let curlJson: any;
    try {
      curlJson = curl2Json(provider.curl);
    } catch (error) {
      throw new Error(
        `Failed to parse curl: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }

    // Validate audio file
    const file = audio as File;
    if (file.size === 0) throw new Error("Audio file is empty");
    // maximum size of 10MB
    // const maxSize = 10 * 1024 * 1024;
    // if (file.size > maxSize) {
    //   warnings.push("Audio exceeds 10MB limit");
    // }

    // Build variable map
    const allVariables = {
      ...Object.fromEntries(
        Object.entries(selectedProvider.variables).map(([key, value]) => [
          key.toUpperCase(),
          value,
        ])
      ),
    };

    // Prepare request
    let url = deepVariableReplacer(curlJson.url || "", allVariables);
    const headers = deepVariableReplacer(curlJson.header || {}, allVariables);
    const formData = deepVariableReplacer(curlJson.form || {}, allVariables);

    // To Check if API accepts Binary Data
    const isBinaryUpload = provider.curl.includes("--data-binary");
    // Fetch URL Params
    const rawParams = curlJson.params || {};
    // Decode Them
    const decodedParams = Object.fromEntries(
      Object.entries(rawParams).map(([key, value]) => [
        key,
        typeof value === "string" ? decodeURIComponent(value) : "",
      ])
    );
    // Get the Parameters from allVariables
    const replacedParams = deepVariableReplacer(decodedParams, allVariables);

    // Add query parameters to URL
    const queryString = new URLSearchParams(replacedParams).toString();
    if (queryString) {
      url += (url.includes("?") ? "&" : "?") + queryString;
    }

    let finalHeaders = { ...headers };
    let body: FormData | string | Blob;

    const isForm =
      provider.curl.includes("-F ") || provider.curl.includes("--form");
    if (isForm) {
      const form = new FormData();
      const freshBlob = new Blob([await audio.arrayBuffer()], {
        type: audio.type,
      });
      form.append("file", freshBlob, "audio.wav");
      const headerKeys = Object.keys(headers).map((k) =>
        k.toUpperCase().replace(/[-_]/g, "")
      );

      for (const [key, val] of Object.entries(formData)) {
        if (typeof val !== "string") {
          if (
            !val ||
            headerKeys.includes(key.toUpperCase()) ||
            key.toUpperCase() === "AUDIO"
          )
            continue;
          form.append(key.toLowerCase(), val as string | Blob);
          continue;
        }

        // Check if key is a number, which indicates array-like parsing from curl2json
        if (!isNaN(parseInt(key, 10))) {
          const [formKey, ...formValueParts] = val.split("=");
          const formValue = formValueParts.join("=");

          if (formKey.toLowerCase() === "file") continue; // Already handled by form.append('file', audio)

          if (
            !formValue ||
            headerKeys.includes(formKey.toUpperCase().replace(/[-_]/g, ""))
          )
            continue;

          form.append(formKey, formValue);
        } else {
          if (key.toLowerCase() === "file") continue; // Already handled by form.append('file', audio)
          if (
            !val ||
            headerKeys.includes(key.toUpperCase()) ||
            key.toUpperCase() === "AUDIO"
          )
            continue;
          form.append(key.toLowerCase(), val as string | Blob);
        }
      }
      delete finalHeaders["Content-Type"];
      body = form;
    } else if (isBinaryUpload) {
      // Deepgram-style: raw binary body
      body = new Blob([await audio.arrayBuffer()], {
        type: audio.type,
      });
    } else {
      // Google-style: JSON payload with base64
      allVariables.AUDIO = await blobToBase64(audio);
      const dataObj = curlJson.data ? { ...curlJson.data } : {};
      body = JSON.stringify(deepVariableReplacer(dataObj, allVariables));
    }

    const fetchFunction = url?.includes("http") ? fetch : tauriFetch;

    // Send request
    let response: Response;
    try {
      response = await fetchFunction(url, {
        method: curlJson.method || "POST",
        headers: finalHeaders,
        body: curlJson.method === "GET" ? undefined : body,
        // Per-attempt abort: when attemptSTT's timeout fires it aborts this
        // signal so the in-flight request is actually cancelled (server-side
        // billing stops) instead of racing on unnoticed to a late success that
        // would double-charge alongside the fallback. Both the browser `fetch`
        // and tauri's `fetch` honour `signal`.
        signal,
      });
    } catch (e) {
      throw new Error(`Network error: ${e instanceof Error ? e.message : e}`);
    }

    if (!response.ok) {
      let errText = "";
      try {
        errText = await response.text();
      } catch {
        // Best-effort: error body may be unreadable; fall back to status text.
      }
      let errMsg: string;
      try {
        const errObj = JSON.parse(errText);
        errMsg = errObj.message || errText;
      } catch {
        errMsg = errText || response.statusText;
      }
      throw new Error(`HTTP ${response.status}: ${errMsg}`);
    }

    const responseText = await response.text();
    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch {
      return [...warnings, responseText.trim()].filter(Boolean).join("; ");
    }

    // Extract transcription
    const rawPath = provider.responseContentPath || "text";
    const path = rawPath.charAt(0).toLowerCase() + rawPath.slice(1);
    const transcription = (getByPath(data, path) || "").trim();

    if (!transcription) {
      return [...warnings, "No transcription found"].join("; ");
    }

    // Return transcription with any warnings
    return [...warnings, transcription].filter(Boolean).join("; ");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(msg);
  }
}

/**
 * Runs a single STT attempt under a per-attempt timeout. A hung provider that
 * never resolves is turned into a THROW (so the orchestrator can fail over).
 */
async function attemptSTT(
  attempt: STTAttempt,
  audio: File | Blob,
  timeoutMs: number = DEFAULT_STT_TIMEOUT_MS
): Promise<string> {
  // Per-attempt controller: primary and fallback each get their own, so
  // aborting a timed-out primary never touches the fallback request.
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Cancel the still-in-flight request BEFORE we fail over. Without this the
      // slow-but-successful primary would keep running (and billing) and could
      // double-charge alongside the fallback.
      controller.abort();
      reject(
        new Error(
          `Speech transcription timed out (${Math.round(timeoutMs / 1000)}s)`
        )
      );
    }, timeoutMs);
  });

  try {
    // A normal success or throw settles the race first; the timer is cleared in
    // `finally` and `controller.abort()` is never called, so nothing is
    // cancelled prematurely.
    return await Promise.race([
      performSTT(attempt, audio, controller.signal),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Whether a fallback attempt is an EXACT duplicate of the primary: same provider
 * id AND identical variables. The same provider with a different API key is NOT
 * a duplicate (a legitimate backup key for quota exhaustion).
 */
function isExactDuplicate(
  primary: STTAttempt["selectedProvider"],
  fallback: STTAttempt["selectedProvider"]
): boolean {
  return (
    primary.provider === fallback.provider &&
    canonicalStringify(primary.variables) ===
      canonicalStringify(fallback.variables)
  );
}

/**
 * Transcribes audio and returns the transcription (or a warning/empty sentinel)
 * as a single string.
 *
 * Orchestration: try the primary provider. If it THROWS and a distinct fallback
 * is configured, silently try the fallback. If the fallback also throws, the
 * PRIMARY's error is rethrown (the fallback error is logged, not surfaced). With
 * no fallback configured, behaviour is identical to before this feature existed.
 *
 * A returned string — including "No transcription found" on silent audio — is
 * SUCCESS and never triggers failover, so silent audio never double-charges.
 */
export async function fetchSTT(params: STTParams): Promise<string> {
  const { provider, selectedProvider, audio, fallback, timeoutMs } = params;

  try {
    return await attemptSTT({ provider, selectedProvider }, audio, timeoutMs);
  } catch (primaryError) {
    const hasUsableFallback =
      !!fallback && !!fallback.selectedProvider.provider && !!fallback.provider;

    if (
      !hasUsableFallback ||
      isExactDuplicate(selectedProvider, fallback!.selectedProvider)
    ) {
      // No fallback (unchanged legacy behaviour) or a redundant duplicate:
      // surface the primary error as-is.
      throw primaryError;
    }

    console.info(
      "[stt] primary provider failed; attempting fallback provider"
    );

    try {
      return await attemptSTT(
        {
          provider: fallback!.provider,
          selectedProvider: fallback!.selectedProvider,
        },
        audio,
        timeoutMs
      );
    } catch (fallbackError) {
      // Both failed. Surface the PRIMARY's error (the provider the user chose as
      // their main one); log the fallback error for diagnostics only.
      console.warn(
        "[stt] fallback provider also failed:",
        fallbackError instanceof Error
          ? fallbackError.message
          : String(fallbackError)
      );
      throw primaryError;
    }
  }
}
