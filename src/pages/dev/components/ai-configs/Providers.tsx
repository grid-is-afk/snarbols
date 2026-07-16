import { Button, Header, Input, Selection, TextInput } from "@/components";
import { UseSettingsReturn } from "@/types";
import { fetchAIResponse } from "@/lib/functions";
import curl2Json, { ResultJSON } from "@bany/curl-to-json";
import {
  CheckCircle2,
  KeyIcon,
  Loader2,
  PlugZap,
  TrashIcon,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";

type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

// Prefixes the request engine (fetchAIResponse) uses when it yields an error
// string instead of model output. Used to tell a genuine reply apart from a
// surfaced provider/network error without re-implementing the engine.
const ENGINE_ERROR_PREFIXES = [
  "api request failed:",
  "network error during api request:",
  "failed to parse",
  "error in fetchairesponse:",
  "streaming not supported",
  "missing required variable",
];

/**
 * Turn the raw text the request engine produced (a model reply, a surfaced
 * provider error, or a thrown error message) into a plain-English result.
 * Maps HTTP status / Anthropic-style error bodies to actionable guidance so a
 * user never sees raw JSON. `threw` marks output that came from a caught throw.
 */
const classifyTestOutput = (
  raw: string,
  providerId: string,
  model: string,
  threw: boolean
): { ok: boolean; message: string } => {
  const text = (raw || "").trim();
  const lower = text.toLowerCase();

  const looksLikeError =
    threw ||
    ENGINE_ERROR_PREFIXES.some((p) => lower.startsWith(p)) ||
    lower.includes('"type":"error"') ||
    lower.includes('"type": "error"') ||
    lower.includes("insufficient_permissions");

  if (!looksLikeError && text.length > 0) {
    return {
      ok: true,
      message: `Works — ${providerId} responded with ${model}.`,
    };
  }

  if (!text) {
    return {
      ok: false,
      message: `No response received from ${providerId}. Check the endpoint and try again.`,
    };
  }

  const statusMatch = text.match(/failed:\s*(\d{3})\b/i);
  const status = statusMatch ? parseInt(statusMatch[1], 10) : null;

  const is401 = status === 401 || lower.includes("authentication_error");
  const is403 =
    status === 403 ||
    lower.includes("permission_error") ||
    lower.includes("insufficient_permissions");
  const is404 = status === 404 || lower.includes("not_found_error");

  if (is401) {
    return {
      ok: false,
      message: "API key is invalid or incomplete. Re-paste your full key.",
    };
  }
  if (is403) {
    return {
      ok: false,
      message: `This key's workspace doesn't have access to '${model}'. Pick a different model (e.g. claude-sonnet-5) or enable it in your provider's console.`,
    };
  }
  if (is404) {
    return {
      ok: false,
      message: `Model '${model}' not found — check the model ID.`,
    };
  }
  if (lower.includes("missing required variable")) {
    return {
      ok: false,
      message: text.replace(/^error in fetchairesponse:\s*/i, ""),
    };
  }

  const concise =
    text.replace(/^error in fetchairesponse:\s*/i, "").slice(0, 220) +
    (text.length > 220 ? "…" : "");
  return {
    ok: false,
    message: concise || `Couldn't reach ${providerId}. Check your settings.`,
  };
};

export const Providers = ({
  allAiProviders,
  selectedAIProvider,
  onSetSelectedAIProvider,
  variables,
}: UseSettingsReturn) => {
  const [localSelectedProvider, setLocalSelectedProvider] =
    useState<ResultJSON | null>(null);
  const [test, setTest] = useState<TestState>({ status: "idle" });

  const providerDef = allAiProviders?.find(
    (p) => p?.id === selectedAIProvider?.provider
  );
  const isCustomProvider = !!providerDef?.isCustom;
  const providerLabel = isCustomProvider
    ? "Custom Provider"
    : selectedAIProvider?.provider || "provider";

  useEffect(() => {
    if (selectedAIProvider?.provider) {
      const provider = allAiProviders?.find(
        (p) => p?.id === selectedAIProvider?.provider
      );
      if (provider) {
        const json = curl2Json(provider?.curl);
        setLocalSelectedProvider(json as ResultJSON);
      }
    }
    // Reset any prior test result when the provider changes.
    setTest({ status: "idle" });
  }, [selectedAIProvider?.provider]);

  const findKeyAndValue = (key: string) => {
    return variables?.find((v) => v?.key === key);
  };

  const modelVar = findKeyAndValue("model");

  const getVariableValue = (key: string) => {
    if (!key || !selectedAIProvider?.variables) return "";
    return selectedAIProvider.variables[key] || "";
  };

  const getApiKeyValue = () => {
    const apiKeyVar = findKeyAndValue("api_key");
    if (!apiKeyVar || !selectedAIProvider?.variables) return "";
    return selectedAIProvider?.variables?.[apiKeyVar.key] || "";
  };

  const isApiKeyEmpty = () => {
    return !getApiKeyValue().trim();
  };

  // Prefill the default model when a provider is selected and its MODEL field
  // is still empty. Never overwrites a value the user already entered, so a
  // fresh Anthropic setup lands on claude-sonnet-5 out of the box.
  useEffect(() => {
    if (!providerDef?.defaultModel || !modelVar || !selectedAIProvider) return;
    const current = getVariableValue(modelVar.key);
    if (current.trim()) return;

    onSetSelectedAIProvider({
      ...selectedAIProvider,
      variables: {
        ...selectedAIProvider.variables,
        [modelVar.key]: providerDef.defaultModel,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAIProvider?.provider, modelVar?.key, providerDef?.defaultModel]);

  const setVariableValue = (key: string, value: string) => {
    if (!key || !selectedAIProvider) return;
    onSetSelectedAIProvider({
      ...selectedAIProvider,
      variables: {
        ...selectedAIProvider.variables,
        [key]: value,
      },
    });
  };

  const currentModel = modelVar ? getVariableValue(modelVar.key) : "";

  const runTestConnection = async () => {
    if (!providerDef || !selectedAIProvider?.provider) return;
    setTest({ status: "testing" });

    const modelForMessage = currentModel.trim() || "the selected model";

    try {
      let accumulated = "";
      for await (const chunk of fetchAIResponse({
        provider: providerDef,
        selectedProvider: {
          provider: selectedAIProvider.provider,
          variables: selectedAIProvider.variables || {},
        },
        userMessage: "Reply with the single word: ok",
      })) {
        accumulated += chunk;
        // The reply is tiny; cap so a chatty/misbehaving provider can't stream
        // forever. Enough to capture any surfaced error string in full.
        if (accumulated.length > 2000) break;
      }

      const { ok, message } = classifyTestOutput(
        accumulated,
        providerLabel,
        modelForMessage,
        false
      );
      setTest({ status: ok ? "success" : "error", message });
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      const { message } = classifyTestOutput(
        raw,
        providerLabel,
        modelForMessage,
        true
      );
      setTest({ status: "error", message });
    }
  };

  const testDisabled =
    test.status === "testing" ||
    !selectedAIProvider?.provider ||
    (!!findKeyAndValue("api_key") && isApiKeyEmpty()) ||
    (!!modelVar && !currentModel.trim());

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Header
          title="Select AI Provider"
          description="Select your preferred AI service provider or custom providers to get started."
        />
        <Selection
          selected={selectedAIProvider?.provider}
          options={allAiProviders?.map((provider) => {
            const json = curl2Json(provider?.curl);
            return {
              label: provider?.isCustom
                ? json?.url || "Custom Provider"
                : provider?.id || "Custom Provider",
              value: provider?.id || "Custom Provider",
              isCustom: provider?.isCustom,
            };
          })}
          placeholder="Choose your AI provider"
          onChange={(value) => {
            onSetSelectedAIProvider({
              provider: value,
              variables: {},
            });
          }}
        />
      </div>

      {localSelectedProvider ? (
        <Header
          title={`Method: ${
            localSelectedProvider?.method || "Invalid"
          }, Endpoint: ${localSelectedProvider?.url || "Invalid"}`}
          description={`If you want to use different url or method, you can always create a custom provider.`}
        />
      ) : null}

      {findKeyAndValue("api_key") ? (
        <div className="space-y-2">
          <Header
            title="API Key"
            description={`Enter your ${providerLabel} API key to authenticate and access AI models. Your key is stored locally and never shared.`}
          />

          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="**********"
                value={getApiKeyValue()}
                onChange={(value) => {
                  const apiKeyVar = findKeyAndValue("api_key");
                  if (!apiKeyVar || !selectedAIProvider) return;

                  onSetSelectedAIProvider({
                    ...selectedAIProvider,
                    variables: {
                      ...selectedAIProvider.variables,
                      [apiKeyVar.key]:
                        typeof value === "string" ? value : value.target.value,
                    },
                  });
                }}
                onKeyDown={(e) => {
                  const apiKeyVar = findKeyAndValue("api_key");
                  if (!apiKeyVar || !selectedAIProvider) return;

                  onSetSelectedAIProvider({
                    ...selectedAIProvider,
                    variables: {
                      ...selectedAIProvider.variables,
                      [apiKeyVar.key]: (e.target as HTMLInputElement).value,
                    },
                  });
                }}
                disabled={false}
                className="flex-1 h-11 border-1 border-input/50 focus:border-primary/50 transition-colors"
              />
              {isApiKeyEmpty() ? (
                <Button
                  onClick={() => {
                    const apiKeyVar = findKeyAndValue("api_key");
                    if (!apiKeyVar || !selectedAIProvider || isApiKeyEmpty())
                      return;

                    onSetSelectedAIProvider({
                      ...selectedAIProvider,
                      variables: {
                        ...selectedAIProvider.variables,
                        [apiKeyVar.key]: getApiKeyValue(),
                      },
                    });
                  }}
                  disabled={isApiKeyEmpty()}
                  size="icon"
                  className="shrink-0 h-11 w-11"
                  title="Submit API Key"
                >
                  <KeyIcon className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    const apiKeyVar = findKeyAndValue("api_key");
                    if (!apiKeyVar || !selectedAIProvider) return;

                    onSetSelectedAIProvider({
                      ...selectedAIProvider,
                      variables: {
                        ...selectedAIProvider.variables,
                        [apiKeyVar.key]: "",
                      },
                    });
                  }}
                  size="icon"
                  variant="destructive"
                  className="shrink-0 h-11 w-11"
                  title="Remove API Key"
                >
                  <TrashIcon className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div className="space-y-4 mt-2">
        {variables
          .filter(
            (variable) => variable.key !== findKeyAndValue("api_key")?.key
          )
          .map((variable) => {
            const isModelField = variable?.key === "model";
            const suggestions =
              isModelField && !isCustomProvider ? providerDef?.models : undefined;
            const value = getVariableValue(variable?.key || "");
            const datalistId = `models-${selectedAIProvider?.provider || "provider"}`;

            return (
              <div className="space-y-1" key={variable?.key}>
                <Header
                  title={variable?.value || ""}
                  description={
                    isModelField
                      ? `Pick or type the model ID for ${providerLabel}.`
                      : `add your preferred ${variable?.key?.replace(
                          /_/g,
                          " "
                        )} for ${providerLabel}`
                  }
                />

                {isModelField && suggestions && suggestions.length > 0 ? (
                  <>
                    <Input
                      list={datalistId}
                      placeholder="Choose a model or type a custom ID"
                      value={value}
                      onChange={(e) =>
                        setVariableValue(
                          variable.key,
                          typeof e === "string" ? e : e.target.value
                        )
                      }
                      className="h-11 border-1 border-input/50 focus:border-primary/50 transition-colors"
                    />
                    <datalist id={datalistId}>
                      {suggestions.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  </>
                ) : (
                  <TextInput
                    placeholder={
                      isModelField
                        ? `Enter a model ID — see ${providerLabel}'s model list`
                        : `Enter ${providerLabel} ${
                            variable?.key?.replace(/_/g, " ") || "value"
                          }`
                    }
                    value={value}
                    onChange={(v) => setVariableValue(variable?.key || "", v)}
                  />
                )}
              </div>
            );
          })}
      </div>

      {selectedAIProvider?.provider ? (
        <div className="space-y-2 pt-1">
          <Button
            type="button"
            variant="outline"
            onClick={runTestConnection}
            disabled={testDisabled}
            className="w-full h-11 border-1 border-input/50 focus:border-primary/50 transition-colors"
          >
            {test.status === "testing" ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Testing connection…
              </>
            ) : (
              <>
                <PlugZap className="h-4 w-4 mr-2" />
                Test connection
              </>
            )}
          </Button>

          {test.status === "success" || test.status === "error" ? (
            <div
              role="status"
              className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
                test.status === "success"
                  ? "border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400"
                  : "border-destructive/40 bg-destructive/10 text-destructive"
              }`}
            >
              {test.status === "success" ? (
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
              )}
              <span className="leading-snug">{test.message}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
