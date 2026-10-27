import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import clsx from "clsx";
import { ExternalLink, Plus, Quote, X } from "lucide-react";
import { studio, useStudio } from "@/doc/store";
import { newId } from "@/doc/factory";
import { isOstCard } from "@/doc/board";
import { runCommand } from "@/commands/registry";
import { cardOf, kindsFor, setKindIn, setStage, setTargetIn, updateCardIn } from "@/discovery/ops";
import { ASSUMPTION_CATEGORIES, ASSUMPTION_HINT, ASSUMPTION_LABEL, KIND_LABEL, STAGES, SUB_OUTCOME_LABEL } from "@/discovery/kinds";
import { kindLabel } from "@/discovery/tree";
import { evidenceLabel, isAIIdea, isAssumed } from "@/discovery/evidence";
import { feedback } from "@/commands/feedback";
import type { AssumptionCategory, OstCard, OstEvidence, OstStage } from "@/discovery/types";
import { Button, Field, Hint, IconBtn, Row, Section, Segmented, Select, Tag } from "../controls";
import { r } from "../recipes";
import { CommitArea, CommitInput, CommitNumber } from "./fields";
import { useDiscovery } from "./store";
import KindMark from "./KindMark";
import { saveThenGo } from "./links";
import { openSource, useSources } from "./sources";
import { citation, fromSource } from "@/discovery/sources";

