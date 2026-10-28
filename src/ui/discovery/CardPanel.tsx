import { projectHref, topicHref } from "@/projects/model";
import { aboutCard } from "@/hub/checks";
import { cardRef } from "@/hub/pieces";
import { onOrgChange } from "@/org/live";
import { noticesDb, onNoticesWritten, type LinkedCard } from "@/org/notices";
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import clsx from "clsx";
import { ExternalLink, PenLine, Plus, Quote, X } from "lucide-react";
import { studio, useStudio } from "@/doc/store";
import { newId } from "@/doc/factory";
import { isOstCard } from "@/doc/board";
import { runCommand } from "@/commands/registry";
import { cardOf, kindsFor, setKindIn, setStage, setTargetIn, updateCardIn } from "@/discovery/ops";
import { ASSUMPTION_CATEGORIES, ASSUMPTION_HINT, ASSUMPTION_LABEL, KIND_LABEL, STAGES, SUB_OUTCOME_LABEL } from "@/discovery/kinds";
import { kindLabel } from "@/discovery/tree";
import { evidenceRows, evidenceSummary, isAIIdea, isAssumed, type EvidenceSummary } from "@/discovery/evidence";
import { strengthFill, strengthOf, type Strength } from "@/hub/needs";
import { feedback } from "@/commands/feedback";
import type { AssumptionCategory, OstCard, OstEvidence, OstMetric, OstStage } from "@/discovery/types";
import { parseWorkUrl, WORK_LABEL, workKey } from "@/connectors/work";
import { MetricSource } from "../numbers/MetricSource";
import { refreshWork } from "./work";
import { Button, Field, Hint, IconBtn, Row, Section, Segmented, Select, Tag, Tip } from "../controls";
import { r } from "../recipes";
import { Meter } from "../viz";
import { CommitArea, CommitInput, CommitNumber } from "./fields";
import { useDiscovery } from "./store";
import KindMark from "./KindMark";
import { saveThenGo } from "./links";
import { addFromOrganization, openSource, useSources } from "./sources";
import { orgJson } from "@/org/client";
import { useProject } from "@/projects/session";
import DecisionRow from "../decisions/DecisionRow";
import { useDecisions } from "../decisions/list";
import { citation, fromSource, quoteOf, type SourceRecord } from "@/discovery/sources";

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
          {assumed && <Hint>Qalam AI drafted this problem and nothing backs it yet. Add a quote, a source or a note to make it solid.</Hint>}
          {isAIIdea(card) && (
            <Hint tone="info">
              An idea of Qalam AI&apos;s, not yours. Compare it with other ways to address the need before you build it.
            </Hint>
          )}
        </div>
      </section>
      <NoticedSection id={id} />
      <Section title="Notes">
        <CommitArea ariaLabel="Description" value={card.description ?? ""} placeholder="What it means, why it matters" rows={3} onCommit={(v) => edit(id, (c) => (v.trim() ? (c.description = v.trim()) : delete c.description))} />
      </Section>
      {card.kind === "outcome" && <MetricSection id={id} card={card} />}
      {(card.kind === "opportunity" || card.kind === "solution" || (card.kind === "outcome" && card.evidence.length > 0)) && <EvidenceSection id={id} card={card} />}
      {card.kind === "solution" && <AssumptionsSection id={id} card={card} />}
      {card.kind === "solution" && <DesignsSection id={id} card={card} />}
      {card.kind === "solution" && <WorkSection id={id} card={card} />}
      {card.kind === "test" && <TestSection id={id} card={card} />}
      <HistorySection id={id} />
    </>
  );
}

const cardHref = (board: string, card: string) => `${projectHref({ id: board, type: "discovery" })}?card=${encodeURIComponent(card)}`;
const linkCls = "font-medium text-fg underline decoration-fg/30 underline-offset-2";

/**
 * What needs a look about this card (the organization's checks, Qalam AI's last review), and the
 * cards on other boards it's linked to as the same need.
 */
