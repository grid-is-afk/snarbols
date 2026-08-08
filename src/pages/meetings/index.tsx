import { useCallback, useEffect, useState } from "react";
import moment from "moment";
import { PresentationIcon, Trash2Icon } from "lucide-react";
import { Button, Card, CopyButton, ScrollArea } from "@/components";
import { PageLayout } from "@/layouts";
import {
  deleteMeeting,
  getAllMeetings,
  getSignalsForMeeting,
  getTurnsForMeeting,
} from "@/lib/database/meeting.action";
import { MeetingRecord, MeetingSignal, MeetingTurn } from "@/types/meeting";
import { MEETING_SIGNAL_LABELS } from "@/config/meeting.constants";
import { speakerLabel } from "@/lib/meeting/transcript";

interface MeetingDetail {
  turns: MeetingTurn[];
  signals: MeetingSignal[];
}

/**
 * Saved meeting records: recap, signals and full transcript.
 *
 * Turns are written as they finalize during a meeting, so a session that
 * crashed still appears here with everything it heard — only the recap is
 * missing, and that can be regenerated from the transcript.
 */
const Meetings = () => {
  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MeetingDetail | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setMeetings(await getAllMeetings());
    } catch (error) {
      console.error("Failed to load meetings:", error);
      setLoadError("Could not load saved meetings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const [turns, signals] = await Promise.all([
          getTurnsForMeeting(selectedId),
          getSignalsForMeeting(selectedId),
        ]);
        if (!cancelled) setDetail({ turns, signals });
      } catch (error) {
        console.error("Failed to load meeting detail:", error);
        if (!cancelled) setDetail({ turns: [], signals: [] });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const selected = meetings.find((m) => m.id === selectedId) ?? null;

  const transcriptText = (detail?.turns ?? [])
    .filter((t) => t.status === "final")
    .map((t) => `${speakerLabel(t.source)}: ${t.text}`)
    .join("\n");

  const handleDelete = async (id: string) => {
    try {
      await deleteMeeting(id);
      if (selectedId === id) setSelectedId(null);
      await refresh();
    } catch (error) {
      console.error("Failed to delete meeting:", error);
    }
  };

  return (
    <PageLayout title="Meetings" description="Records from past meetings">
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : loadError ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : meetings.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <PresentationIcon className="size-8 text-muted-foreground" />
          <p className="text-sm font-medium">No meetings yet</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Start one from the bar. Point it at a project folder first so it can
            tell when a request falls outside your scope.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-[240px_1fr] gap-4">
          <ScrollArea className="max-h-[70vh]">
            <div className="flex flex-col gap-1 pr-2">
              {meetings.map((meeting) => (
                <button
                  key={meeting.id}
                  onClick={() => setSelectedId(meeting.id)}
                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                    meeting.id === selectedId
                      ? "border-primary bg-muted"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <p className="truncate text-xs font-medium">
                    {meeting.title}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {moment(meeting.startedAt).format("MMM D, HH:mm")}
                    {meeting.endedAt
                      ? ` · ${Math.max(
                          1,
                          Math.round(
                            (meeting.endedAt - meeting.startedAt) / 60000
                          )
                        )} min`
                      : " · interrupted"}
                  </p>
                </button>
              ))}
            </div>
          </ScrollArea>

          <Card className="min-h-[320px] p-4">
            {!selected ? (
              <p className="text-xs text-muted-foreground">
                Select a meeting to read its record.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold">{selected.title}</h2>
                    <p className="text-[10px] text-muted-foreground">
                      {moment(selected.startedAt).format("dddd, MMMM D YYYY")}
                      {selected.folderPath ? ` · ${selected.folderPath}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {selected.recap ? (
                      <CopyButton content={selected.recap} />
                    ) : null}
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleDelete(selected.id)}
                      title="Delete meeting"
                      aria-label="Delete meeting"
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  </div>
                </div>

                <section>
                  <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Record
                  </h3>
                  {selected.recap ? (
                    <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed">
                      {selected.recap}
                    </pre>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No record was generated — the meeting was interrupted
                      before it ended. The transcript below is still complete up
                      to that point.
                    </p>
                  )}
                </section>

                {detail && detail.signals.length > 0 ? (
                  <section>
                    <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Signals ({detail.signals.length})
                    </h3>
                    <div className="flex flex-col gap-2">
                      {detail.signals.map((signal) => (
                        <div key={signal.id} className="text-xs">
                          <span className="mr-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {MEETING_SIGNAL_LABELS[signal.kind]}
                          </span>
                          <span className="font-medium">{signal.headline}</span>
                          {signal.detail ? (
                            <p className="text-[11px] text-muted-foreground">
                              {signal.detail}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                <section>
                  <div className="mb-1 flex items-center justify-between">
                    <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Transcript
                    </h3>
                    {transcriptText ? (
                      <CopyButton content={transcriptText} />
                    ) : null}
                  </div>
                  <ScrollArea className="max-h-64 rounded-md border p-2">
                    {transcriptText ? (
                      <pre className="whitespace-pre-wrap font-sans text-[11px] leading-relaxed">
                        {transcriptText}
                      </pre>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Nothing was transcribed.
                      </p>
                    )}
                  </ScrollArea>
                </section>
              </div>
            )}
          </Card>
        </div>
      )}
    </PageLayout>
  );
};

export default Meetings;