const ICON = { size: 12, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

/** Change one card's data in one undo step. */
const edit = (id: string, fn: (c: OstCard) => void) => studio().mutate((d) => updateCardIn(d, id, fn));

/** The right panel for selected tree cards. */
export default function CardPanel({ ids }: { ids: string[] }) {
  const cards = useStudio(useShallow((s) => ids.map((id) => cardOf(s.doc, id))));
  if (ids.length > 1) return <ManyCards ids={ids} cards={cards.filter((c): c is OstCard => !!c)} />;
  const card = cards[0];
  if (!card) return null;
  return <OneCard id={ids[0]} card={card} />;
}

function ManyCards({ ids, cards }: { ids: string[]; cards: OstCard[] }) {
  const kind = cards.every((c) => c.kind === cards[0].kind) ? cards[0].kind : null;
  const stage = kind && cards.every((c) => c.stage === cards[0].stage) ? cards[0].stage : "";
  return (
    <>
      <Section title={`${ids.length} cards`}>
        {kind ? (
          <Field label="Stage">
            <Select<OstStage> ariaLabel="Stage" value={stage} options={[...STAGES[kind]]} onChange={(v) => setStage(ids, v)} />
          </Field>
        ) : (
          <p className="text-caption text-fg-muted">Pick cards of one kind to set their stage together.</p>
        )}
      </Section>
    </>
  );
}

function OneCard({ id, card }: { id: string; card: OstCard }) {
  const assumed = isAssumed(card);
  const kinds = useStudio(useShallow((s) => kindsFor(s.doc, id)));
  const label = useStudio((s) => kindLabel(s.doc, id));
  // Under an outcome, an outcome is a sub-outcome.
  const underOutcome = useStudio((s) => cardOf(s.doc, s.doc.nodes[id]?.parentId)?.kind === "outcome");
  return (
    <>
      <section className={r.section}>
        <div className="flex h-[32px] items-center gap-[8px]">
          <KindMark kind={card.kind} />
          <h3 className={r.sectionTitle}>{label}</h3>
          <span className="flex-1" />
          {card.createdBy === "ai" && <Tag tone="ai">Drafted</Tag>}
        </div>
        <div className="flex flex-col gap-[8px]">
          <CommitArea ariaLabel="Title" value={card.title} placeholder="Name it" onCommit={(v) => edit(id, (c) => void (c.title = v.replace(/\s*\n\s*/g, " ").trim()))} />
          {kinds.length > 1 && (
            <Field label="Kind">
              <Segmented value={card.kind} options={kinds.map((k) => ({ value: k, label: k === "outcome" && underOutcome ? SUB_OUTCOME_LABEL : KIND_LABEL[k] }))} onChange={(k) => studio().mutate((d) => setKindIn(d, id, k))} />
            </Field>
          )}
          <Field label="Stage">
            <Select<OstStage>
              ariaLabel="Stage"
              value={card.stage}
              options={[...STAGES[card.kind]]}
              onChange={(v) => {
                if (v !== "target") return setStage([id], v);
                let was: string | null = null;
                studio().mutate((d) => void (was = setTargetIn(d, id)));
                if (was) feedback(`Target moved from “${was}”`, { id: "discovery.target" });
              }}
            />
          </Field>
          {assumed && <Hint>Qalam AI drafted this need and nothing backs it yet. Add a quote, a source or a note to make it solid.</Hint>}
          {isAIIdea(card) && (
            <Hint tone="info">
              An idea of Qalam AI&apos;s, not yours. Compare it with other ways to address the need before you build it.
            </Hint>
          )}
        </div>
      </section>
      <Section title="Notes">
        <CommitArea ariaLabel="Description" value={card.description ?? ""} placeholder="What it means, why it matters" rows={3} onCommit={(v) => edit(id, (c) => (v.trim() ? (c.description = v.trim()) : delete c.description))} />
      </Section>
      {card.kind === "outcome" && <MetricSection id={id} card={card} />}
      {(card.kind === "opportunity" || card.kind === "solution" || (card.kind === "outcome" && card.evidence.length > 0)) && <EvidenceSection id={id} card={card} />}
      {card.kind === "solution" && <AssumptionsSection id={id} card={card} />}
      {card.kind === "solution" && <DesignsSection id={id} card={card} />}
      {card.kind === "test" && <TestSection id={id} card={card} />}
    </>
  );
}

function MetricSection({ id, card }: { id: string; card: OstCard }) {
  const m = card.metric ?? { name: "", direction: "increase" as const, baseline: null, current: null, target: null };
  const set = (patch: Partial<typeof m>) => edit(id, (c) => void (c.metric = { ...m, ...patch }));
  return (
    <Section title="Metric">
      <Field label="Customer behaviour it measures">
        <CommitInput ariaLabel="Metric" value={m.name} placeholder="Weekly reorders per customer" onCommit={(name) => set({ name: name.trim() })} />
      </Field>
      <Row>
        <Field label="Unit">
          <CommitInput ariaLabel="Unit" value={m.unit ?? ""} placeholder="orders" onCommit={(unit) => set({ unit: unit.trim() || undefined })} />
        </Field>
        <Field label="Better when it">
          <Select ariaLabel="Direction" value={m.direction} options={[{ value: "increase", label: "Goes up" }, { value: "decrease", label: "Goes down" }]} onChange={(direction) => set({ direction })} />
        </Field>
      </Row>
      <div className="grid grid-cols-3 gap-[8px]">
        <Field label="Baseline">
          <CommitNumber ariaLabel="Baseline" value={m.baseline} onCommit={(baseline) => set({ baseline })} />
        </Field>
        <Field label="Now">
          <CommitNumber ariaLabel="Current" value={m.current} onCommit={(current) => set({ current })} />
        </Field>
        <Field label="Target">
          <CommitNumber ariaLabel="Target" value={m.target} onCommit={(target) => set({ target })} />
        </Field>
      </div>
      <Field label="By when">
        <CommitInput ariaLabel="Timeframe" value={m.timeframe ?? ""} placeholder="End of Q1" onCommit={(t) => set({ timeframe: t.trim() || undefined })} />
      </Field>
    </Section>
  );
}

const SOURCE: Record<OstEvidence["kind"], string> = { answer: "From your answers", note: "Your note", quote: "Quote", dump: "From your brain dump" };

function EvidenceSection({ id, card }: { id: string; card: OstCard }) {
  const [note, setNote] = useState("");
  const add = () => {
    const text = note.trim();
    if (!text) return;
    edit(id, (c) => void c.evidence.push({ id: newId(), kind: "note", text, addedBy: "user", at: Date.now() }));
    setNote("");
  };
  return (
    <Section title={`Evidence${card.evidence.length ? ` · ${card.evidence.length}` : ""}`}>
      {card.evidence.length === 0 && (
        <p className="text-caption text-fg-muted">
          {evidenceLabel(card) || "Nothing yet"}. Quotes from customers make a card solid: drag one here from{" "}
          <button type="button" className="font-medium text-fg underline decoration-fg/30 underline-offset-2" onClick={() => studio().setLeftTab("sources")}>
            Sources
          </button>
          .
        </p>
      )}
      {card.evidence.map((e) => (
        <figure key={e.id} className="group relative flex flex-col gap-[4px] rounded-lg bg-muted py-[8px] pr-[28px] pl-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
          <blockquote className="flex gap-[6px] text-caption text-fg" dir="auto">
            <Quote size={12} className="mt-[2px] shrink-0 text-fg-subtle" />
            <span className="leading-[18px]">{e.text}</span>
          </blockquote>
          <figcaption className="pl-[18px] text-micro text-fg-subtle">{fromSource(e) && e.sourceId ? <SourceCite e={e} /> : SOURCE[e.kind]}</figcaption>
          <span className="absolute top-[4px] right-[4px] hidden group-hover:block">
            <IconBtn size="sm" label="Remove" onClick={() => edit(id, (c) => void (c.evidence = c.evidence.filter((x) => x.id !== e.id)))}>
              <X {...ICON} />
            </IconBtn>
          </span>
        </figure>
      ))}
      <div className="flex flex-col gap-[6px]">
        <textarea
          aria-label="Add a note as evidence"
          className={clsx(r.textarea, "text-body")}
          rows={2}
          value={note}
          placeholder="What you heard or saw, in their words"
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) add();
          }}
        />
        <Button size="sm" variant="secondary" className="self-start" disabled={!note.trim()} onClick={add}>
          <Plus {...ICON} /> Add as evidence
        </Button>
      </div>
    </Section>
  );
}