function NoticedSection({ id }: { id: string }) {
  const board = useProject((s) => s.project?.id);
  const notices = useDiscovery(useShallow((s) => (board ? s.notices.filter((n) => aboutCard(n, board, id)) : [])));
  const [links, setLinks] = useState<LinkedCard[]>([]);
  useEffect(() => {
    if (!board) return;
    let alive = true;
    const load = () =>
      void noticesDb.linkedTo(cardRef(board, id)).then(
        (l) => alive && setLinks(l),
        () => {},
      );
    load();
    const offWritten = onNoticesWritten(load);
    const off = onOrgChange((c) => c.kind === "relation" && load());
    return () => {
      alive = false;
      offWritten();
      off();
    };
  }, [board, id]);
  if (!board || (!notices.length && !links.length)) return null;
  return (
    <Section title="Qalam noticed">
      {notices.map((n) => {
        // The other card: of a pair, the one that isn't this.
        const other = n.other ? (n.board === board && n.card === id ? n.other : n.board && n.card ? { board: n.board, card: n.card } : null) : null;
        return (
          <div key={n.key} className="flex flex-col gap-[4px] rounded-lg bg-warning-subtle px-[10px] py-[8px]">
            <p className="text-caption font-medium text-fg">{n.title}</p>
            <p className="text-caption text-fg-muted">{n.why}</p>
            <div className="flex flex-wrap items-center gap-x-[10px] gap-y-[4px] text-caption">
              {other && (
                <a href={cardHref(other.board, other.card)} onClick={saveThenGo} className={linkCls}>
                  Open the other card
                </a>
              )}
              {n.topic && (
                <a href={topicHref(n.topic)} onClick={saveThenGo} className={linkCls}>
                  Open the topic page
                </a>
              )}
              {n.kind === "same-need" && other && (
                <button type="button" className={linkCls} onClick={() => void noticesDb.link(cardRef(board, id), cardRef(other.board, other.card))}>
                  Link them
                </button>
              )}
              <button type="button" className="text-fg-muted hover:text-fg" onClick={() => void noticesDb.dismiss(n.key)}>
                Dismiss
              </button>
            </div>
          </div>
        );
      })}
      {links.map((l) => (
        <div key={l.ref} className="flex items-start justify-between gap-[8px] text-caption">
          <span className="text-fg-muted">
            The same need on {l.boardName}:{" "}
            <a href={cardHref(l.board, l.card)} onClick={saveThenGo} className={linkCls}>
              {l.title || "a card"}
            </a>
          </span>
          <button type="button" className="shrink-0 text-fg-subtle hover:text-fg" onClick={() => void noticesDb.link(cardRef(board, id), l.ref, false)}>
            Unlink
          </button>
        </div>
      ))}
    </Section>
  );
}

/** What was decided about this card, newest first, with what it rested on each time (the organization's decision log). */
function HistorySection({ id }: { id: string }) {
  const board = useProject((s) => s.project?.id);
  const list = useDecisions(board ? { board, card: id, limit: 30 } : null);
  if (!list?.length) return null;
  return (
    <Section title={`History · ${list.length}`}>
      <div className="flex flex-col divide-y divide-line-subtle">
        {list.map((d) => (
          <DecisionRow key={d.id} d={d} />
        ))}
      </div>
    </Section>
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
      <MetricSource m={m} onChange={(next) => edit(id, (c) => void (c.metric = next))} onLeave={saveThenGo} />
    </Section>
  );
}

/**
 * Where the solution is being built or designed: Linear and GitHub issues and pull requests (with
 * where they stand, as the tool says), Jira issues, Figma designs. The stage stays the team's call.
 */
