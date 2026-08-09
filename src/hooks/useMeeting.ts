import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useApp as useAppContext } from "@/contexts";
import { fetchSTT } from "@/lib/functions";
import { MEETING } from "@/config/meeting.constants";
import {
  MeetingBrief,
  MeetingPhase,
  MeetingRecord,
  MeetingSignal,
  MeetingTurn,
  MeetingTurnSource,
  MeetingWarnings,
} from "@/types/meeting";
import {
  TranscriptBuffer,
  renderTranscriptWindow,
  wordCount,
} from "@/lib/meeting/transcript";
import {
  collectModelText,
  parseSignals,
  signalDedupeKey,
} from "@/lib/meeting/analysis";
import {
  ANALYSIS_SYSTEM_PROMPT,
  ONDEMAND_SYSTEM_PROMPT,
  RECAP_SYSTEM_PROMPT,
  buildAnalysisUserMessage,
  buildOnDemandUserMessage,
  buildRecapUserMessage,
} from "@/lib/meeting/prompts";
import { loadOrBuildBrief } from "@/lib/meeting/brief";
import {
  folderDisplayName,
  pickProjectFolder,
} from "@/lib/meeting/context-reader";
import {
  createMeeting,
  finishMeeting,
  saveSignal,
  saveTurn,
} from "@/lib/database/meeting.action";
import {
  getAnalysisModel,
  getMeetingFolder,
  setMeetingFolder,
} from "@/lib/storage/analysis-provider";
import { pinWindowHeight } from "./useWindow";
import { floatArrayToWav } from "@/lib/utils";

const DEFAULT_MEETING_VAD = {
  enabled: true,
  hop_size: 1024,
  sensitivity_rms: 0.012,
  peak_threshold: 0.035,
  silence_chunks: 45,
  min_speech_chunks: 7,
  pre_speech_chunks: 12,
  noise_gate_threshold: 0.003,
  max_recording_duration_secs: 180,
};

const EMPTY_WARNINGS: MeetingWarnings = {
  micUnavailable: false,
  contextUnavailable: false,
  analysisPaused: false,
  transcriptionFailing: false,
  noAudio: false,
};

export type UseMeetingReturn = ReturnType<typeof useMeeting>;

/**
 * Meeting Intelligence orchestration.
 *
 * Owns the meeting lifecycle: both capture streams, turn ordering, the analysis
 * loop, and persistence. The defining behaviour is that it stays SILENT — most
 * turns produce no signal, and an empty panel is the healthy state.
 *
 * The microphone stream is not started here: `useMicVAD` is a hook and cannot be
 * mounted conditionally, so `MeetingMicCapture` owns it and feeds utterances in
 * through `ingestMicUtterance`.
 */
