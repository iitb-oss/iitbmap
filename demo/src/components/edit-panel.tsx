import { Download, PenLine, Undo2, X } from "lucide-react";
import type { MapEdits } from "../../../src/index";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

export function EditPanel({
  edits,
  drawing,
  canUndo,
  onDraw,
  onFinish,
  onCancel,
  onUndo,
  onExport,
  onDiscard,
  onClose,
}: {
  edits: MapEdits;
  drawing: [number, number][] | null;
  canUndo: boolean;
  onDraw: () => void;
  onFinish: () => void;
  onCancel: () => void;
  onUndo: () => void;
  onExport: () => void;
  onDiscard: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <Separator />
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Edit mode</span>
        <Button variant="ghost" size="icon" title="Leave edit mode" aria-label="Leave edit mode" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>
      {drawing ? (
        <>
          <p className="text-xs text-muted-foreground">Click the map to add corners ({drawing.length} so far).</p>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={onFinish} disabled={drawing.length < 3}>
              Finish shape
            </Button>
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Drag a building label to move and pin it, or a food place to move it; shift-click either to reset it. Click an
            unlabelled building to name it.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onDraw}>
              <PenLine className="size-4" />
              Draw building
            </Button>
            <Button variant="outline" size="icon" title="Undo" aria-label="Undo" onClick={onUndo} disabled={!canUndo}>
              <Undo2 className="size-4" />
            </Button>
          </div>
        </>
      )}
      <p className="text-xs text-muted-foreground">
        {Object.keys(edits.pins).length} pinned labels, {edits.added.length} added buildings,{" "}
        {Object.keys(edits.food ?? {}).length} moved food places. Saved in this browser; export and
        commit as <code>src/iitb-edits.json</code> to freeze them for everyone.
      </p>
      <div className="flex gap-2">
        <Button className="flex-1" onClick={onExport}>
          <Download className="size-4" />
          Export
        </Button>
        <Button variant="ghost" onClick={onDiscard}>
          Discard local
        </Button>
      </div>
    </>
  );
}
