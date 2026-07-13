import { useState } from "react";
import { ShieldAlertIcon, XIcon } from "lucide-react";
import { useApp } from "@/contexts";

interface VaultStatusBannerProps {
  className?: string;
}

/**
 * Non-blocking warning about the encryption-at-rest vault. Two distinct states,
 * prioritised so only one shows at a time:
 *
 *  1. Decrypt failure (`vaultDecryptError`) — the vault is available but at
 *     least one previously-saved key can no longer be unlocked because the OS
 *     secure storage changed. The user must re-enter those keys. Shown first
 *     because it needs user action.
 *  2. Passthrough (`vaultAvailable === false`) — no OS secure storage at all, so
 *     keys are stored unencrypted. Informational.
 *
 * Rendered as an `alert` region and dismissible for the session; the app never
 * blocks on it.
 */
export const VaultStatusBanner = ({ className }: VaultStatusBannerProps) => {
  const { vaultAvailable, vaultDecryptError } = useApp();
  const [dismissed, setDismissed] = useState(false);

  const variant = vaultDecryptError
    ? "decrypt-error"
    : !vaultAvailable
      ? "passthrough"
      : null;

  if (variant === null || dismissed) return null;

  const { title, description } =
    variant === "decrypt-error"
      ? {
          title: "Some saved API keys couldn't be unlocked",
          description:
            "Your secure storage changed, so some previously-saved API keys can no longer be decrypted. Please re-enter them. Snarbols still works normally.",
        }
      : {
          title: "Secure storage unavailable",
          description:
            "OS secure storage is unavailable on this system — your API keys are stored unencrypted. Snarbols still works normally.",
        };

  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 ${
        className ?? ""
      }`}
    >
      <ShieldAlertIcon
        className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
        aria-hidden="true"
      />
      <div className="flex-1 space-y-1">
        <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
          {title}
        </p>
        <p className="text-xs text-amber-700/80 dark:text-amber-300/80">
          {description}
        </p>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss secure storage warning"
        className="rounded-md p-1 text-amber-700/70 transition-colors hover:bg-amber-500/15 hover:text-amber-700 dark:text-amber-300/70 dark:hover:text-amber-300"
      >
        <XIcon className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
};