export function useMeeting() {
  const {
    selectedSttProvider,
    selectedSttFallbackProvider,
    allSttProviders,
    selectedAIProvider,
    allAiProviders,
    selectedAudioDevices,
  } = useAppContext();

  const [phase, setPhase] = useState<MeetingPhase>("idle");
  const [turns, setTurns] = useState<MeetingTurn[]>([]);
  const [signals, setSignals] = useState<MeetingSignal[]>([]);
  const [warnings, setWarnings] = useState<MeetingWarnings>(EMPTY_WARNINGS);
  const [folderPath, setFolderPath] = useState<string | null>(() =>
    getMeetingFolder()
  );
  const [brief, setBrief] = useState<MeetingBrief | null>(null);
  const [briefStatus, setBriefStatus] = useState<
    "none" | "loading" | "ready" | "error"
  >("none");
  const [briefMessage, setBriefMessage] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [recap, setRecap] = useState<string | null>(null);
  const [onDemandText, setOnDemandText] = useState<string>("");
  const [onDemandActive, setOnDemandActive] = useState(false);

  const bufferRef = useRef<TranscriptBuffer | null>(null);
  const meetingIdRef = useRef<string>("");
  const startedAtRef = useRef<number>(0);
  const phaseRef = useRef<MeetingPhase>("idle");
  const briefRef = useRef<MeetingBrief | null>(null);
  const analysisInFlightRef = useRef(false);
  const analysisQueuedRef = useRef(false);
  const consecutiveFailuresRef = useRef(0);
  const sttFailuresRef = useRef(0);
  const lastAudioAtRef = useRef<number>(0);
  const seenSignalsRef = useRef<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    briefRef.current = brief;
  }, [brief]);

  const isLive = phase === "live";

  /** Mirror the buffer into React state so the transcript re-renders. */
  const syncTurns = useCallback(() => {
    if (bufferRef.current) setTurns(bufferRef.current.list());
  }, []);

  /* ------------------------------------------------------------- providers */

  const mainTarget = useCallback(() => {
    const provider = allAiProviders.find(
      (p) => p.id === selectedAIProvider.provider
    );
    return { provider, selection: selectedAIProvider };
  }, [allAiProviders, selectedAIProvider]);

  /**
   * The hot path runs on the main provider's credentials with `MODEL` swapped
   * for the cheaper analysis model. With no override configured this is exactly
   * the main target, so meetings work before the setting is ever touched.
   */
  const analysisTarget = useCallback(() => {
    const base = mainTarget();
    const model = getAnalysisModel();
    if (!model) return base;

    return {
      provider: base.provider,
      selection: {
        provider: base.selection.provider,
        variables: { ...base.selection.variables, MODEL: model },
      },
    };
  }, [mainTarget]);

  /* ----------------------------------------------------------------- brief */

  const refreshBrief = useCallback(
    async (path: string) => {
      setBriefStatus("loading");
      setBriefMessage(null);

      const { provider, selection } = analysisTarget();
      const result = await loadOrBuildBrief({
        folderPath: path,
        provider,
        selectedProvider: selection,
      });

      if (result.brief) {
        setBrief(result.brief);
        setBriefStatus("ready");
        setBriefMessage(
          result.skipped.length > 0
            ? `${result.skipped.length} file(s) skipped`
            : null
        );
        setWarnings((w) => ({ ...w, contextUnavailable: false }));
      } else {
        setBrief(null);
        setBriefStatus("error");
        setBriefMessage(result.error);
        setWarnings((w) => ({ ...w, contextUnavailable: true }));
      }
    },
    [analysisTarget]
  );

  const chooseFolder = useCallback(async () => {
    try {
      const picked = await pickProjectFolder();
      if (!picked) return;
      setFolderPath(picked);
      setMeetingFolder(picked);
      await refreshBrief(picked);
    } catch (error) {
      console.error("Failed to choose project folder:", error);
      setBriefStatus("error");
      setBriefMessage("Folder picker unavailable.");
    }
  }, [refreshBrief]);

  const clearFolder = useCallback(() => {
    setFolderPath(null);
    setMeetingFolder(null);
    setBrief(null);
    setBriefStatus("none");
    setBriefMessage(null);
  }, []);

  // Load the brief for a remembered folder once, at rest — so starting a
  // meeting does not pay for distillation.
  useEffect(() => {
    if (folderPath && briefStatus === "none") {
      refreshBrief(folderPath);
    }
    // Intentionally runs only when the remembered folder first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderPath]);

  /* ------------------------------------------------------------- analysis */

  const runAnalysis = useCallback(async () => {
    const buffer = bufferRef.current;
    if (!buffer || phaseRef.current !== "live") return;

    if (analysisInFlightRef.current) {
      // Coalesce: whatever arrives during a request joins the next one instead
      // of firing its own. Rapid back-and-forth costs fewer calls, not more.
      analysisQueuedRef.current = true;
      return;
    }

    const batch = buffer.drainForAnalysis(Date.now());
    if (batch.length === 0) return;

    const substantive = batch.filter(
      (t) => wordCount(t.text) >= MEETING.MIN_WORDS_FOR_ANALYSIS
    );
    if (substantive.length === 0) return;

    // Claim the slot BEFORE the first await. Resolving the provider is async,
    // and without this a second caller entering during that await would pass
    // the in-flight check and fire a duplicate request for the same turns.
    analysisInFlightRef.current = true;

    try {
      const { provider, selection } = analysisTarget();
      if (!provider) return;

      const windowTurns = buffer
        .emittedTurns()
        .filter((t) => !substantive.some((s) => s.id === t.id));

      const result = await collectModelText({
        provider,
        selectedProvider: selection,
        systemPrompt: ANALYSIS_SYSTEM_PROMPT,
        userMessage: buildAnalysisUserMessage({
          brief: briefRef.current?.content ?? null,
          windowTurns,
          newTurns: substantive,
        }),
        signal: abortRef.current?.signal,
      });

      if (phaseRef.current !== "live") return;

      const parsed = result.failed ? null : parseSignals(result.text);

      if (parsed === null) {
        // Unparseable or errored. Individual failures stay silent because
        // silence is the normal output — but sustained breakage would be
        // misread as "nothing to flag", so it surfaces after a few in a row.
        consecutiveFailuresRef.current += 1;
        if (
          consecutiveFailuresRef.current >= MEETING.CONSECUTIVE_FAILURE_LIMIT
        ) {
          setWarnings((w) => ({ ...w, analysisPaused: true }));
        }
        return;
      }

      consecutiveFailuresRef.current = 0;
      setWarnings((w) =>
        w.analysisPaused ? { ...w, analysisPaused: false } : w
      );

      const anchorTurn = substantive[substantive.length - 1];
      const fresh: MeetingSignal[] = [];

      for (const candidate of parsed) {
        const key = signalDedupeKey(candidate.kind, candidate.headline);
        if (seenSignalsRef.current.has(key)) continue;
        seenSignalsRef.current.add(key);

        fresh.push({
          id: `sig-${crypto.randomUUID()}`,
          meetingId: meetingIdRef.current,
          turnId: anchorTurn?.id ?? null,
          kind: candidate.kind,
          headline: candidate.headline,
          detail: candidate.detail,
          confidence: candidate.confidence,
          createdAt: Date.now(),
          dismissedAt: null,
        });
      }

      if (fresh.length > 0) {
        setSignals((prev) => [...fresh, ...prev]);
        for (const signal of fresh) {
          saveSignal(signal).catch(() => {});
        }
      }
    } finally {
      analysisInFlightRef.current = false;
      if (analysisQueuedRef.current && phaseRef.current === "live") {
        analysisQueuedRef.current = false;
        void runAnalysis();
      }
    }
  }, [analysisTarget]);

  /* -------------------------------------------------------------- capture */

  const transcribe = useCallback(
    async (audio: Blob, source: MeetingTurnSource, capturedAt: number) => {
      const buffer = bufferRef.current;
      if (!buffer || phaseRef.current !== "live") return;

      const providerConfig = allSttProviders.find(
        (p) => p.id === selectedSttProvider.provider
      );
      if (!providerConfig) return;

      const fallbackConfig = selectedSttFallbackProvider.provider
        ? allSttProviders.find(
            (p) => p.id === selectedSttFallbackProvider.provider
          )
        : undefined;

      const turnId = `turn-${crypto.randomUUID()}`;
      const opened = buffer.open(turnId, source, capturedAt);
      syncTurns();
      saveTurn(opened).catch(() => {});

      try {
        const text = await fetchSTT({
          provider: providerConfig,
          selectedProvider: selectedSttProvider,
          audio,
          fallback: fallbackConfig
            ? {
                provider: fallbackConfig,
                selectedProvider: selectedSttFallbackProvider,
              }
            : undefined,
        });
        const resolved = buffer.resolve(turnId, text);
        if (resolved) saveTurn(resolved).catch(() => {});

        if (resolved?.status === "final") {
          sttFailuresRef.current = 0;
          setWarnings((w) =>
            w.transcriptionFailing ? { ...w, transcriptionFailing: false } : w
          );
        }
      } catch (error) {
        console.warn(
          "Meeting transcription failed:",
          error instanceof Error ? error.name : "unknown error"
        );
        const failedTurn = buffer.fail(turnId);
        if (failedTurn) saveTurn(failedTurn).catch(() => {});

        // A transcript filling with "not transcribed" and no explanation is the
        // same silent-failure trap as a blank signal panel. Say it out loud.
        sttFailuresRef.current += 1;
        if (sttFailuresRef.current >= MEETING.CONSECUTIVE_FAILURE_LIMIT) {
          setWarnings((w) =>
            w.transcriptionFailing ? w : { ...w, transcriptionFailing: true }
          );
        }
      } finally {
        syncTurns();
        void runAnalysis();
      }
    },
    [
      allSttProviders,
      selectedSttProvider,
      selectedSttFallbackProvider,
      syncTurns,
      runAnalysis,
    ]
  );

  /** Called by MeetingMicCapture when the browser VAD closes an utterance. */
  const ingestMicUtterance = useCallback(
    (audio: Float32Array, capturedAt: number) => {
      lastAudioAtRef.current = Date.now();
      const blob = floatArrayToWav(audio, 16000, "wav");
      void transcribe(blob, "mic", capturedAt);
    },
    [transcribe]
  );

  const reportMicUnavailable = useCallback((unavailable: boolean) => {
    setWarnings((w) =>
      w.micUnavailable === unavailable
        ? w
        : { ...w, micUnavailable: unavailable }
    );
  }, []);

  // `transcribe` is reached through a ref so the listener below can subscribe
  // exactly once. Depending on it directly would tear the subscription down and
  // rebuild it whenever a provider changes, and because `listen` is async there
  // is a window in that gap where captured speech is silently dropped.
  const transcribeRef = useRef(transcribe);
  useEffect(() => {
    transcribeRef.current = transcribe;
  }, [transcribe]);

  // System-audio utterances. Subscribed for the hook's whole life and gated on
  // the phase ref, so the listener is never torn down and rebuilt mid-meeting.
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen("speech-detected", (event) => {
      if (phaseRef.current !== "live") return;

      // Stamped HERE, before transcription, because completion order does not
      // reflect the order things were actually said.
      const capturedAt = Date.now();
      lastAudioAtRef.current = capturedAt;

      try {
        const binary = atob(event.payload as string);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        void transcribeRef.current(
          new Blob([bytes], { type: "audio/wav" }),
          "system",
          capturedAt
        );
      } catch (error) {
        console.warn("Failed to decode system audio chunk:", error);
      }
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((error) =>
        console.error("Failed to listen for system audio:", error)
      );

    return () => {
      unlisten?.();
    };
  }, []);

  /* ---------------------------------------------------------- housekeeping */

  // One timer drives the work that is not event-driven: turns held back by the
  // ordering rule whose grace period has now expired, and the silence warning.
  useEffect(() => {
    if (!isLive) return;

    const interval = setInterval(() => {
      void runAnalysis();

      const silentFor = Date.now() - lastAudioAtRef.current;
      const silent = silentFor > MEETING.NO_AUDIO_WARNING_MS;
      setWarnings((w) => (w.noAudio === silent ? w : { ...w, noAudio: silent }));
    }, 1000);

    return () => clearInterval(interval);
  }, [isLive, runAnalysis]);

  /* ------------------------------------------------------------- lifecycle */

  const start = useCallback(async () => {
    if (phaseRef.current !== "idle") return;

    setStartError(null);
    setRecap(null);
    setOnDemandText("");
    setSignals([]);
    setWarnings(EMPTY_WARNINGS);
    seenSignalsRef.current = new Set();
    consecutiveFailuresRef.current = 0;
    sttFailuresRef.current = 0;
    analysisInFlightRef.current = false;
    analysisQueuedRef.current = false;
    setPhase("starting");
    phaseRef.current = "starting";

    if (!selectedSttProvider.provider) {
      setStartError("Select a speech-to-text provider before starting.");
      setPhase("idle");
      phaseRef.current = "idle";
      return;
    }

    try {
      const hasAccess = await invoke<boolean>("check_system_audio_access");
      if (!hasAccess) {
        setStartError(
          "System audio access is not granted. Grant it in the audio settings, then start again."
        );
        setPhase("idle");
        phaseRef.current = "idle";
        return;
      }

      // Clear any capture left running by another mode before claiming it.
      await invoke("stop_system_audio_capture").catch(() => {});

      const deviceId =
        selectedAudioDevices.output.id &&
        selectedAudioDevices.output.id !== "default"
          ? selectedAudioDevices.output.id
          : null;

      await invoke("start_system_audio_capture", {
        vadConfig: DEFAULT_MEETING_VAD,
        deviceId,
      });
    } catch (error) {
      setStartError(
        error instanceof Error ? error.message : "Could not start audio capture."
      );
      setPhase("idle");
      phaseRef.current = "idle";
      return;
    }

    const meetingId = `meeting-${crypto.randomUUID()}`;
    const startedAt = Date.now();
    meetingIdRef.current = meetingId;
    startedAtRef.current = startedAt;
    bufferRef.current = new TranscriptBuffer(meetingId);
    lastAudioAtRef.current = startedAt;
    abortRef.current = new AbortController();
    setTurns([]);

    const record: MeetingRecord = {
      id: meetingId,
      title: folderPath ? folderDisplayName(folderPath) : "Meeting",
      folderPath,
      briefId: brief?.id ?? null,
      startedAt,
      endedAt: null,
      recap: null,
    };
    createMeeting(record).catch((error) =>
      console.warn("Failed to create meeting record:", error)
    );

    if (!brief) {
      setWarnings((w) => ({ ...w, contextUnavailable: true }));
    }

    setPhase("live");
    phaseRef.current = "live";
  }, [
    brief,
    folderPath,
    selectedAudioDevices.output.id,
    selectedSttProvider.provider,
  ]);

  const end = useCallback(async () => {
    if (phaseRef.current !== "live") return;

    setPhase("ending");
    phaseRef.current = "ending";

    await invoke("stop_system_audio_capture").catch(() => {});

    const buffer = bufferRef.current;
    const finalTurns = buffer ? buffer.finalTurns() : [];
    const meetingId = meetingIdRef.current;
    const title = folderPath ? folderDisplayName(folderPath) : "Meeting";

    let generatedRecap: string | null = null;

    if (finalTurns.length > 0) {
      const { provider, selection } = mainTarget();
      if (provider) {
        const result = await collectModelText({
          provider,
          selectedProvider: selection,
          systemPrompt: RECAP_SYSTEM_PROMPT,
          userMessage: buildRecapUserMessage({
            brief: briefRef.current?.content ?? null,
            turns: finalTurns,
          }),
        });
        if (!result.failed) generatedRecap = result.text;
      }
    }

    setRecap(generatedRecap);
    finishMeeting({
      id: meetingId,
      title,
      endedAt: Date.now(),
      recap: generatedRecap,
    }).catch((error) =>
      console.warn("Failed to finalize meeting record:", error)
    );

    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("idle");
    phaseRef.current = "idle";
  }, [folderPath, mainTarget]);

  /* ------------------------------------------------------------- on demand */

  /**
   * The "what do I say back" hotkey. Uses the MAIN chat model, not the cheap
   * analysis one — the user only pays when they ask, and quality matters more
   * than latency here because they control the timing.
   */
  const requestOnDemand = useCallback(async () => {
    if (phaseRef.current !== "live" || onDemandActive) return;

    const buffer = bufferRef.current;
    if (!buffer) return;

    const { provider, selection } = mainTarget();
    if (!provider) {
      setOnDemandText("No AI provider configured.");
      return;
    }

    setOnDemandActive(true);
    setOnDemandText("");

    const result = await collectModelText({
      provider,
      selectedProvider: selection,
      systemPrompt: ONDEMAND_SYSTEM_PROMPT,
      userMessage: buildOnDemandUserMessage({
        brief: briefRef.current?.content ?? null,
        turns: buffer.finalTurns(),
      }),
      signal: abortRef.current?.signal,
      onChunk: (chunk) => setOnDemandText((prev) => prev + chunk),
    });

    if (result.failed) {
      setOnDemandText(result.text || "Could not get an answer.");
    }
    setOnDemandActive(false);
  }, [mainTarget, onDemandActive]);

  const dismissOnDemand = useCallback(() => {
    setOnDemandText("");
  }, []);

  const dismissSignal = useCallback((id: string) => {
    setSignals((prev) => {
      const target = prev.find((s) => s.id === id);
      if (target) {
        saveSignal({ ...target, dismissedAt: Date.now() }).catch(() => {});
      }
      return prev.filter((s) => s.id !== id);
    });
  }, []);

  const dismissRecap = useCallback(() => setRecap(null), []);

  /**
   * The panel owns the window height for as long as it is on screen — through
   * `starting`, the live meeting, and the recap that follows. Deriving it from
   * one piece of state keeps the window from snapping shut on any path out of
   * a meeting, including the error paths.
   */
  const panelOpen = phase !== "idle" || recap !== null;
  const hasPinnedRef = useRef(false);
  useEffect(() => {
    // Skip the initial closed state: releasing a pin that was never taken would
    // fire a pointless resize on every app start.
    if (!panelOpen && !hasPinnedRef.current) return;
    hasPinnedRef.current = panelOpen;
    void pinWindowHeight(panelOpen ? MEETING.WINDOW_HEIGHT : null);
  }, [panelOpen]);

  /** Plain-text transcript for the copy-out button. */
  const transcriptText = useCallback(() => {
    const buffer = bufferRef.current;
    if (!buffer) return "";
    return renderTranscriptWindow(
      buffer.finalTurns(),
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER
    );
  }, []);

  // Stop capture if the window tears down mid-meeting, so the microphone and
  // system audio are not left running after the UI is gone.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (phaseRef.current === "live") {
        invoke("stop_system_audio_capture").catch(() => {});
        void pinWindowHeight(null);
      }
    };
  }, []);

  return {
    phase,
    isLive,
    turns,
    signals,
    warnings,
    startError,
    recap,
    folderPath,
    folderName: folderPath ? folderDisplayName(folderPath) : null,
    brief,
    briefStatus,
    briefMessage,
    onDemandText,
    onDemandActive,
    startedAt: startedAtRef.current,
    start,
    end,
    chooseFolder,
    clearFolder,
    refreshBrief,
    requestOnDemand,
    dismissOnDemand,
    dismissSignal,
    dismissRecap,
    transcriptText,
    ingestMicUtterance,
    reportMicUnavailable,
  };
}
