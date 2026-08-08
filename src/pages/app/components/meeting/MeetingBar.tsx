import {
  FolderOpenIcon,
  LoaderCircleIcon,
  PresentationIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components";
import { UseMeetingReturn } from "@/hooks/useMeeting";

interface MeetingBarProps {
  meeting: UseMeetingReturn;
  /** True while the legacy system-audio mode holds the capture device. */
  captureBusy: boolean;
}

/**
 * The idle-state control: start a meeting, and see which project folder is
 * loaded before you do.
 *
 * The folder state is deliberately visible here rather than buried in
 * settings — a meeting run without context behaves noticeably differently, and
 * that should be obvious before starting, not discovered afterwards.
 */
export const MeetingBar = ({ meeting, captureBusy }: MeetingBarProps) => {
  const { folderName, briefStatus, briefMessage, startError, chooseFolder, clearFolder, start } =
    meeting;

  const briefTitle = (() => {
    if (briefStatus === "loading") return "Reading project documents…";
    if (briefStatus === "error") return briefMessage ?? "Context unavailable";
    if (briefStatus === "ready")
      return briefMessage
        ? `Project context ready (${briefMessage})`
        : "Project context ready";
    return "Choose a project folder";
  })();

  return (
    <div className="flex items-center gap-1">
      <Button
        size="icon"
        onClick={start}
        disabled={captureBusy}
        title={
          captureBusy
            ? "Stop system audio capture before starting a meeting"
            : startError ?? "Start meeting"
        }
        aria-label="Start meeting"
      >
        <PresentationIcon className="h-4 w-4" />
      </Button>

      <Button
        size="icon"
        variant={briefStatus === "error" ? "destructive" : "ghost"}
        onClick={chooseFolder}
        title={briefTitle}
        aria-label="Choose project folder"
      >
        {briefStatus === "loading" ? (
          <LoaderCircleIcon className="h-4 w-4 animate-spin" />
        ) : (
          <FolderOpenIcon className="h-4 w-4" />
        )}
      </Button>

      {folderName ? (
        <div className="flex max-w-[120px] items-center gap-1 rounded-md bg-muted px-1.5 py-0.5">
          <span className="truncate text-[10px]" title={briefTitle}>
            {folderName}
          </span>
          <button
            onClick={clearFolder}
            className="shrink-0 opacity-50 hover:opacity-100"
            aria-label="Clear project folder"
          >
            <XIcon className="h-2.5 w-2.5" />
          </button>
        </div>
      ) : null}

      {startError ? (
        <span className="max-w-[200px] truncate text-[10px] text-destructive">
          {startError}
        </span>
      ) : null}
    </div>
  );
};
