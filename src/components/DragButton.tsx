import { GripVerticalIcon } from "lucide-react";
import { useApp } from "@/contexts";
import { Button } from "@/components";

export const DragButton = () => {
  const { hasActiveLicense } = useApp();

  return (
    <Button
      variant="ghost"
      size="icon"
      className={`-ml-[2px] w-fit`}
      aria-label="Drag to move Snarbols window"
      data-tauri-drag-region={hasActiveLicense}
    >
      <GripVerticalIcon className="h-4 w-4" />
    </Button>
  );
};
