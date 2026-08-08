import { useEffect } from "react";
import { useMicVAD } from "@ricky0123/vad-react";

interface MeetingMicCaptureProps {
  microphoneDeviceId?: string;
  onUtterance: (audio: Float32Array, capturedAt: number) => void;
  onUnavailable: (unavailable: boolean) => void;
}

/**
 * Headless microphone capture for a live meeting — the "You" side of the
 * transcript.
 *
 * `useMicVAD` is a hook and cannot be started and stopped conditionally, so
 * this component exists purely to scope its lifetime: mount it while the
 * meeting is live, unmount it to release the microphone. It renders nothing.
 */
const MeetingMicCaptureInternal = ({
  microphoneDeviceId,
  onUtterance,
  onUnavailable,
}: MeetingMicCaptureProps) => {
  const audioConstraints: MediaTrackConstraints =
    microphoneDeviceId && microphoneDeviceId !== "default"
      ? { deviceId: { exact: microphoneDeviceId } }
      : {};

  const vad = useMicVAD({
    startOnLoad: true,
    userSpeakingThreshold: 0.6,
    additionalAudioConstraints: audioConstraints,
    onSpeechEnd: (audio) => {
      // Stamped before any transcription work, because the two capture streams
      // resolve at different speeds and completion order is not speech order.
      onUtterance(audio, Date.now());
    },
  });

  const errored = (vad as { errored?: unknown }).errored;

  // A denied or missing microphone must not fail the meeting — it degrades to
  // Speaker-only, and the panel says so rather than quietly recording one side.
  useEffect(() => {
    onUnavailable(Boolean(errored));
  }, [errored, onUnavailable]);

  useEffect(() => {
    return () => {
      try {
        vad.pause();
      } catch {
        // Already torn down; releasing twice is harmless.
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
};

export const MeetingMicCapture = (props: MeetingMicCaptureProps) => (
  // Remount on device change so the VAD picks up the new input.
  <MeetingMicCaptureInternal key={props.microphoneDeviceId ?? "default"} {...props} />
);
