import { useShallow } from "zustand/react/shallow";
import clsx from "clsx";
import { LucideProvider } from "lucide-react";
import { studio, useStudio } from "@/doc/store";
import type { Doc } from "@/doc/schema";
import { isOstCard } from "@/doc/board";
import { runCommand } from "@/commands/registry";
import { cardOf, updateCardIn } from "@/discovery/ops";
import { allCards, childCards, outcomeRoots } from "@/discovery/tree";
import { isAssumed } from "@/discovery/evidence";
import { Button, Field, Section, Segmented, Select } from "../controls";
import { useOrgContext } from "@/org/context";
import { updateProject, useProject } from "@/projects/session";
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

/** Every outcome on the board, sub-outcomes indented under theirs. */
function outcomeList(doc: Doc): { id: string; depth: number }[] {
  const out: { id: string; depth: number }[] = [];
  const walk = (id: string, depth: number) => {
    if (cardOf(doc, id)?.kind !== "outcome") return;
    out.push({ id, depth });
    for (const c of childCards(doc, id)) walk(c, depth + 1);
  };
  for (const r of outcomeRoots(doc)) walk(r, 0);
  return out;
}

function TreePanel() {
  const doc = useStudio((s) => s.doc);
  const cards = allCards(doc);
  const outcomes = outcomeList(doc);
  const roots = outcomeRoots(doc);
  const count = (k: string) => cards.filter((c) => c.card.kind === k).length;
  const assumed = cards.filter((c) => isAssumed(c.card)).length;
  const lr = roots.length > 0 && roots.every((id) => cardOf(doc, id)?.orientation === "lr");

  return (
    <div aria-label="Tree" data-region="design" className="flex flex-col pb-[24px]">
      <Section title={outcomes.length > 1 ? "Goals" : "Goal"}>
        {outcomes.length ? (
          outcomes.map(({ id, depth }) => <OutcomeButton key={id} id={id} depth={depth} />)
        ) : (
          <>
            <p className="text-caption text-fg-muted">A tree starts from a goal: a change in what your customers do that the team can move.</p>
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
                ["opportunity", "Problems"],
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
      {roots.length > 0 && (
        <Section title="Layout">
          <Field label={roots.length > 1 ? "The trees grow" : "The tree grows"}>
            <Segmented
              value={lr ? "lr" : "tb"}
              options={[
                { value: "tb", label: "Down" },
                { value: "lr", label: "Right" },
              ]}
              onChange={(v) => {
                if ((v === "lr") === lr) return;
                studio().mutate((d) => roots.forEach((id) => updateCardIn(d, id, (c) => (v === "lr" ? (c.orientation = "lr") : delete c.orientation))));
                requestAnimationFrame(() => getController()?.glideToFit());
              }}
            />
          </Field>
        </Section>
      )}
      <Section title="Product">
        <BoardProduct />
        <p className="text-caption text-fg-muted">The goal and first problems come from a short interview about your product.</p>
        <Button size="sm" variant="secondary" className="self-start" onClick={() => runCommand("discovery.redo-interview", "toolbar")}>
          {roots.length ? "Redo the interview…" : "Answer the questions…"}
        </Button>
      </Section>
    </div>
  );
}

/** An outcome in the tree's overview: its title and metric; a click picks it and brings it into view. */
function OutcomeButton({ id, depth }: { id: string; depth: number }) {
  const outcome = useStudio((s) => cardOf(s.doc, id));
  if (!outcome) return null;
  const m = outcome.metric;
  return (
    <button
      type="button"
      onClick={() => {
        studio().select([id]);
        getController()?.glideToFit([id]);
      }}
      style={depth ? { marginLeft: Math.min(depth, 3) * 12 } : undefined}
      className="q-item flex flex-col items-start gap-[4px] rounded-lg bg-muted px-[10px] py-[8px] text-left shadow-[inset_0_0_0_1px_var(--color-line-subtle)] hover:bg-hover"
    >
      <span className={clsx("flex items-center gap-[6px] text-body text-fg", !depth && "font-medium")}>
        <KindMark kind="outcome" className={clsx("shrink-0", depth ? "text-fg-subtle" : "text-fg")} />
        {outcome.title || (depth ? "Untitled sub-goal" : "Untitled goal")}
      </span>
      {m?.name && (
        <span className="text-caption text-fg-muted tnum">
          {m.name}
          {m.baseline !== null && m.target !== null ? ` · ${m.baseline} → ${m.target}${m.unit ? ` ${m.unit}` : ""}` : ""}
        </span>
      )}
    </button>
  );
}

/**
 * The product this board is for (or the whole organization): Qalam AI reads what that product is,
 * and the board and its new sources are listed under it on the home.
 */
function BoardProduct() {
  const products = useOrgContext((s) => s.products);
  const product = useProject((s) => s.project?.product ?? null);
  const value = product && products.some((p) => p.id === product) ? product : "org";
  return (
    <Field label="For">
      <Select
        ariaLabel="The product this board is for"
        value={value}
        options={[{ value: "org", label: "The whole organization" }, ...products.map((p) => ({ value: p.id, label: p.name }))]}
        onChange={(v) => void updateProject({ product: v === "org" ? undefined : v })}
      />
    </Field>
  );
}
