import { PanelLeftClose } from "lucide-react";
import { IconBtn } from "../controls";
import { PanelHeader } from "../LeftDock";
import SourcesPanel, { SourcesHeaderActions } from "../discovery/SourcesPanel";

/**
 * The space's sources beside its canvas, as a board's Sources tab: each source to read (its
 * quotes drag onto cards), and adding one, which goes to the picked card's board.
 */
export function SourcesDock({ onClose }: { onClose: () => void }) {
  return (
    <aside aria-label="Sources" className="q-glass flex w-[300px] shrink-0 flex-col border-r border-line-subtle bg-panel">
      <PanelHeader title="Sources">
        <SourcesHeaderActions />
        <IconBtn size="sm" label="Close the sources" onClick={onClose}>
          <PanelLeftClose size={14} absoluteStrokeWidth strokeWidth={1.25} />
        </IconBtn>
      </PanelHeader>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <SourcesPanel />
      </div>
    </aside>
  );
}
