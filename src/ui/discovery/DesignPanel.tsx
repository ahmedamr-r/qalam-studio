import { useShallow } from "zustand/react/shallow";
import { LucideProvider } from "lucide-react";
import { studio, useStudio } from "@/doc/store";
import { isOstCard } from "@/doc/board";
import { runCommand } from "@/commands/registry";
import { cardOf, updateCardIn } from "@/discovery/ops";
import { allCards } from "@/discovery/tree";
import { isAssumed } from "@/discovery/evidence";
import { Button, CommandKbd, Field, Section, Segmented } from "../controls";
import { r } from "../recipes";
import PropertiesPanel from "../PropertiesPanel";
import { getController } from "../CanvasView";
import CardPanel from "./CardPanel";
import KindMark from "./KindMark";
import { useDiscovery } from "./store";

/**
 * The right panel on a Discovery board: the card panel for tree cards, the tree's overview when
 * nothing is selected, and the usual Design panel for anything else (stickies, shapes, text).
 */
export default function DesignPanel() {
  const ids = useStudio(useShallow((s) => s.selection.filter((id) => s.doc.nodes[id])));
  const allCardsSelected = useStudio((s) => s.selection.length > 0 && s.selection.every((id) => isOstCard(s.doc.nodes[id])));
  if (!ids.length) return <TreePanel />;
  if (allCardsSelected)
    return (
      <LucideProvider strokeWidth={1.25} absoluteStrokeWidth>
        <div aria-label="Card" data-region="design" className="flex flex-col pb-[24px]">
          <CardPanel ids={ids} />
        </div>
      </LucideProvider>
    );
  return <PropertiesPanel />;
}

const KEYS: [string, string][] = [
  ["discovery.add-child", "A card under it"],
  ["discovery.add-sibling", "A card next to it"],
  ["discovery.edit-title", "Type its title"],
  ["discovery.collapse", "Fold its branch"],
  ["tool.card", "Card tool"],
  ["tool.sticky", "Sticky note"],
];

function TreePanel() {
  const doc = useStudio((s) => s.doc);
  const cards = allCards(doc);
  const outcomeId = doc.roots.find((id) => cardOf(doc, id)?.kind === "outcome") ?? null;
  const outcome = outcomeId ? cardOf(doc, outcomeId) : null;
  const count = (k: string) => cards.filter((c) => c.card.kind === k).length;
  const assumed = cards.filter((c) => isAssumed(c.card)).length;
  const lr = outcome?.orientation === "lr";
  const m = outcome?.metric;

  return (
    <div aria-label="Tree" data-region="design" className="flex flex-col pb-[24px]">
      <Section title="Outcome">
        {outcome ? (
          <button
            type="button"
            onClick={() => {
              studio().select([outcomeId!]);
              getController()?.glideToFit([outcomeId!]);
            }}
            className="q-item flex flex-col items-start gap-[4px] rounded-lg bg-muted px-[10px] py-[8px] text-left shadow-[inset_0_0_0_1px_var(--color-line-subtle)] hover:bg-hover"
          >
            <span className="flex items-center gap-[6px] text-body font-medium text-fg">
              <KindMark kind="outcome" className="shrink-0 text-fg" />
              {outcome.title || "Untitled outcome"}
            </span>
            {m?.name && (
              <span className="text-caption text-fg-muted tnum">
                {m.name}
                {m.baseline !== null && m.target !== null ? ` · ${m.baseline} → ${m.target}${m.unit ? ` ${m.unit}` : ""}` : ""}
              </span>
            )}
          </button>
        ) : (
          <>
            <p className="text-caption text-fg-muted">A tree starts from one outcome: a change in what your customers do that the team can move.</p>
            <Button size="sm" className="self-start" onClick={() => useDiscovery.setState({ sheet: "start" })}>
              Start the tree…
            </Button>
          </>
        )}
      </Section>
      {cards.length > 0 && (
        <Section title="On the board">
          <ul className="flex flex-col gap-[4px] text-caption text-fg-muted">
            {(
              [
                ["opportunity", "Opportunities"],
                ["solution", "Solutions"],
                ["test", "Tests"],
              ] as const
            ).map(([k, label]) => (
              <li key={k} className="flex items-center gap-[8px]">
                <KindMark kind={k} />
                <span className="flex-1">{label}</span>
                <span className="tnum text-fg">{count(k)}</span>
              </li>
            ))}
          </ul>
          {assumed > 0 && (
            <Button size="sm" variant="secondary" className="self-start" onClick={() => runCommand("discovery.select-assumed", "toolbar")}>
              Select {assumed} assumed
            </Button>
          )}
        </Section>
      )}
      {outcome && (
        <Section title="Layout">
          <Field label="The tree grows">
            <Segmented
              value={lr ? "lr" : "tb"}
              options={[
                { value: "tb", label: "Down" },
                { value: "lr", label: "Right" },
              ]}
              onChange={(v) => {
                if ((v === "lr") === lr) return;
                studio().mutate((d) => updateCardIn(d, outcomeId!, (c) => (v === "lr" ? (c.orientation = "lr") : delete c.orientation)));
                requestAnimationFrame(() => getController()?.glideToFit());
              }}
            />
          </Field>
        </Section>
      )}
      <Section title="Product">
        <p className="text-caption text-fg-muted">The outcome and first opportunities come from a short interview about your product.</p>
        <Button size="sm" variant="secondary" className="self-start" onClick={() => runCommand("discovery.redo-interview", "toolbar")}>
          {outcome ? "Redo the interview…" : "Answer the questions…"}
        </Button>
      </Section>
      <Section title="Keys">
        <ul className={r.rows}>
          {KEYS.map(([id, label]) => (
            <li key={id} className="flex items-center justify-between gap-[8px] text-caption text-fg-muted">
              {label}
              <CommandKbd command={id} size="sm" />
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
