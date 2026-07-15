import { Dispatch, SetStateAction } from "react";
import { ScreenshotConfig, TYPE_PROVIDER } from "@/types";
import { CursorType, CustomizableState } from "@/lib/storage";

export type IContextType = {
  systemPrompt: string;
  setSystemPrompt: Dispatch<SetStateAction<string>>;
  allAiProviders: TYPE_PROVIDER[];
  customAiProviders: TYPE_PROVIDER[];
  selectedAIProvider: {
    provider: string;
    variables: Record<string, string>;
  };
  onSetSelectedAIProvider: ({
    provider,
    variables,
  }: {
    provider: string;
    variables: Record<string, string>;
  }) => void;
  allSttProviders: TYPE_PROVIDER[];
  customSttProviders: TYPE_PROVIDER[];
  selectedSttProvider: {
    provider: string;
    variables: Record<string, string>;
  };
  onSetSelectedSttProvider: ({
    provider,
    variables,
  }: {
    provider: string;
    variables: Record<string, string>;
  }) => void;
  /**
   * Optional fallback STT provider. When the primary STT provider throws, the
   * transcription is retried against this provider automatically (silent to the
   * user). An empty `provider` string means no fallback is configured — in which
   * case STT behaves exactly as it did before the fallback feature existed.
   */
  selectedSttFallbackProvider: {
    provider: string;
    variables: Record<string, string>;
  };
  onSetSelectedSttFallbackProvider: ({
    provider,
    variables,
  }: {
    provider: string;
    variables: Record<string, string>;
  }) => void;
  screenshotConfiguration: ScreenshotConfig;
  setScreenshotConfiguration: React.Dispatch<
    React.SetStateAction<ScreenshotConfig>
  >;
  customizable: CustomizableState;
  toggleAppIconVisibility: (isVisible: boolean) => Promise<void>;
  toggleAlwaysOnTop: (isEnabled: boolean) => Promise<void>;
  toggleAutostart: (isEnabled: boolean) => Promise<void>;
  loadData: () => Promise<void>;
  hasActiveLicense: boolean;
  setHasActiveLicense: Dispatch<SetStateAction<boolean>>;
  getActiveLicenseStatus: () => Promise<void>;
  selectedAudioDevices: {
    input: { id: string; name: string };
    output: { id: string; name: string };
  };
  setSelectedAudioDevices: Dispatch<
    SetStateAction<{
      input: { id: string; name: string };
      output: { id: string; name: string };
    }>
  >;
  setCursorType: (type: CursorType) => void;
  supportsImages: boolean;
  setSupportsImages: (value: boolean) => void;
  /**
   * Whether the OS encryption-at-rest keychain is available. `false` means the
   * app is running in passthrough mode (API keys stored unencrypted).
   */
  vaultAvailable: boolean;
  /**
   * Whether at least one already-encrypted (`enc:v1:`) value failed to decrypt
   * on the last load — i.e. the OS secure storage changed and previously-saved
   * API keys can no longer be unlocked. Distinct from `vaultAvailable === false`
   * (passthrough): the vault reports available, but our own data won't open, so
   * the user must re-enter their keys.
   */
  vaultDecryptError: boolean;
};