/** Where words are from (a source, its page, the speaker; or the builder's brain dump), linking to them highlighted in the Sources tab. */
function SourceCite({ e }: { e: OstEvidence }) {
  const source = useSources((s) => s.list.find((x) => x.id === e.sourceId));
  const label = e.kind === "dump" ? SOURCE.dump : citation(e, source?.title) || "Quote";
  const against = e.stance === "against" && <span className="font-medium text-danger">Against · </span>;
  if (!source)
    return (
      <span>
        {against}
        {label}
        {e.sourceId ? " · source removed" : ""}
      </span>
    );
  const q = source.quotes.find((x) => e.span && x.span[0] === e.span[0] && x.span[1] === e.span[1]);
  return (
    <span>
      {against}
      <button type="button" className="text-left underline decoration-fg/20 underline-offset-2 hover:text-fg" title="Show it in the source" onClick={() => openSource(source.id, q?.id)}>
        {label}
      </button>
    </span>
  );
}

function AssumptionsSection({ id, card }: { id: string; card: OstCard }) {
  const [cat, setCat] = useState<AssumptionCategory>("desirability");
  const [text, setText] = useState("");
  const list = card.assumptions ?? [];
  const add = () => {
    const t = text.trim();
    if (!t) return;
    edit(id, (c) => void (c.assumptions = [...(c.assumptions ?? []), { id: newId(), category: cat, text: t, importance: 2, addedBy: "user" }]));
    setText("");
  };
  return (
    <Section title={`Assumptions${list.length ? ` · ${list.length}` : ""}`}>
      {!list.length && <p className="text-caption text-fg-muted">What has to be true for this to work? Test the riskiest before you build.</p>}
      {list.map((a) => (
        <div key={a.id} className="group relative flex flex-col gap-[4px] rounded-lg py-[6px] pr-[28px] pl-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
          <span className="text-micro font-medium text-fg-subtle">{ASSUMPTION_LABEL[a.category]}</span>
          <span className="text-caption leading-[18px] text-fg" dir="auto">
            {a.text}
          </span>
          <span className="absolute top-[4px] right-[4px] hidden group-hover:block">
            <IconBtn size="sm" label="Remove" onClick={() => edit(id, (c) => void (c.assumptions = (c.assumptions ?? []).filter((x) => x.id !== a.id)))}>
              <X {...ICON} />
            </IconBtn>
          </span>
        </div>
      ))}
      <Select<AssumptionCategory> ariaLabel="Kind of assumption" value={cat} options={ASSUMPTION_CATEGORIES.map((c) => ({ value: c, label: `${ASSUMPTION_LABEL[c]}: ${ASSUMPTION_HINT[c]}` }))} onChange={setCat} />
      <textarea aria-label="Assumption" className={clsx(r.textarea, "text-body")} rows={2} value={text} placeholder="Customers will notice the shelf on the home screen" onChange={(e) => setText(e.target.value)} />
      <Button size="sm" variant="secondary" className="self-start" disabled={!text.trim()} onClick={add}>
        <Plus {...ICON} /> Add assumption
      </Button>
    </Section>
  );
}

