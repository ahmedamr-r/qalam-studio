import { useStudio } from "@/doc/store";
import { cardOf } from "@/discovery/ops";
import { STAGES } from "@/discovery/kinds";
import { CommandItem, MenuItem, MenuSeparator, SubMenu } from "../menu";
import { QalamAIGlyph } from "../brand";
import type { AIAction } from "../surfaces/ai-actions";

/**
 * The right-click menu on tree cards: the tree's own commands in place of Figma's layer ones
 * (group, auto layout, flip and the rest don't apply to a card that keeps its place in the tree).
 */
export default function CardMenuItems({ ai }: { ai: AIAction[] }) {
  // The stages to offer: the selected cards' kind, when they share one.
  const kind = useStudio((s) => {
    const kinds = new Set(s.selection.map((id) => cardOf(s.doc, id)?.kind));
    return kinds.size === 1 ? [...kinds][0] : undefined;
  });
  return (
    <>
      <CommandItem id="discovery.add-child" label="Add card under it" source="context" />
      <CommandItem id="discovery.add-sibling" label="Add card next to it" source="context" />
      <CommandItem id="discovery.edit-title" label="Edit title" source="context" />
      <MenuSeparator />
      {kind && (
        <SubMenu label="Stage" checks>
          {STAGES[kind].map((st) => (
            <CommandItem key={st.value} id={`discovery.stage.${st.value}`} label={st.label} source="context" />
          ))}
        </SubMenu>
      )}
      <CommandItem id="discovery.collapse" label="Fold or unfold branch" source="context" />
      <MenuSeparator />
      <CommandItem id="edit.copy" source="context" />
      <CommandItem id="edit.duplicate" source="context" />
      <MenuSeparator />
      <SubMenu label="Ask Qalam AI" icon={<QalamAIGlyph size={14} />}>
        {ai.map((a) => (
          <MenuItem key={a.id} disabled={a.enabled === true ? false : a.enabled} onSelect={a.run}>
            {a.label}
          </MenuItem>
        ))}
      </SubMenu>
      <MenuSeparator />
      <CommandItem id="discovery.delete" label="Delete branch" danger source="context" />
      <CommandItem id="discovery.delete-keep" label="Delete card, keep what's under it" danger source="context" />
    </>
  );
}
