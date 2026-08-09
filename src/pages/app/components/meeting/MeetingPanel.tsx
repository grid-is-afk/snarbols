import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  HelpCircleIcon,
  LoaderCircleIcon,
  MessageSquareQuoteIcon,
  XIcon,
} from "lucide-react";
import { Button, CopyButton, ScrollArea } from "@/components";
import { MEETING_SIGNAL_LABELS } from "@/config/meeting.constants";
import { MeetingSignalKind, MeetingTurn } from "@/types/meeting";
import { speakerLabel } from "@/lib/meeting/transcript";
import { UseMeetingReturn } from "@/hooks/useMeeting";

const SIGNAL_ICONS: Record<MeetingSignalKind, typeof AlertTriangleIcon> = {
  scope: AlertTriangleIcon,
  suggestion: MessageSquareQuoteIcon,
  question: HelpCircleIcon,
  commitment: CheckCircle2Icon,
};

const SIGNAL_TONES: Record<MeetingSignalKind, string> = {
  scope: "text-amber-500",
  suggestion: "text-sky-500",
  question: "text-violet-500",
  commitment: "text-emerald-500",
};

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

const TranscriptLine = ({ turn }: { turn: MeetingTurn }) => {
  const isYou = turn.source === "mic";

  if (turn.status === "pending") {
    return (
      <div className="flex gap-2 text-xs opacity-40">
        <span className="w-14 shrink-0 font-medium">
          {speakerLabel(turn.source)}
        </span>
        <span className="italic">transcribing…</span>
      </div>
    );
  }

  if (turn.status === "failed") {
    return (
      <div className="flex gap-2 text-xs opacity-40">
        <span className="w-14 shrink-0 font-medium">
          {speakerLabel(turn.source)}
        </span>
        <span className="italic">— not transcribed —</span>
      </div>
    );
  }

  return (
    <div className="flex gap-2 text-xs">
      <span
        className={`w-14 shrink-0 font-medium ${
          isYou ? "text-primary" : "text-muted-foreground"
        }`}
      >
        {speakerLabel(turn.source)}
      </span>
      <span className="leading-relaxed">{turn.text}</span>
    </div>
  );
};

export const MeetingPanel = (meeting: UseMeetingReturn) => {
  const {
    phase,
    turns,
    signals,
    warnings,
    recap,
    folderName,
    onDemandText,
    onDemandActive,
    startedAt,
    end,
    requestOnDemand,
    dismissOnDemand,
    dismissSignal,
    dismissRecap,
    transcriptText,
  } = meeting;

  const [now, setNow] = useState(() => Date.now());
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (phase !== "live") return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [phase]);

  // Follow the conversation as it arrives.
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ block: "end" });
  }, [turns.length]);

  const activeWarnings = useMemo(() => {
    const list: string[] = [];
    if (warnings.noAudio)
      list.push("No audio detected for 2 minutes — check your meeting output.");
    if (warnings.micUnavailable)
      list.push("Microphone unavailable — your side is not being captured.");
    if (warnings.transcriptionFailing)
      list.push(
        "Speech-to-text is failing — check the STT provider and your key."
      );
    if (warnings.analysisPaused)
      list.push("Analysis paused after repeated failures — check the provider.");
    if (warnings.contextUnavailable)
      list.push("Running without project context.");
    return list;
  }, [warnings]);

  if (recap) {
    return (
      <div className="flex h-full w-full flex-col gap-2 p-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide">
            Meeting record
          </span>
          <div className="flex items-center gap-1">
            <CopyButton content={recap} />
            <Button
              size="icon"
              variant="ghost"
              onClick={dismissRecap}
              title="Close"
              aria-label="Close meeting record"
            >
              <XIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <ScrollArea className="flex-1 rounded-md border p-3">
          <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed">
            {recap}
          </pre>
        </ScrollArea>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2 text-xs">
          {phase === "live" ? (
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500" />
          ) : (
            <LoaderCircleIcon className="h-3 w-3 animate-spin" />
          )}
          <span className="font-medium tabular-nums">
            {phase === "live" ? formatElapsed(now - startedAt) : "starting…"}
          </span>
          {folderName ? (
            <span className="max-w-[180px] truncate text-muted-foreground">
              {folderName}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="secondary"
            onClick={requestOnDemand}
            disabled={phase !== "live" || onDemandActive}
            title="Answer the last thing said"
          >
            {onDemandActive ? (
              <LoaderCircleIcon className="h-3 w-3 animate-spin" />
            ) : (
              "What do I say?"
            )}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={end}
            disabled={phase !== "live"}
          >
            End
          </Button>
        </div>
      </div>

      {activeWarnings.length > 0 ? (
        <div className="border-b bg-amber-500/10 px-3 py-1.5">
          {activeWarnings.map((warning) => (
            <p key={warning} className="text-[11px] text-amber-600">
              {warning}
            </p>
          ))}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_240px] divide-x">
        <ScrollArea className="min-h-0 p-3">
          <div className="flex flex-col gap-2">
            {turns.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Listening. Nothing said yet.
              </p>
            ) : (
              turns.map((turn) => <TranscriptLine key={turn.id} turn={turn} />)
            )}
            <div ref={transcriptEndRef} />
          </div>
        </ScrollArea>

        <ScrollArea className="min-h-0 p-3">
          {signals.length === 0 ? (
            // An unexplained blank panel is exactly what made the old mode
            // confusing. Empty is the healthy state, so it says so.
            <p className="text-xs text-muted-foreground">
              Watching — nothing to flag.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {signals.map((signal) => {
                const Icon = SIGNAL_ICONS[signal.kind];
                return (
                  <div key={signal.id} className="group flex flex-col gap-1">
                    <div className="flex items-center gap-1.5">
                      <Icon
                        className={`h-3 w-3 shrink-0 ${
                          SIGNAL_TONES[signal.kind]
                        }`}
                      />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {MEETING_SIGNAL_LABELS[signal.kind]}
                      </span>
                      <button
                        onClick={() => dismissSignal(signal.id)}
                        className="ml-auto opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
                        title="Dismiss"
                        aria-label={`Dismiss ${signal.headline}`}
                      >
                        <XIcon className="h-3 w-3" />
                      </button>
                    </div>
                    <p className="text-xs font-medium leading-snug">
                      {signal.headline}
                    </p>
                    {signal.detail ? (
                      <p className="text-[11px] leading-snug text-muted-foreground">
                        {signal.detail}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      {onDemandText ? (
        <div className="border-t bg-muted/40 px-3 py-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Your answer
            </span>
            <div className="flex items-center gap-1">
              <CopyButton content={onDemandText} />
              <button
                onClick={dismissOnDemand}
                className="opacity-60 hover:opacity-100"
                aria-label="Dismiss answer"
              >
                <XIcon className="h-3 w-3" />
              </button>
            </div>
          </div>
          <p className="max-h-24 overflow-y-auto text-xs leading-relaxed">
            {onDemandText}
          </p>
        </div>
      ) : null}

      <div className="flex items-center justify-between border-t px-3 py-1">
        <span className="text-[10px] text-muted-foreground">
          Wear headphones — speaker audio reaching your mic duplicates every turn.
        </span>
        <CopyButton content={transcriptText()} />
      </div>
    </div>
  );
};
