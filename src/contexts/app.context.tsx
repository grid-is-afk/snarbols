import {
  AI_PROVIDERS,
  DEFAULT_SYSTEM_PROMPT,
  SPEECH_TO_TEXT_PROVIDERS,
  STORAGE_KEYS,
} from "@/config";
import { getPlatform, safeLocalStorage } from "@/lib";
import {
  getShortcutsConfig,
  decryptValue,
  encryptValue,
  isVaultAvailable,
  isVaultOwnerWindow,
  migrateSecretsToVault,
  ENC_PREFIX,
} from "@/lib/storage";
import {
  getCustomizableState,
  setCustomizableState,
  updateAppIconVisibility,
  updateAlwaysOnTop,
  updateAutostart,
  CustomizableState,
  DEFAULT_CUSTOMIZABLE_STATE,
  CursorType,
  updateCursorType,
} from "@/lib/storage";
import { IContextType, ScreenshotConfig, TYPE_PROVIDER } from "@/types";
import curl2Json from "@bany/curl-to-json";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { enable, disable } from "@tauri-apps/plugin-autostart";
import {
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

const validateAndProcessCurlProviders = (
  providersJson: string,
  providerType: "AI" | "STT"
): TYPE_PROVIDER[] => {
  try {
    const parsed = JSON.parse(providersJson);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((p) => {
        try {
          curl2Json(p.curl);
          return true;
        } catch (e) {
          return false;
        }
      })
      .map((p) => {
        const provider = { ...p, isCustom: true };
        if (providerType === "STT" && provider.curl) {
          provider.curl = provider.curl.replace(/AUDIO_BASE64/g, "AUDIO");
        }
        return provider;
      });
  } catch (e) {
    // NEVER log the raw error/object here: this runs downstream of a successful
    // decrypt, so a JSON.parse SyntaxError message can embed a fragment of the
    // decrypted secret. Log only the error name.
    console.warn(
      `Failed to parse custom ${providerType} providers:`,
      e instanceof Error ? e.name : "unknown error"
    );
    return [];
  }
};

// Secret-bearing localStorage keys protected by the encryption-at-rest vault.
const SECRET_STORAGE_KEYS: string[] = [
  STORAGE_KEYS.CUSTOM_AI_PROVIDERS,
  STORAGE_KEYS.CUSTOM_SPEECH_PROVIDERS,
  STORAGE_KEYS.SELECTED_AI_PROVIDER,
  STORAGE_KEYS.SELECTED_STT_PROVIDER,
];

// Create the context
const AppContext = createContext<IContextType | undefined>(undefined);

// Create the provider component
export const AppProvider = ({ children }: { children: ReactNode }) => {
  const [systemPrompt, setSystemPrompt] = useState<string>(
    safeLocalStorage.getItem(STORAGE_KEYS.SYSTEM_PROMPT) ||
      DEFAULT_SYSTEM_PROMPT
  );

  const [selectedAudioDevices, setSelectedAudioDevices] = useState<{
    input: { id: string; name: string };
    output: { id: string; name: string };
  }>(() => {
    const savedDevices = safeLocalStorage.getItem(
      STORAGE_KEYS.SELECTED_AUDIO_DEVICES
    );
    if (savedDevices) {
      try {
        return JSON.parse(savedDevices);
      } catch {
        // Return default on parse error
      }
    }

    return {
      input: { id: "", name: "" },
      output: { id: "", name: "" },
    };
  });

  // AI Providers
  const [customAiProviders, setCustomAiProviders] = useState<TYPE_PROVIDER[]>(
    []
  );
  const [selectedAIProvider, setSelectedAIProvider] = useState<{
    provider: string;
    variables: Record<string, string>;
  }>({
    provider: "",
    variables: {},
  });

  // STT Providers
  const [customSttProviders, setCustomSttProviders] = useState<TYPE_PROVIDER[]>(
    []
  );
  const [selectedSttProvider, setSelectedSttProvider] = useState<{
    provider: string;
    variables: Record<string, string>;
  }>({
    provider: "",
    variables: {},
  });

  const [screenshotConfiguration, setScreenshotConfiguration] =
    useState<ScreenshotConfig>({
      mode: "manual",
      autoPrompt: "Analyze this screenshot and provide insights",
      enabled: true,
    });

  // Unified Customizable State
  const [customizable, setCustomizable] = useState<CustomizableState>(
    DEFAULT_CUSTOMIZABLE_STATE
  );
  // Encryption-at-rest vault availability. Defaults to `true` so the warning
  // banner never flashes before the async probe resolves; set to `false` only
  // when the OS keychain is confirmed unavailable (passthrough mode).
  const [vaultAvailable, setVaultAvailable] = useState<boolean>(true);
  // True when at least one already-encrypted (`enc:v1:`) blob failed to decrypt
  // on the last load — i.e. the keychain changed and previously-saved keys can
  // no longer be unlocked. Distinct from `vaultAvailable === false`
  // (passthrough): here the vault reports available but our OWN data won't open,
  // so the user must re-enter their keys. The still-encrypted blobs are left
  // untouched so a repaired keychain could still recover them.
  const [vaultDecryptError, setVaultDecryptError] = useState<boolean>(false);

  // Snarbols has no hosted license/Cloud. Treat the app as always "licensed"
  // so all features are unlocked; AI runs entirely on the user's own keys.
  const [hasActiveLicense, setHasActiveLicense] = useState<boolean>(true);
  const [supportsImages, setSupportsImagesState] = useState<boolean>(() => {
    const stored = safeLocalStorage.getItem(STORAGE_KEYS.SUPPORTS_IMAGES);
    return stored === null ? true : stored === "true";
  });

  // Wrapper to sync supportsImages to localStorage
  const setSupportsImages = (value: boolean) => {
    setSupportsImagesState(value);
    safeLocalStorage.setItem(STORAGE_KEYS.SUPPORTS_IMAGES, String(value));
  };

  const getActiveLicenseStatus = async () => {
    // No hosted Cloud/license — never call out for validation. Always active.
    setHasActiveLicense(true);
  };

  useEffect(() => {
    const syncLicenseState = async () => {
      try {
        await invoke("set_license_status", {
          hasLicense: hasActiveLicense,
        });

        const config = getShortcutsConfig();
        await invoke("update_shortcuts", { config });
      } catch (error) {
        console.error("Failed to synchronize license state:", error);
      }
    };

    syncLicenseState();
  }, [hasActiveLicense]);

  // Function to load AI, STT, system prompt and screenshot config data from storage
  const loadData = async () => {
    // One-time cleanup: drop the orphaned legacy Pluely-Cloud flag left over on
    // installs upgraded from before the de-Cloud pass. Nothing reads it anymore.
    safeLocalStorage.removeItem("pluely_api_enabled");

    // Load system prompt
    const savedSystemPrompt = safeLocalStorage.getItem(
      STORAGE_KEYS.SYSTEM_PROMPT
    );
    if (savedSystemPrompt) {
      setSystemPrompt(savedSystemPrompt || DEFAULT_SYSTEM_PROMPT);
    }

    // Load screenshot configuration
    const savedScreenshotConfig = safeLocalStorage.getItem(
      STORAGE_KEYS.SCREENSHOT_CONFIG
    );
    if (savedScreenshotConfig) {
      try {
        const parsed = JSON.parse(savedScreenshotConfig);
        if (typeof parsed === "object" && parsed !== null) {
          setScreenshotConfiguration({
            mode: parsed.mode || "manual",
            autoPrompt:
              parsed.autoPrompt ||
              "Analyze this screenshot and provide insights",
            enabled: parsed.enabled !== undefined ? parsed.enabled : false,
          });
        }
      } catch {
        console.warn("Failed to parse screenshot configuration");
      }
    }

    // Count failures to decrypt values that ARE encrypted (`enc:v1:` prefixed).
    // A failure here means the keychain changed and previously-saved keys can no
    // longer be unlocked — surfaced to the user via `vaultDecryptError`. We NEVER
    // overwrite the still-encrypted blob on failure, so a repaired keychain can
    // still recover it.
    let decryptFailures = 0;

    // Load custom AI providers (decrypt-at-rest; plaintext passes through)
    const rawAi = safeLocalStorage.getItem(STORAGE_KEYS.CUSTOM_AI_PROVIDERS);
    let aiList: TYPE_PROVIDER[] = [];
    if (rawAi) {
      try {
        const savedAi = await decryptValue(rawAi);
        aiList = validateAndProcessCurlProviders(savedAi, "AI");
      } catch (error) {
        if (rawAi.startsWith(ENC_PREFIX)) decryptFailures++;
        // Log only the error name: a decrypt/parse error message can carry a
        // fragment of the decrypted secret.
        console.warn(
          "Failed to decrypt custom AI providers:",
          error instanceof Error ? error.name : "unknown error"
        );
      }
    }
    setCustomAiProviders(aiList);

    // Load custom STT providers (decrypt-at-rest; plaintext passes through)
    const rawStt = safeLocalStorage.getItem(
      STORAGE_KEYS.CUSTOM_SPEECH_PROVIDERS
    );
    let sttList: TYPE_PROVIDER[] = [];
    if (rawStt) {
      try {
        const savedStt = await decryptValue(rawStt);
        sttList = validateAndProcessCurlProviders(savedStt, "STT");
      } catch (error) {
        if (rawStt.startsWith(ENC_PREFIX)) decryptFailures++;
        console.warn(
          "Failed to decrypt custom STT providers:",
          error instanceof Error ? error.name : "unknown error"
        );
      }
    }
    setCustomSttProviders(sttList);

    // Load selected AI provider (decrypt-at-rest; plaintext passes through)
    const rawSelectedAi = safeLocalStorage.getItem(
      STORAGE_KEYS.SELECTED_AI_PROVIDER
    );
    if (rawSelectedAi) {
      try {
        setSelectedAIProvider(JSON.parse(await decryptValue(rawSelectedAi)));
      } catch (error) {
        if (rawSelectedAi.startsWith(ENC_PREFIX)) decryptFailures++;
        console.warn(
          "Failed to load selected AI provider:",
          error instanceof Error ? error.name : "unknown error"
        );
      }
    }

    // Load selected STT provider (decrypt-at-rest; plaintext passes through)
    const rawSelectedStt = safeLocalStorage.getItem(
      STORAGE_KEYS.SELECTED_STT_PROVIDER
    );
    if (rawSelectedStt) {
      try {
        setSelectedSttProvider(JSON.parse(await decryptValue(rawSelectedStt)));
      } catch (error) {
        if (rawSelectedStt.startsWith(ENC_PREFIX)) decryptFailures++;
        console.warn(
          "Failed to load selected STT provider:",
          error instanceof Error ? error.name : "unknown error"
        );
      }
    }

    // Surface whether any encrypted blob failed to open this load.
    setVaultDecryptError(decryptFailures > 0);

    // Load customizable state
    const customizableState = getCustomizableState();
    setCustomizable(customizableState);

    updateCursor(customizableState.cursor.type || "invisible");

    const stored = safeLocalStorage.getItem(STORAGE_KEYS.CUSTOMIZABLE);
    if (!stored) {
      // save the default state
      setCustomizableState(customizableState);
    } else {
      // check if we need to update the schema
      try {
        const parsed = JSON.parse(stored);
        if (!parsed.autostart) {
          // save the merged state with new autostart property
          setCustomizableState(customizableState);
          updateCursor(customizableState.cursor.type || "invisible");
        }
      } catch (error) {
        console.debug("Failed to check customizable state schema:", error);
      }
    }

    // Load selected audio devices
    const savedAudioDevices = safeLocalStorage.getItem(
      STORAGE_KEYS.SELECTED_AUDIO_DEVICES
    );
    if (savedAudioDevices) {
      try {
        const parsed = JSON.parse(savedAudioDevices);
        if (parsed && typeof parsed === "object") {
          setSelectedAudioDevices(parsed);
        }
      } catch {
        console.warn("Failed to parse selected audio devices");
      }
    }
  };

  const updateCursor = (type: CursorType | undefined) => {
    try {
      const currentWindow = getCurrentWindow();
      const platform = getPlatform();
      // For Linux, always use default cursor
      if (platform === "linux") {
        document.documentElement.style.setProperty("--cursor-type", "default");
        return;
      }
      const windowLabel = currentWindow.label;

      if (windowLabel === "dashboard") {
        // For dashboard, always use default cursor
        document.documentElement.style.setProperty("--cursor-type", "default");
        return;
      }

      // For overlay windows (main, capture-overlay-*)
      const safeType = type || "invisible";
      const cursorValue = type === "invisible" ? "none" : safeType;
      document.documentElement.style.setProperty("--cursor-type", cursorValue);
    } catch (error) {
      document.documentElement.style.setProperty("--cursor-type", "default");
    }
  };

  // Load data on mount
  useEffect(() => {
    const bootstrap = async () => {
      // 1) Probe the vault, and — ONLY in the owner window — migrate any
      //    plaintext secrets to encryption-at-rest BEFORE reading them back in
      //    loadData. Restricting migration (and, in secure-vault, master-key
      //    creation) to a single window prevents two windows from generating
      //    divergent master keys and orphaning blobs (permanent key loss).
      //    Non-owner windows only read/decrypt an existing key for display.
      try {
        const available = await isVaultAvailable();
        setVaultAvailable(available);
        if (isVaultOwnerWindow()) {
          await migrateSecretsToVault(SECRET_STORAGE_KEYS);
        }
      } catch (error) {
        console.warn(
          "[secure-vault] bootstrap probe/migration failed:",
          error instanceof Error ? error.name : "unknown error"
        );
      }

      // 2) Load (and decrypt) all persisted data.
      await loadData();

      // 3) License/shortcuts init.
      await getActiveLicenseStatus();
    };

    bootstrap();
  }, []);

  // Handle customizable settings on state changes
  useEffect(() => {
    const applyCustomizableSettings = async () => {
      try {
        await Promise.all([
          invoke("set_app_icon_visibility", {
            visible: customizable.appIcon.isVisible,
          }),
          invoke("set_always_on_top", {
            enabled: customizable.alwaysOnTop.isEnabled,
          }),
        ]);
      } catch (error) {
        console.error("Failed to apply customizable settings:", error);
      }
    };

    applyCustomizableSettings();
  }, [customizable]);

  useEffect(() => {
    const initializeAutostart = async () => {
      try {
        const autostartInitialized = safeLocalStorage.getItem(
          STORAGE_KEYS.AUTOSTART_INITIALIZED
        );

        // Only apply autostart on the very first launch
        if (!autostartInitialized) {
          const autostartEnabled = customizable?.autostart?.isEnabled ?? true;

          if (autostartEnabled) {
            await enable();
          } else {
            await disable();
          }

          // Mark as initialized so this never runs again
          safeLocalStorage.setItem(STORAGE_KEYS.AUTOSTART_INITIALIZED, "true");
        }
      } catch (error) {
        console.debug("Autostart initialization skipped:", error);
      }
    };

    initializeAutostart();
  }, []);

  // Listen for app icon hide/show events when window is toggled
  useEffect(() => {
    const handleAppIconVisibility = async (isVisible: boolean) => {
      try {
        await invoke("set_app_icon_visibility", { visible: isVisible });
      } catch (error) {
        console.error("Failed to set app icon visibility:", error);
      }
    };

    const unlistenHide = listen("handle-app-icon-on-hide", async () => {
      const currentState = getCustomizableState();
      // Only hide app icon if user has set it to hide mode
      if (!currentState.appIcon.isVisible) {
        await handleAppIconVisibility(false);
      }
    });

    const unlistenShow = listen("handle-app-icon-on-show", async () => {
      // Always show app icon when window is shown, regardless of user setting
      await handleAppIconVisibility(true);
    });

    return () => {
      unlistenHide.then((fn) => fn());
      unlistenShow.then((fn) => fn());
    };
  }, []);

  // Listen to storage events for real-time sync (e.g., multi-tab)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      // Sync supportsImages across windows
      if (e.key === STORAGE_KEYS.SUPPORTS_IMAGES && e.newValue !== null) {
        setSupportsImagesState(e.newValue === "true");
      }

      if (
        e.key === STORAGE_KEYS.CUSTOM_AI_PROVIDERS ||
        e.key === STORAGE_KEYS.SELECTED_AI_PROVIDER ||
        e.key === STORAGE_KEYS.CUSTOM_SPEECH_PROVIDERS ||
        e.key === STORAGE_KEYS.SELECTED_STT_PROVIDER ||
        e.key === STORAGE_KEYS.SYSTEM_PROMPT ||
        e.key === STORAGE_KEYS.SCREENSHOT_CONFIG ||
        e.key === STORAGE_KEYS.CUSTOMIZABLE ||
        e.key === STORAGE_KEYS.SELECTED_AUDIO_DEVICES
      ) {
        loadData();
      }
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  // Check if the current AI provider/model supports images
  useEffect(() => {
    // For custom AI providers, check if curl contains {{IMAGE}}
    const provider = allAiProviders.find(
      (p) => p.id === selectedAIProvider.provider
    );
    if (provider) {
      const hasImageSupport = provider.curl?.includes("{{IMAGE}}") ?? false;
      setSupportsImages(hasImageSupport);
    } else {
      setSupportsImages(true);
    }
  }, [selectedAIProvider.provider]);

  // Sync selected AI to localStorage (encrypt-at-rest)
  useEffect(() => {
    if (!selectedAIProvider.provider) return;
    let cancelled = false;
    (async () => {
      try {
        const serialized = JSON.stringify(selectedAIProvider);
        // Skip redundant writes (e.g. right after a load) so we don't thrash
        // storage or ping-pong the cross-window `storage` sync.
        const existing = safeLocalStorage.getItem(
          STORAGE_KEYS.SELECTED_AI_PROVIDER
        );
        if (existing) {
          const decoded = await decryptValue(existing).catch(() => null);
          if (decoded === serialized) return;
        }
        const encrypted = await encryptValue(serialized);
        if (!cancelled) {
          safeLocalStorage.setItem(
            STORAGE_KEYS.SELECTED_AI_PROVIDER,
            encrypted
          );
        }
      } catch (error) {
        console.warn("[secure-vault] failed to persist selected AI provider", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedAIProvider]);

  // Sync selected STT to localStorage (encrypt-at-rest)
  useEffect(() => {
    if (!selectedSttProvider.provider) return;
    let cancelled = false;
    (async () => {
      try {
        const serialized = JSON.stringify(selectedSttProvider);
        const existing = safeLocalStorage.getItem(
          STORAGE_KEYS.SELECTED_STT_PROVIDER
        );
        if (existing) {
          const decoded = await decryptValue(existing).catch(() => null);
          if (decoded === serialized) return;
        }
        const encrypted = await encryptValue(serialized);
        if (!cancelled) {
          safeLocalStorage.setItem(
            STORAGE_KEYS.SELECTED_STT_PROVIDER,
            encrypted
          );
        }
      } catch (error) {
        console.warn("[secure-vault] failed to persist selected STT provider", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSttProvider]);

  // Computed all AI providers
  const allAiProviders: TYPE_PROVIDER[] = [
    ...AI_PROVIDERS,
    ...customAiProviders,
  ];

  // Computed all STT providers
  const allSttProviders: TYPE_PROVIDER[] = [
    ...SPEECH_TO_TEXT_PROVIDERS,
    ...customSttProviders,
  ];

  const onSetSelectedAIProvider = ({
    provider,
    variables,
  }: {
    provider: string;
    variables: Record<string, string>;
  }) => {
    if (provider && !allAiProviders.some((p) => p.id === provider)) {
      console.warn(`Invalid AI provider ID: ${provider}`);
      return;
    }

    // Update supportsImages immediately when provider changes
    const selectedProvider = allAiProviders.find((p) => p.id === provider);
    if (selectedProvider) {
      const hasImageSupport =
        selectedProvider.curl?.includes("{{IMAGE}}") ?? false;
      setSupportsImages(hasImageSupport);
    } else {
      setSupportsImages(true);
    }

    setSelectedAIProvider((prev) => ({
      ...prev,
      provider,
      variables,
    }));
  };

  // Setter for selected STT with validation
  const onSetSelectedSttProvider = ({
    provider,
    variables,
  }: {
    provider: string;
    variables: Record<string, string>;
  }) => {
    if (provider && !allSttProviders.some((p) => p.id === provider)) {
      console.warn(`Invalid STT provider ID: ${provider}`);
      return;
    }

    setSelectedSttProvider((prev) => ({ ...prev, provider, variables }));
  };

  // Toggle handlers
  const toggleAppIconVisibility = async (isVisible: boolean) => {
    const newState = updateAppIconVisibility(isVisible);
    setCustomizable(newState);
    try {
      await invoke("set_app_icon_visibility", { visible: isVisible });
      loadData();
    } catch (error) {
      console.error("Failed to toggle app icon visibility:", error);
    }
  };

  const toggleAlwaysOnTop = async (isEnabled: boolean) => {
    const newState = updateAlwaysOnTop(isEnabled);
    setCustomizable(newState);
    try {
      await invoke("set_always_on_top", { enabled: isEnabled });
      loadData();
    } catch (error) {
      console.error("Failed to toggle always on top:", error);
    }
  };

  const toggleAutostart = async (isEnabled: boolean) => {
    const newState = updateAutostart(isEnabled);
    setCustomizable(newState);
    try {
      if (isEnabled) {
        await enable();
      } else {
        await disable();
      }
      loadData();
    } catch (error) {
      console.error("Failed to toggle autostart:", error);
      const revertedState = updateAutostart(!isEnabled);
      setCustomizable(revertedState);
    }
  };

  const setCursorType = (type: CursorType) => {
    setCustomizable((prev) => ({ ...prev, cursor: { type } }));
    updateCursor(type);
    updateCursorType(type);
    loadData();
  };

  // Create the context value (extend IContextType accordingly)
  const value: IContextType = {
    systemPrompt,
    setSystemPrompt,
    allAiProviders,
    customAiProviders,
    selectedAIProvider,
    onSetSelectedAIProvider,
    allSttProviders,
    customSttProviders,
    selectedSttProvider,
    onSetSelectedSttProvider,
    screenshotConfiguration,
    setScreenshotConfiguration,
    customizable,
    toggleAppIconVisibility,
    toggleAlwaysOnTop,
    toggleAutostart,
    loadData,
    hasActiveLicense,
    setHasActiveLicense,
    getActiveLicenseStatus,
    selectedAudioDevices,
    setSelectedAudioDevices,
    setCursorType,
    supportsImages,
    setSupportsImages,
    vaultAvailable,
    vaultDecryptError,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

// Create a hook to access the context
export const useApp = () => {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error("useApp must be used within a AppProvider");
  }

  return context;
};