function WorkSection({ id, card }: { id: string; card: OstCard }) {
  const statuses = useDiscovery((s) => s.work);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const work = card.work ?? [];
  const add = () => {
    const w = parseWorkUrl(url);
    if (!w) return setNote("Paste a Linear or Jira issue, a GitHub issue or pull request, or a Figma design.");
    if (work.some((x) => workKey(x) === workKey(w))) return setNote("It's linked already.");
    edit(id, (c) => void (c.work = [...(c.work ?? []), w]));
    setUrl("");
    setNote(null);
    void refreshWork([w]);
  };
  return (
    <Section title={`Work${work.length ? ` · ${work.length}` : ""}`}>
      {work.map((w) => {
        const st = statuses[workKey(w)];
        return (
          <div key={workKey(w)} className="flex h-[28px] items-center gap-[8px] rounded-md px-[6px] text-caption hover:bg-hover">
            <span className="shrink-0 text-fg-subtle">{WORK_LABEL[w.connector] ?? w.connector}</span>
            <span className="min-w-0 flex-1 truncate text-fg" title={st?.title}>
              {w.ref}
            </span>
            {st?.label && (
              <span className={clsx("inline-flex shrink-0 items-center gap-[4px]", st.state === "done" ? "text-success" : st.state === "canceled" ? "text-warning" : "text-fg-muted")}>
                <span aria-hidden className="size-[6px] rounded-full bg-current" />
                {st.label}
              </span>
            )}
            <a href={w.url} target="_blank" rel="noreferrer" aria-label={`Open ${w.ref}`} className={r.iconButtonSm}>
              <ExternalLink {...ICON} />
            </a>
            <IconBtn size="sm" label={`Unlink ${w.ref}`} onClick={() => edit(id, (c) => void (c.work = (c.work ?? []).filter((x) => workKey(x) !== workKey(w))))}>
              <X {...ICON} />
            </IconBtn>
          </div>
        );
      })}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        className="flex items-center gap-[6px]"
      >
        <span className={clsx(r.field, "flex-1")}>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste an issue, PR or design link" aria-label="Link work" className={r.fieldInput} />
        </span>
        <Button type="submit" size="sm" variant="secondary" disabled={!url.trim()}>
          Link
        </Button>
      </form>
      {note && <p className="text-micro text-fg-subtle">{note}</p>}
      {work.some((w) => w.connector === "linear" || w.connector === "github") && (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void refreshWork(work, true).finally(() => setBusy(false));
          }}
        >
          {busy ? "Asking…" : "Ask again where they stand"}
        </Button>
      )}
    </Section>
  );
}