function DesignsSection({ id, card }: { id: string; card: OstCard }) {
  const links = useDiscovery((s) => s.designs[id]) ?? [];
  return (
    <Section title="Design">
      {links.map((l) => (
        <a key={l.projectId} href={`/p/${l.projectId}${l.first ? `?focus=${l.first}` : ""}`} onClick={saveThenGo} className="q-item flex h-[28px] items-center gap-[8px] rounded-md px-[6px] text-caption text-fg-muted hover:bg-hover hover:text-fg">
          <span className="min-w-0 flex-1 truncate">{l.projectName}</span>
          <span className="tnum text-fg-subtle">
            {l.frames} {l.frames === 1 ? "screen" : "screens"}
          </span>
          <ExternalLink {...ICON} />
        </a>
      ))}
      {!links.length && card.designs?.length ? <p className="text-caption text-fg-muted">Sent to design. Screens made there show up here.</p> : null}
      <Button size="sm" variant="secondary" className="self-start" onClick={() => runCommand("discovery.design-this", "toolbar")}>
        Design this…
      </Button>
    </Section>
  );
}

function TestSection({ id, card }: { id: string; card: OstCard }) {
  const parent = useStudio((s) => {
    const p = s.doc.nodes[id]?.parentId;
    return p && isOstCard(s.doc.nodes[p]) ? s.doc.nodes[p].meta.ost : undefined;
  });
  const t = card.test ?? { assumptionIds: [] };
  const set = (patch: Partial<typeof t>) => edit(id, (c) => void (c.test = { ...t, ...patch }));
  const assumptions = parent?.assumptions ?? [];
  return (
    <Section title="Test">
      {assumptions.length > 0 && (
        <Field label="It tests">
          <div className="flex flex-col gap-[4px]">
            {assumptions.map((a) => {
              const on = t.assumptionIds.includes(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set({ assumptionIds: on ? t.assumptionIds.filter((x) => x !== a.id) : [...t.assumptionIds, a.id] })}
                  className={clsx("q-item flex items-start gap-[8px] rounded-md px-[8px] py-[6px] text-left text-caption", on ? r.optionCardSelected : "hover:bg-hover")}
                >
                  <span className="text-micro font-medium text-fg-subtle">{ASSUMPTION_LABEL[a.category]}</span>
                  <span className="min-w-0 flex-1 text-fg">{a.text}</span>
                </button>
              );
            })}
          </div>
        </Field>
      )}
      <Field label="How">
        <CommitInput ariaLabel="Method" value={t.method ?? ""} placeholder="5-user prototype test" onCommit={(method) => set({ method: method.trim() || undefined })} />
      </Field>
      <Field label="It passes when">
        <CommitInput ariaLabel="Pass mark" value={t.criterion ?? ""} placeholder="4 of 5 find it without help" onCommit={(criterion) => set({ criterion: criterion.trim() || undefined })} />
      </Field>
      <Field label="What happened">
        <CommitArea ariaLabel="Result" value={t.result ?? ""} placeholder="3 of 5 found it; two scrolled past" onCommit={(result) => set({ result: result.trim() || undefined })} />
      </Field>
    </Section>
  );
}

