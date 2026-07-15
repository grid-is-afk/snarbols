import { useEffect, useState } from "react";
import { useApp } from "@/contexts";
import {
  extractVariables,
  safeLocalStorage,
  deleteAllConversations,
} from "@/lib";
import { STORAGE_KEYS } from "@/config";

export const useSettings = () => {
  const {
    screenshotConfiguration,
    setScreenshotConfiguration,
    allAiProviders,
    allSttProviders,
    selectedAIProvider,
    selectedSttProvider,
    selectedSttFallbackProvider,
    onSetSelectedAIProvider,
    onSetSelectedSttProvider,
    onSetSelectedSttFallbackProvider,
    hasActiveLicense,
  } = useApp();
  const [variables, setVariables] = useState<{ key: string; value: string }[]>(
    []
  );
  const [sttVariables, setSttVariables] = useState<
    {
      key: string;
      value: string;
    }[]
  >([]);
  const [sttFallbackVariables, setSttFallbackVariables] = useState<
    {
      key: string;
      value: string;
    }[]
  >([]);

  const [showDeleteConfirmDialog, setShowDeleteConfirmDialog] = useState(false);

  const handleScreenshotModeChange = (value: "auto" | "manual") => {
    const newConfig = { ...screenshotConfiguration, mode: value };
    setScreenshotConfiguration(newConfig);
    safeLocalStorage.setItem(
      STORAGE_KEYS.SCREENSHOT_CONFIG,
      JSON.stringify(newConfig)
    );
  };

  const handleScreenshotPromptChange = (value: string) => {
    const newConfig = { ...screenshotConfiguration, autoPrompt: value };
    setScreenshotConfiguration(newConfig);
    safeLocalStorage.setItem(
      STORAGE_KEYS.SCREENSHOT_CONFIG,
      JSON.stringify(newConfig)
    );
  };

  const handleScreenshotEnabledChange = (enabled: boolean) => {
    if (!enabled && !hasActiveLicense) {
      return;
    }
    const newConfig = { ...screenshotConfiguration, enabled };
    setScreenshotConfiguration(newConfig);
    safeLocalStorage.setItem(
      STORAGE_KEYS.SCREENSHOT_CONFIG,
      JSON.stringify(newConfig)
    );
  };

  useEffect(() => {
    if (selectedAIProvider.provider) {
      const provider = allAiProviders.find(
        (p) => p.id === selectedAIProvider.provider
      );
      if (provider) {
        const variables = extractVariables(provider?.curl);
        setVariables(variables);
      }
    }
  }, [selectedAIProvider.provider, allAiProviders]);

  useEffect(() => {
    if (selectedSttProvider.provider) {
      const provider = allSttProviders.find(
        (p) => p.id === selectedSttProvider.provider
      );
      if (provider) {
        const variables = extractVariables(provider?.curl);
        setSttVariables(variables);
      }
    }
  }, [selectedSttProvider.provider, allSttProviders]);

  useEffect(() => {
    if (selectedSttFallbackProvider.provider) {
      const provider = allSttProviders.find(
        (p) => p.id === selectedSttFallbackProvider.provider
      );
      if (provider) {
        const variables = extractVariables(provider?.curl);
        setSttFallbackVariables(variables);
      }
    } else {
      // Cleared to "None": drop any stale variable inputs.
      setSttFallbackVariables([]);
    }
  }, [selectedSttFallbackProvider.provider, allSttProviders]);

  const handleDeleteAllChatsConfirm = async () => {
    try {
      await deleteAllConversations();
      setShowDeleteConfirmDialog(false);
    } catch (error) {
      console.error("Failed to delete all conversations:", error);
    }
  };

  return {
    screenshotConfiguration,
    setScreenshotConfiguration,
    handleScreenshotModeChange,
    handleScreenshotPromptChange,
    handleScreenshotEnabledChange,
    allAiProviders,
    allSttProviders,
    selectedAIProvider,
    selectedSttProvider,
    selectedSttFallbackProvider,
    onSetSelectedAIProvider,
    onSetSelectedSttProvider,
    onSetSelectedSttFallbackProvider,
    handleDeleteAllChatsConfirm,
    showDeleteConfirmDialog,
    setShowDeleteConfirmDialog,
    variables,
    sttVariables,
    sttFallbackVariables,
    hasActiveLicense,
  };
};
