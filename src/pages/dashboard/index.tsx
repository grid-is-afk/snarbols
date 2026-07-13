import { useNavigate } from "react-router-dom";
import {
  KeyRoundIcon,
  KeyboardIcon,
  EyeOffIcon,
  ShieldCheckIcon,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components";
import { PageLayout } from "@/layouts";

const FEATURES = [
  {
    icon: EyeOffIcon,
    title: "Invisible overlay",
    desc: "Stays hidden in screen shares and recordings.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Private by design",
    desc: "Requests go straight from your machine to your provider.",
  },
  {
    icon: KeyboardIcon,
    title: "Summon with a hotkey",
    desc: "Ask, screenshot, or transcribe from anywhere.",
  },
];

const Dashboard = () => {
  const navigate = useNavigate();

  return (
    <PageLayout
      title="Welcome to Snarbols"
      description="Your private, on-device AI assistant. No account, no subscription — bring your own API key and you're ready."
    >
      {/* Get started */}
      <div className="rounded-xl border border-input/50 bg-card/60 p-5">
        <h2 className="text-base font-semibold">Get started in two steps</h2>
        <ol className="mt-4 space-y-4">
          <li className="flex gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground text-xs font-semibold">
              1
            </span>
            <div className="flex-1">
              <p className="text-sm font-medium">Add your AI provider</p>
              <p className="text-sm text-muted-foreground">
                Open Dev Space and paste your own OpenAI, Anthropic, or other
                API key. It's stored locally on this device.
              </p>
              <Button
                size="sm"
                className="mt-2 gap-1.5"
                onClick={() => navigate("/dev-space")}
              >
                <KeyRoundIcon className="size-4" />
                Set up a provider
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground text-xs font-semibold">
              2
            </span>
            <div className="flex-1">
              <p className="text-sm font-medium">Summon Snarbols</p>
              <p className="text-sm text-muted-foreground">
                Use your hotkey to bring up the input, then ask away. Configure
                shortcuts under Cursor &amp; Shortcuts.
              </p>
            </div>
          </li>
        </ol>
      </div>

      {/* Feature highlights */}
      <div className="grid gap-3 sm:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, desc }) => (
          <div
            key={title}
            className="rounded-xl border border-input/50 bg-card/40 p-4"
          >
            <div className="mb-2 grid size-9 place-items-center rounded-lg border border-input/50 bg-background">
              <Icon className="size-4 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">{title}</p>
            <p className="text-xs text-muted-foreground">{desc}</p>
          </div>
        ))}
      </div>
    </PageLayout>
  );
};

export default Dashboard;
