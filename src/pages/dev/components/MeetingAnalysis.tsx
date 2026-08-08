import { useEffect, useState } from "react";
import { Button, Card, Input, Label } from "@/components";
import { useApp } from "@/contexts";
import { getAnalysisModel, setAnalysisModel } from "@/lib/storage/analysis-provider";

const DATALIST_ID = "meeting-analysis-model-options";

/**
 * The cheap model used for the meeting analysis hot path.
 *
 * Stored as a MODEL OVERRIDE on the main provider rather than a second provider
 * selection, so there is no duplicate API key to rotate. Left empty, meetings
 * run entirely on the main chat model — they work, they just cost more per turn.
 */
export const MeetingAnalysis = () => {
  const { selectedAIProvider, allAiProviders } = useApp();

  const [model, setModel] = useState<string>("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setModel(getAnalysisModel());
  }, []);

  const provider = allAiProviders.find(
    (p) => p.id === selectedAIProvider.provider
  );
  const mainModel = selectedAIProvider.variables?.MODEL || "not set";
  const suggestions = provider?.models ?? [];

  const handleSave = () => {
    setAnalysisModel(model);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  const handleClear = () => {
    setAnalysisModel("");
    setModel("");
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div>
        <h2 className="text-sm font-semibold">Meeting analysis model</h2>
        <p className="text-xs text-muted-foreground">
          Meetings run one small request per speaking turn. Pointing that at a
          cheaper model is the single biggest lever on what a meeting costs —
          your chat and the “what do I say?” answer keep using{" "}
          <span className="font-medium">{mainModel}</span>.
        </p>
      </div>

      {!provider ? (
        <p className="text-xs text-destructive">
          Select an AI provider first — the analysis model runs through the same
          provider and credentials.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="analysis-model" className="text-xs">
              Analysis model
            </Label>
            <Input
              id="analysis-model"
              list={suggestions.length > 0 ? DATALIST_ID : undefined}
              value={model}
              placeholder={`Leave empty to use ${mainModel}`}
              onChange={(event) => setModel(event.target.value)}
            />
            {suggestions.length > 0 ? (
              <datalist id={DATALIST_ID}>
                {suggestions.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            ) : null}
            <p className="text-[10px] text-muted-foreground">
              Use the exact model id, lowercase and hyphenated — display names
              like “Haiku 4.5” return a 404.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleSave}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={handleClear}>
              Use main model
            </Button>
            {saved ? (
              <span className="text-xs text-emerald-600">Saved</span>
            ) : null}
          </div>
        </>
      )}
    </Card>
  );
};
