import { Button, Header, Input, Selection, TextInput } from "@/components";
import { TYPE_PROVIDER, UseSettingsReturn } from "@/types";
import curl2Json, { ResultJSON } from "@bany/curl-to-json";
import { KeyIcon, TrashIcon } from "lucide-react";
import { useEffect, useState } from "react";

// Sentinel value for the "None" option: Radix Select rejects empty-string item
// values, so we use a token and map it back to "" (cleared) in the handler.
const NO_FALLBACK_VALUE = "__none__";

interface SelectedProvider {
  provider: string;
  variables: Record<string, string>;
}

/**
 * The method/endpoint header + API-key input + extra-variable inputs shared by
 * both the primary and fallback STT sections. Extracted verbatim from the
 * original primary markup so the primary section's behaviour is unchanged.
 */
const SttProviderFields = ({
  allSttProviders,
  selected,
  variables,
  onSet,
}: {
  allSttProviders: TYPE_PROVIDER[];
  selected: SelectedProvider;
  variables: { key: string; value: string }[];
  onSet: (provider: SelectedProvider) => void;
}) => {
  const [localSelectedProvider, setLocalSelectedProvider] =
    useState<ResultJSON | null>(null);

  useEffect(() => {
    if (selected?.provider) {
      const provider = allSttProviders?.find(
        (p) => p?.id === selected?.provider
      );
      if (provider) {
        const json = curl2Json(provider?.curl);
        setLocalSelectedProvider(json as ResultJSON);
      }
    } else {
      setLocalSelectedProvider(null);
    }
  }, [selected?.provider, allSttProviders]);

  const findKeyAndValue = (key: string) => {
    return variables?.find((v) => v?.key === key);
  };

  const getApiKeyValue = () => {
    const apiKeyVar = findKeyAndValue("api_key");
    if (!apiKeyVar || !selected?.variables) return "";
    return selected?.variables?.[apiKeyVar.key] || "";
  };

  const isApiKeyEmpty = () => {
    return !getApiKeyValue().trim();
  };

  const isCustom = allSttProviders?.find(
    (p) => p?.id === selected?.provider
  )?.isCustom;
  const providerLabel = isCustom ? "Custom Provider" : selected?.provider;

  return (
    <>
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
            description={`Enter your ${providerLabel} API key to authenticate and access STT models. Your key is stored locally and never shared.`}
          />

          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="**********"
                value={getApiKeyValue()}
                onChange={(value) => {
                  const apiKeyVar = findKeyAndValue("api_key");
                  if (!apiKeyVar || !selected) return;

                  onSet({
                    ...selected,
                    variables: {
                      ...selected.variables,
                      [apiKeyVar.key]:
                        typeof value === "string" ? value : value.target.value,
                    },
                  });
                }}
                onKeyDown={(e) => {
                  const apiKeyVar = findKeyAndValue("api_key");
                  if (!apiKeyVar || !selected) return;

                  onSet({
                    ...selected,
                    variables: {
                      ...selected.variables,
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
                    if (!apiKeyVar || !selected || isApiKeyEmpty()) return;

                    onSet({
                      ...selected,
                      variables: {
                        ...selected.variables,
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
                    if (!apiKeyVar || !selected) return;

                    onSet({
                      ...selected,
                      variables: {
                        ...selected.variables,
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
          ?.filter((variable) => variable?.key !== findKeyAndValue("api_key")?.key)
          .map((variable) => {
            const getVariableValue = () => {
              if (!variable?.key || !selected?.variables) return "";
              return selected.variables[variable.key] || "";
            };

            return (
              <div className="space-y-1" key={variable?.key}>
                <Header
                  title={variable?.value || ""}
                  description={`add your preferred ${variable?.key?.replace(
                    /_/g,
                    " "
                  )} for ${providerLabel}`}
                />
                <TextInput
                  placeholder={`Enter ${providerLabel} ${
                    variable?.key?.replace(/_/g, " ") || "value"
                  }`}
                  value={getVariableValue()}
                  onChange={(value) => {
                    if (!variable?.key || !selected) return;

                    onSet({
                      ...selected,
                      variables: {
                        ...selected.variables,
                        [variable.key]: value,
                      },
                    });
                  }}
                />
              </div>
            );
          })}
      </div>
    </>
  );
};

export const Providers = ({
  allSttProviders,
  selectedSttProvider,
  onSetSelectedSttProvider,
  sttVariables,
  selectedSttFallbackProvider,
  onSetSelectedSttFallbackProvider,
  sttFallbackVariables,
}: UseSettingsReturn) => {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Header
          title="Select STT Provider"
          description="Select your preferred STT service provider or custom providers to get started."
        />
        <Selection
          selected={selectedSttProvider?.provider}
          customGroupLabel="Custom STT Providers"
          options={allSttProviders?.map((provider) => {
            const json = curl2Json(provider?.curl);
            return {
              label: provider?.isCustom
                ? json?.url || "Custom Provider"
                : provider?.id || "Custom Provider",
              value: provider?.id || "Custom Provider",
              isCustom: provider?.isCustom,
            };
          })}
          placeholder="Choose your STT provider"
          onChange={(value) => {
            onSetSelectedSttProvider({
              provider: value,
              variables: {},
            });
          }}
        />
      </div>

      <SttProviderFields
        allSttProviders={allSttProviders}
        selected={selectedSttProvider}
        variables={sttVariables}
        onSet={onSetSelectedSttProvider}
      />

      {/* Fallback STT provider — only offered once a primary is chosen. */}
      {selectedSttProvider?.provider ? (
        <div className="space-y-3 pt-3 border-t border-input/50">
          <div className="space-y-2">
            <Header
              title="Fallback STT provider (optional)"
              description="If the primary provider fails, this one is tried automatically. Pick a different provider (or a backup key) so a single outage doesn't break transcription."
            />
            <Selection
              selected={selectedSttFallbackProvider?.provider}
              customGroupLabel="Custom STT Providers"
              options={[
                {
                  label: "None (no fallback)",
                  value: NO_FALLBACK_VALUE,
                  isCustom: false,
                },
                ...allSttProviders
                  ?.filter((p) => p?.id !== selectedSttProvider?.provider)
                  .map((provider) => {
                    const json = curl2Json(provider?.curl);
                    return {
                      label: provider?.isCustom
                        ? json?.url || "Custom Provider"
                        : provider?.id || "Custom Provider",
                      value: provider?.id || "Custom Provider",
                      isCustom: provider?.isCustom,
                    };
                  }),
              ]}
              placeholder="No fallback"
              onChange={(value) => {
                onSetSelectedSttFallbackProvider({
                  provider: value === NO_FALLBACK_VALUE ? "" : value,
                  variables: {},
                });
              }}
            />
          </div>

          {selectedSttFallbackProvider?.provider ? (
            <SttProviderFields
              allSttProviders={allSttProviders}
              selected={selectedSttFallbackProvider}
              variables={sttFallbackVariables}
              onSet={onSetSelectedSttFallbackProvider}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
