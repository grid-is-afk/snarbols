import { useState, type ChangeEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  CheckIcon,
  EyeIcon,
  KeyRoundIcon,
  LoaderIcon,
  LockIcon,
  ClipboardIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Button, Input } from "@/components";
import { cn } from "@/lib/utils";
import { ANALYTICS_EVENTS, captureEvent } from "@/lib";

const LICENSE_KEY_STORAGE_KEY = "pluely_license_key";
const INSTANCE_ID_STORAGE_KEY = "pluely_instance_id";

interface ActivationResponse {
  activated: boolean;
  error?: string;
  license_key?: string;
  instance?: { id: string; name: string; created_at: string };
  is_dev_license?: boolean;
}

interface CheckoutResponse {
  success?: boolean;
  checkout_url?: string;
  error?: string;
}

type Status = "idle" | "validating" | "success" | "error";

/**
 * Activation ("login") screen for Pluely Cloud.
 *
 * Pluely has no account/password — the gate is a license key that unlocks the
 * hosted API. This is the focused, full-window entry point: paste a key to
 * activate, or skip to bring-your-own provider keys. Mirrors the activation
 * logic in dashboard/components/PluelyApiSetup.tsx.
 */
export const Login = ({ onActivated }: { onActivated?: () => void } = {}) => {
  const navigate = useNavigate();

  const [licenseKey, setLicenseKey] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);

  const isBusy = status === "validating";
  const trimmed = licenseKey.trim();

  const focusInput = () =>
    (document.getElementById("license-key") as HTMLInputElement | null)?.focus();

  const reset = () => {
    setStatus((s) => (s === "error" || s === "success" ? "idle" : s));
    setMessage(null);
  };

  const handleChange = (e: string | ChangeEvent<HTMLInputElement>) => {
    setLicenseKey(typeof e === "string" ? e : e.target.value);
    reset();
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setLicenseKey(text.trim());
        reset();
      }
    } catch {
      // Clipboard unavailable — no-op, user can type/paste manually.
    } finally {
      focusInput();
    }
  };

  const handleActivate = async () => {
    if (!trimmed || isBusy) return;

    setStatus("validating");
    setMessage(null);

    try {
      const response: ActivationResponse = await invoke("activate_license_api", {
        licenseKey: trimmed,
      });

      if (response.activated && response.instance) {
        await invoke("secure_storage_save", {
          items: [
            { key: LICENSE_KEY_STORAGE_KEY, value: trimmed },
            { key: INSTANCE_ID_STORAGE_KEY, value: response.instance.id },
          ],
        });

        setStatus("success");
        setMessage("License activated — Pluely Cloud is unlocked.");
        await captureEvent(ANALYTICS_EVENTS.GET_LICENSE);

        // Let the success state breathe before handing off.
        setTimeout(() => {
          if (onActivated) onActivated();
          else navigate("/dashboard");
        }, 900);
      } else {
        setStatus("error");
        setMessage(response.error || "That key couldn't be activated.");
      }
    } catch (err) {
      setStatus("error");
      setMessage(
        typeof err === "string"
          ? err
          : "That key doesn't look right. Check your purchase email."
      );
    }
  };

  const handleGetLicense = async () => {
    setIsCheckoutLoading(true);
    try {
      const response: CheckoutResponse = await invoke("get_checkout_url");
      if (response.success && response.checkout_url) {
        await openUrl(response.checkout_url);
      }
    } catch (err) {
      console.error("Failed to get checkout URL:", err);
    } finally {
      setIsCheckoutLoading(false);
      await captureEvent(ANALYTICS_EVENTS.GET_LICENSE);
    }
  };

  return (
    <div className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-background p-6">
      {/* Draggable titlebar region (Tauri) */}
      <div
        className="absolute inset-x-0 top-0 z-50 h-10 select-none"
        data-tauri-drag-region
      />

      {/* Atmosphere: monochrome radial light + vignette + film grain */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(120% 80% at 50% -10%, rgb(from var(--foreground) r g b / 0.06), transparent 60%), radial-gradient(80% 60% at 50% 120%, rgb(from var(--foreground) r g b / 0.04), transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 opacity-[0.03] dark:opacity-[0.05] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      <main className="relative z-10 w-full max-w-[420px] overflow-hidden rounded-2xl border border-border bg-card/80 p-8 shadow-[0_28px_70px_-30px_rgba(0,0,0,0.55)] backdrop-blur-xl">
        {/* hairline sheen */}
        <div className="pointer-events-none absolute inset-x-[14%] top-0 h-px bg-gradient-to-r from-transparent via-foreground/20 to-transparent" />

        {/* Brand mark */}
        <div className="relative mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-[0_10px_30px_-10px_rgb(from_var(--foreground)_r_g_b_/_0.5)]">
          <SparklesIcon className="size-6" />
          <span className="absolute -inset-[7px] animate-pulse rounded-[22px] border border-foreground/15" />
        </div>

        <p className="text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Pluely Cloud
        </p>
        <h1 className="mt-2 text-center text-2xl font-semibold tracking-tight">
          Activate your license
        </h1>
        <p className="mx-auto mt-2 max-w-[33ch] text-center text-sm leading-relaxed text-muted-foreground">
          Paste the key from your purchase email to unlock faster responses,
          premium models, and priority support.
        </p>

        {/* Key field */}
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <label htmlFor="license-key" className="text-xs font-semibold">
              License key
            </label>
            <button
              type="button"
              onClick={handlePaste}
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ClipboardIcon className="size-3" />
              Paste
            </button>
          </div>

          <div
            className={cn(
              "flex h-12 items-center gap-2 rounded-xl border border-input bg-card/40 pl-3 pr-1.5 transition-[border-color,box-shadow]",
              "focus-within:border-ring/80 focus-within:ring-[4px] focus-within:ring-ring/25",
              status === "error" &&
                "border-destructive ring-[4px] ring-destructive/15 motion-safe:animate-[shake_0.4s]",
              status === "success" && "border-emerald-500/70"
            )}
          >
            <KeyRoundIcon
              className={cn(
                "size-4 shrink-0 transition-colors",
                status === "error"
                  ? "text-destructive"
                  : status === "success"
                  ? "text-emerald-500"
                  : "text-muted-foreground"
              )}
            />
            <Input
              id="license-key"
              type="text"
              autoFocus
              value={licenseKey}
              disabled={isBusy || status === "success"}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              onChange={handleChange}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleActivate();
              }}
              className="h-full flex-1 border-0 bg-transparent px-2 font-mono tracking-wide shadow-none focus-visible:ring-0"
            />
            <Button
              type="button"
              size="icon"
              onClick={handleActivate}
              disabled={!trimmed || isBusy || status === "success"}
              title="Activate license"
              className="size-9 rounded-lg"
            >
              {status === "validating" ? (
                <LoaderIcon className="size-4 animate-spin" />
              ) : status === "success" ? (
                <CheckIcon className="size-4" />
              ) : (
                <ArrowRight className="size-4" />
              )}
            </Button>
          </div>

          {/* Status message */}
          {message && (
            <p
              className={cn(
                "mt-2.5 flex items-center gap-1.5 text-xs leading-snug",
                status === "error" && "text-destructive",
                status === "success" && "text-emerald-600 dark:text-emerald-500"
              )}
            >
              {status === "error" ? (
                <TriangleAlertIcon className="size-3.5 shrink-0" />
              ) : (
                <CheckIcon className="size-3.5 shrink-0" />
              )}
              {message}
            </p>
          )}
        </div>

        {/* Divider */}
        <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>

        {/* Bring-your-own-keys escape hatch */}
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate("/settings")}
          className="h-11 w-full justify-center gap-2.5 text-sm font-medium"
        >
          <EyeIcon className="size-4 text-muted-foreground" />
          Continue with your own API keys
        </Button>

        {/* Get a license */}
        <p className="mt-5 text-center text-[13px] text-muted-foreground">
          Don't have a key yet?{" "}
          <button
            type="button"
            onClick={handleGetLicense}
            disabled={isCheckoutLoading}
            className="font-semibold text-foreground underline decoration-foreground/30 underline-offset-4 transition-colors hover:decoration-foreground disabled:opacity-60"
          >
            {isCheckoutLoading ? "Opening checkout…" : "Get a license →"}
          </button>
        </p>

        {/* Trust line */}
        <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          <LockIcon className="size-3" />
          Stored locally &amp; encrypted — your key never leaves this device.
        </div>
      </main>
    </div>
  );
};

export default Login;