const SOURCE: Record<OstEvidence["kind"], string> = { answer: "From your answers", note: "Your note", quote: "Quote", dump: "From your brain dump" };
/** Whose words a row is when no one is named: the team's own, by kind. */
const SHORT: Record<OstEvidence["kind"], string> = { answer: "Your answer", note: "Your note", quote: "Quote", dump: "Brain dump" };
/** A source's title up to its first comma or bracket ("Support tickets, week of Oct 6": "Support tickets"), for a row's narrow label. */
const shortTitle = (title: string) => title.split(/\s*[,(]/)[0].trim() || title;
const STRENGTH: Record<Strength, string> = { strong: "Strong", growing: "Growing", thin: "Thin", assumed: "Assumed" };
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/**
 * What a card rests on: a strip with how strong that is (as a need page's strip counts it), then a
 * line per piece of evidence, the whole words, where they're from and Remove on a click.
 */
function EvidenceSection({ id, card }: { id: string; card: OstCard }) {
  const [note, setNote] = useState("");
  const add = () => {
    const text = note.trim();
    if (!text) return;
    edit(id, (c) => void c.evidence.push({ id: newId(), kind: "note", text, addedBy: "user", at: Date.now() }));
    setNote("");
  };
  const rows = evidenceRows(card);
  return (
    <Section title="Evidence">
      {rows.length === 0 ? (
        <NoEvidence />
      ) : (
        <>
          {/* An outcome's words say where the goal came from, not how solid it is. */}
          {card.kind !== "outcome" && <EvidenceStrip s={evidenceSummary(card)} />}
          <ul aria-label="Evidence" className="-mx-[6px] flex flex-col">
            {rows.map((e) => (
              <EvidenceRow key={e.id} id={id} e={e} />
            ))}
          </ul>
        </>
      )}
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

/** The card's evidence at a glance: how strong (by the sources of its customers' quotes), how many quotes and sources, what's against it, who said it. */
function EvidenceStrip({ s }: { s: EvidenceSummary }) {
  const word = s.quotes ? STRENGTH[strengthOf(s)] : s.ours ? "Your words only" : "Nothing backs it";
  return (
    <div role="group" aria-label="What backs this card" className="flex flex-col gap-[8px] rounded-lg bg-muted px-[10px] py-[8px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <div className="flex items-center gap-[12px]">
        <span className="flex w-[104px] shrink-0 flex-col gap-[6px]">
          <span className="text-caption font-medium text-fg">{word}</span>
          <Meter value={strengthFill(s)} label={s.quotes ? `${word}, from ${plural(s.sources, "source")}` : word} />
        </span>
        <span className="flex min-w-0 flex-col gap-[2px] text-caption tnum">
          {s.quotes ? (
            <Tip label={s.from.length ? s.from.join(" · ") : plural(s.sources, "source")}>
              <span tabIndex={0} className="truncate text-fg">
                {plural(s.quotes, "quote")} · {plural(s.sources, "source")}
              </span>
            </Tip>
          ) : (
            <span className="text-fg-muted">No customer words yet</span>
          )}
          <span className={s.against ? "text-warning" : "text-fg-subtle"}>{s.against ? `${s.against} against` : "Nothing against"}</span>
        </span>
      </div>
      {s.who.length > 0 && (
        <div className="flex flex-wrap items-center gap-[4px]">
          <span className="mr-[2px] text-micro text-fg-subtle">Who</span>
          {s.who.slice(0, 4).map((w) => (
            <span key={w} className={clsx(r.chip, "max-w-[120px]")}>
              <span className="truncate">{w}</span>
            </span>
          ))}
          {s.who.length > 4 && (
            <Tip label={s.who.slice(4).join(", ")}>
              <span tabIndex={0} className="text-micro text-fg-subtle tnum">
                +{s.who.length - 4}
              </span>
            </Tip>
          )}
        </div>
      )}
    </div>
  );
}

/** One piece of evidence in a line: how its words start and whose they are. A click shows them whole, where they're from, and Remove. */
function EvidenceRow({ id, e }: { id: string; e: OstEvidence }) {
  const [open, setOpen] = useState(false);
  const against = e.stance === "against";
  const who = e.kind === "quote" ? (e.speaker ?? (e.sourceTitle ? shortTitle(e.sourceTitle) : SHORT.quote)) : SHORT[e.kind];
  const Mark = e.kind === "quote" ? Quote : PenLine;
  return (
    <li className="flex flex-col">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="q-item flex h-[28px] w-full items-center gap-[6px] rounded-md px-[6px] text-left hover:bg-hover aria-expanded:bg-hover">
        <Mark {...ICON} className={clsx("shrink-0", against ? "text-warning" : "text-fg-subtle")} />
        <span className="min-w-0 flex-1 truncate text-caption text-fg" dir="auto">
          {e.text}
        </span>
        <span className="max-w-[104px] shrink-0 truncate text-micro text-fg-subtle">
          {against && <span className="text-warning">Against · </span>}
          {who}
        </span>
      </button>
      {open && (
        <figure className="mx-[6px] mt-[2px] mb-[6px] flex flex-col gap-[6px] rounded-md bg-muted px-[10px] py-[8px]">
          <blockquote className="text-caption leading-[18px] text-fg" dir="auto">
            {e.text}
          </blockquote>
          <figcaption className="flex items-start gap-[8px] text-micro text-fg-subtle">
            <span className="min-w-0 flex-1">{fromSource(e) && e.sourceId ? <SourceCite e={e} /> : SOURCE[e.kind]}</span>
            <button type="button" className="shrink-0 hover:text-danger" onClick={() => edit(id, (c) => void (c.evidence = c.evidence.filter((x) => x.id !== e.id)))}>
              Remove
            </button>
          </figcaption>
        </figure>
      )}
    </li>
  );
}

/** Before any evidence: what its lines will look like, faded, and where quotes come from. */
function NoEvidence() {
  return (
    <div className="relative overflow-hidden rounded-lg bg-muted px-[10px] py-[4px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <div aria-hidden className="flex flex-col opacity-40">
        {[0.62, 0.4].map((w, i) => (
          <div key={i} className="flex h-[26px] items-center gap-[6px]">
            <Quote {...ICON} className="shrink-0 text-fg-subtle" />
            <span className="h-[6px] rounded-full bg-active" style={{ width: `${w * 100}%` }} />
            <span className="ml-auto h-[6px] w-[40px] rounded-full bg-active" />
          </div>
        ))}
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <Tip label="Customers' words make a card solid. Drag a quote from Sources onto the card.">
          <button type="button" className={clsx(r.buttonSm, r.buttonSecondary)} onClick={() => studio().setLeftTab("sources")}>
            <Quote {...ICON} /> Find quotes in Sources
          </button>
        </Tip>
      </div>
    </div>
  );
}

/** Where words are from (a source, its page, the speaker; or the builder's brain dump), linking to them highlighted in the Sources tab. */
function SourceCite({ e }: { e: OstEvidence }) {
  const onBoard = useSources((s) => s.list.find((x) => x.id === e.sourceId));
  // Taken off this board, a source is still the organization's: its quote still reads from it.
  const inOrg = useOrgSource(onBoard ? undefined : e.sourceId);
  const source = onBoard ?? inOrg;
  const label = e.kind === "dump" ? SOURCE.dump : citation(e, source?.title) || "Quote";
  const against = e.stance === "against" && <span className="font-medium text-danger">Against · </span>;
  if (!source)
    return (
      <span>
        {against}
        {label}
        {e.sourceId && inOrg === null ? " · source deleted" : ""}
      </span>
    );
  const q = quoteOf(source, e);
  // The source's text was edited since: its words read differently now.
  const changed = q && q.text !== e.text && <span className="text-warning"> · changed in the source</span>;
  if (!onBoard)
    return (
      <span>
        {against}
        <button type="button" className="text-left underline decoration-fg/20 underline-offset-2 hover:text-fg" title="Put the source back on this board and show it" onClick={() => void addFromOrganization(source.id).then(() => openSource(source.id, q?.id))}>
          {label}
        </button>
        <span className="text-fg-subtle"> · not on this board</span>
        {changed}
      </span>
    );
  return (
    <span>
      {against}
      <button type="button" className="text-left underline decoration-fg/20 underline-offset-2 hover:text-fg" title="Show it in the source" onClick={() => openSource(source.id, q?.id)}>
        {label}
      </button>
      {changed}
    </span>
  );
}

/** One of the organization's sources, read once (null: it's gone from the organization). */
const orgSources = new Map<string, Promise<SourceRecord | null>>();
function useOrgSource(id: string | undefined): SourceRecord | null | undefined {
  const [s, setS] = useState<SourceRecord | null | undefined>(undefined);
  useEffect(() => {
    if (!id) return setS(undefined);
    let live = true;
    let p = orgSources.get(id);
    if (!p) {
      p = orgJson<SourceRecord>(`/sources/${id}`).catch(() => null);
      orgSources.set(id, p);
    }
    void p.then((x) => live && setS(x));
    return () => {
      live = false;
    };
  }, [id]);
  return s;
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
        <a key={l.projectId} href={`${projectHref({ id: l.projectId, type: "screens" })}${l.first ? `?focus=${l.first}` : ""}`} onClick={saveThenGo} className="q-item flex h-[28px] items-center gap-[8px] rounded-md px-[6px] text-caption text-fg-muted hover:bg-hover hover:text-fg">
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

