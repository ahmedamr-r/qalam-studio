import { useStudio } from "@/doc/store";
import { runCommand, useCommand } from "@/commands/registry";
import { cardOf } from "@/discovery/ops";
import { Button } from "../controls";

/**
 * The chat's foot on a Discovery board. Qalam AI works on the tree from its cards (Design this on
 * a solution) and from the product interview; their runs land in this chat.
 */
export default function BoardComposer() {
  const solution = useStudio((s) => (s.selection.length === 1 && cardOf(s.doc, s.selection[0])?.kind === "solution" ? s.selection[0] : null));
  const design = useCommand("discovery.design-this");
  return (
    <div className="flex shrink-0 flex-col gap-[8px] border-t border-line-subtle px-[14px] py-[12px]">
      <p className="text-caption text-fg-muted">
        Qalam AI drafts the tree from your answers, and reads a <b className="font-medium text-fg">brain dump</b> (paste it on the board) into it. Select a solution and choose <b className="font-medium text-fg">Design this</b> to send it to a Screens project, where Qalam AI plans the screens with you.
      </p>
      <div className="flex flex-wrap gap-[6px]">
        <Button size="sm" variant="secondary" onClick={() => runCommand("discovery.brain-dump", "toolbar")}>
          Brain dump…
        </Button>
        <Button size="sm" variant="secondary" onClick={() => runCommand("discovery.redo-interview", "toolbar")}>
          Redo the interview…
        </Button>
        <Button size="sm" variant={solution ? "primary" : "secondary"} disabled={design?.enabled !== true} onClick={() => runCommand("discovery.design-this", "toolbar")}>
          Design this…
        </Button>
      </div>
    </div>
  );
}
