import { useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import { ArrowUpRight, ChevronRight, EyeOff, MessageSquare, Pin, PinOff, RotateCcw } from "lucide-react";
import type { Group, KnowledgeEdge, KnowledgeGraph, KnowledgeNode } from "@/knowledge/types";
import { Button, Tag } from "../controls";
import { r } from "../recipes";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { DECISION_ICON, GROUP_ICON, IconChip, KIND_ICON } from "./icons";
import { DECISION_LABEL, GROUP_LABEL, KIND_LABEL, ORIGIN_LABEL, when } from "./labels";
import { controllable, forget, homeOf, openTurn, pin, restore, showOnCanvas, unpin } from "./actions";
import EditFact from "./EditFact";

/**
 * The hub's right column. With nothing selected: what Qalam AI knows, how it decides and what it
 * remembers, in plain words. A fact: its words, where it came from, and the decisions that used
 * it. A decision: what it relied on (with Qalam AI's reasons), what else it was given, and what
 * it made.
 */

const ico = { size: 12, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

export default function Inspector({ graph, selected, onSelect, onFilter, onStory }: { graph: KnowledgeGraph; selected: string | null; onSelect: (ref: string | null) => void; onFilter: (g: Group) => void; onStory?: (ref: string) => void }) {
  const node = selected ? graph.byRef.get(selected) : null;
  return (
    <aside id="knowledge-inspector" tabIndex={-1} aria-label="Details" className="flex w-[320px] shrink-0 flex-col overflow-y-auto border-l border-line-subtle bg-panel outline-none">
      {node ? node.kind === "decision" ? <DecisionView key={node.ref} n={node} graph={graph} onSelect={onSelect} onStory={onStory} /> : <FactView key={node.ref} n={node} graph={graph} onSelect={onSelect} /> : <Overview graph={graph} onFilter={onFilter} />}
    </aside>
  );
}

/** A node's kind icon in its group's colour (decisions: what kind of request made them). */
function NodeIcon({ n, size = 20 }: { n: KnowledgeNode; size?: number }) {
  const I = n.kind === "decision" && n.decision ? DECISION_ICON[n.decision.kind] : KIND_ICON[n.kind];
  return <IconChip group={n.group} icon={I} size={size} muted={n.status === "forgotten"} />;
}


function Section({ title, children, count }: { title: string; children: ReactNode; count?: number }) {
  return (
    <section className="flex flex-col gap-[6px] border-t border-line-subtle px-[16px] py-[12px] first:border-t-0">
      <h3 className={clsx(r.eyebrow, "tnum")}>
        {title}
        {count !== undefined && <span className="text-fg-faint"> · {count}</span>}
      </h3>
      {children}
    </section>
  );
}

/** A captioned row: label on the left, value on the right (Figma's property rows). */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[24px] items-baseline gap-[12px] text-caption">
      <span className="w-[72px] shrink-0 text-fg-subtle">{label}</span>
      <span className="min-w-0 flex-1 text-fg">{children}</span>
    </div>
  );
}

/** A linked node as a row: its dot, its name, and (for a relied-on fact) Qalam AI's reason. */
function NodeLink({ n, why, onSelect, faint }: { n: KnowledgeNode; why?: string; onSelect: (ref: string) => void; faint?: boolean }) {
  return (
    <button type="button" onClick={() => onSelect(n.ref)} className={clsx("q-item group flex w-full flex-col gap-[2px] rounded-md px-[8px] py-[6px] text-left hover:bg-hover", faint && "opacity-70")}>
      <span className="flex w-full items-center gap-[8px]">
        <NodeIcon n={n} size={20} />
        <span className="min-w-0 flex-1 truncate text-caption text-fg" dir="auto">
          {n.label}
        </span>
        {n.status === "forgotten" && <span className="text-micro text-fg-subtle">Forgotten</span>}
        <ChevronRight {...ico} className="shrink-0 text-fg-faint opacity-0 group-hover:opacity-100" />
      </span>
      {why && (
        <span className="pl-[28px] text-caption text-fg-muted" dir="auto">
          “{why}”
        </span>
      )}
    </button>
  );
}

function Header({ n }: { n: KnowledgeNode }) {
  return (
    <div className="flex flex-col gap-[8px] px-[16px] pt-[16px] pb-[12px]">
      <div className="flex items-center gap-[8px] text-micro font-medium text-fg-subtle">
        <NodeIcon n={n} size={20} />
        <span>{n.kind === "decision" ? DECISION_LABEL[n.decision!.kind] : GROUP_LABEL[n.group]}</span>
        <span className="text-fg-faint">·</span>
        <span>{n.kind === "decision" ? when(n.at) : KIND_LABEL[n.kind]}</span>
      </div>
      <h2 className="text-title font-semibold text-fg" dir="auto">
        {n.label}
      </h2>
    </div>
  );
}

function FactView({ n, graph, onSelect }: { n: KnowledgeNode; graph: KnowledgeGraph; onSelect: (ref: string) => void }) {
  const { usedBy, links } = useMemo(() => {
    const usedBy: { d: KnowledgeNode; e: KnowledgeEdge }[] = [];
    const links: KnowledgeNode[] = [];
    for (const e of graph.edges) {
      const other = e.from === n.ref ? e.to : e.to === n.ref ? e.from : null;
      if (!other) continue;
      const o = graph.byRef.get(other);
      if (!o) continue;
      if ((e.kind === "relied" || e.kind === "given") && o.kind === "decision") usedBy.push({ d: o, e });
      else if (!links.includes(o)) links.push(o);
    }
    usedBy.sort((a, b) => (a.e.kind === b.e.kind ? b.d.at - a.d.at : a.e.kind === "relied" ? -1 : 1));
    return { usedBy, links };
  }, [n, graph]);
  const home = homeOf(n);
  const can = controllable(n);
  const prov = n.provenance;
  const [editing, setEditing] = useState(false);
  const editable = EditFact.canEdit(n);

  return (
    <div className="q-rise flex flex-col">
      <Header n={n} />
      <div className="flex flex-col gap-[8px] px-[16px] pb-[12px]">
        {n.detail && n.kind === "answer" && (
          <p className="text-caption text-fg-subtle" dir="auto">
            {n.detail}
          </p>
        )}
        {editing ? (
          <EditFact
            n={n}
            onDone={(next) => {
              setEditing(false);
              if (next && next !== n.ref) requestAnimationFrame(() => onSelect(next));
            }}
          />
        ) : (
          n.text.trim() !== n.label.trim() && (
            <p className="text-body whitespace-pre-line text-fg" dir="auto">
              {n.text}
            </p>
          )
        )}
        {n.detail && n.kind !== "answer" && (
          <p className="text-caption whitespace-pre-line text-fg-muted" dir="auto">
            {n.detail}
          </p>
        )}
        <div className="flex flex-wrap gap-[4px]">
          {n.pinned && <Tag icon={<Pin {...ico} />}>Pinned: always sent</Tag>}
          {n.status === "forgotten" && <Tag icon={<EyeOff {...ico} />}>Forgotten: not sent</Tag>}
          {n.status === "capped" && <Tag tone="warning">Not sent: over the limit</Tag>}
          {n.status === "ghost" && <Tag>Removed since</Tag>}
        </div>
      </div>
      <Section title="Where it came from">
        <Row label="From">{ORIGIN_LABEL[n.origin]}</Row>
        <Row label="Added">{when(n.at)}</Row>
        {prov?.reason && (
          <Row label="Why">
            <span className="text-fg-muted" dir="auto">
              “{prov.reason}”
            </span>
          </Row>
        )}
        {n.readOnly && n.kind !== "tokens" && n.ref.startsWith("ds:builtin:") && <p className="text-caption text-fg-subtle">Built-in rules are read-only. Editing one makes a copy of the system for your projects.</p>}
      </Section>
      <Section title="Used by" count={usedBy.length}>
        {usedBy.length ? (
          <div className="-mx-[8px] flex flex-col">
            {usedBy.slice(0, 20).map(({ d, e }) => (
              <NodeLink key={d.ref} n={d} why={e.kind === "relied" ? e.why : undefined} faint={e.kind === "given"} onSelect={onSelect} />
            ))}
          </div>
        ) : (
          <p className="text-caption text-fg-subtle">
            {n.usage.relied || n.usage.given ? `Relied on ${n.usage.relied}× and given ${n.usage.given}× in decisions outside the timeline's window.` : "No recorded decision has used this yet."}
          </p>
        )}
        {(n.usage.relied > 0 || n.usage.given > 0) && (
          <p className="text-micro text-fg-subtle tnum">
            Relied on by {n.usage.relied} · given to {n.usage.given + n.usage.relied}
          </p>
        )}
      </Section>
      {links.length > 0 && (
        <Section title="Linked" count={links.length}>
          <div className="-mx-[8px] flex flex-col">
            {links.slice(0, 16).map((o) => (
              <NodeLink key={o.ref} n={o} onSelect={onSelect} />
            ))}
          </div>
        </Section>
      )}
      {(can.forget || can.pin || home || editable) && (
        <Section title="Actions">
          <div className="flex flex-wrap gap-[6px]">
            {editable && !editing && (
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                {n.ref.startsWith("ds:builtin:") ? "Edit a copy" : "Edit"}
              </Button>
            )}
            {can.pin && (n.pinned ? (
              <Button size="sm" variant="secondary" onClick={() => unpin(n.ref)}>
                <PinOff {...ico} /> Unpin
              </Button>
            ) : (
              n.status !== "forgotten" && (
                <Button size="sm" variant="secondary" onClick={() => pin(n.ref)}>
                  <Pin {...ico} /> Pin
                </Button>
              )
            ))}
            {can.forget && (n.status === "forgotten" ? (
              <Button size="sm" variant="secondary" onClick={() => restore(n.ref)}>
                <RotateCcw {...ico} /> Restore
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => forget(n.ref)}>
                <EyeOff {...ico} /> Forget
              </Button>
            ))}
            {home && (
              <Button size="sm" variant="ghost" onClick={home.go}>
                {home.label} <ArrowUpRight {...ico} />
              </Button>
            )}
          </div>
          {(can.forget || can.pin) && <p className="text-micro text-fg-subtle">Forget and pin apply to this project only.{n.ref.startsWith("ds:") ? " Editing a rule changes the system for every project that uses it." : ""}</p>}
        </Section>
      )}
    </div>
  );
}

function DecisionView({ n, graph, onSelect, onStory }: { n: KnowledgeNode; graph: KnowledgeGraph; onSelect: (ref: string) => void; onStory?: (ref: string) => void }) {
  const d = n.decision!;
  const [showGiven, setShowGiven] = useState(false);
  const { relied, given, produced, before, after, follows } = useMemo(() => {
    const relied: { n: KnowledgeNode; why?: string }[] = [];
    const given: KnowledgeNode[] = [];
    const produced: KnowledgeNode[] = [];
    let before: KnowledgeNode | null = null;
    let after: KnowledgeNode | null = null;
    let follows = false;
    for (const e of graph.edges) {
      if (e.to === n.ref && e.kind === "relied") relied.push({ n: graph.byRef.get(e.from)!, why: e.why });
      else if (e.to === n.ref && e.kind === "given") given.push(graph.byRef.get(e.from)!);
      else if (e.from === n.ref && (e.kind === "produced" || e.kind === "about")) produced.push(graph.byRef.get(e.to)!);
      else if (e.to === n.ref && (e.kind === "context" || e.kind === "parent")) {
        before = graph.byRef.get(e.from)!;
        follows = e.kind === "parent";
      } else if (e.from === n.ref && (e.kind === "context" || e.kind === "parent")) after = graph.byRef.get(e.to)!;
    }
    return { relied: relied.filter((x) => x.n), given: given.filter(Boolean), produced: [...new Set(produced.filter(Boolean))], before, after, follows };
  }, [n, graph]);
  const byGroup = useMemo(() => {
    const m = new Map<Group, KnowledgeNode[]>();
    for (const g of given) m.set(g.group, [...(m.get(g.group) ?? []), g]);
    return [...m.entries()];
  }, [given]);
  const frames = d.frames.filter((f) => graph.byRef.has(`screen:${f}`));

  return (
    <div className="q-rise flex flex-col">
      <Header n={n} />
      <div className="flex flex-col gap-[8px] px-[16px] pb-[12px]">
        {d.summary && (
          <p className="flex gap-[8px] text-body text-fg" dir="auto">
            <QalamAIGlyph size={14} />
            <span className="min-w-0 flex-1">{d.summary}</span>
          </p>
        )}
        {onStory && (
          <Button size="sm" variant="secondary" className="self-start" onClick={() => onStory(n.ref)}>
            Why this design?
          </Button>
        )}
        <div className="flex flex-wrap gap-[4px]">
          {d.status === "running" && <Tag tone="ai">Working</Tag>}
          {d.status === "stopped" && <Tag>Stopped</Tag>}
          {d.status === "partial" && <Tag>Stopped part way</Tag>}
          {d.status === "proposed" && <Tag tone="ai">Proposed</Tag>}
          {d.status === "applied" && <Tag tone="success">Applied</Tag>}
          {d.status === "undone" && <Tag>Undone</Tag>}
          {d.status === "error" && <Tag tone="danger">Failed</Tag>}
        </div>
      </div>
      {d.legacy ? (
        <Section title="How it decided">
          <p className="text-caption text-fg-muted">{d.untraced ? "This kind of request doesn't record what it relied on yet. You can see what it made." : "Made before Qalam AI recorded its reasons. You can see what it made, not what it relied on."}</p>
        </Section>
      ) : (
        <Section title="Relied on" count={d.reliedOn.length}>
          {relied.length ? (
            <div className="-mx-[8px] flex flex-col">
              {relied.map((x) => (
                <NodeLink key={x.n.ref} n={x.n} why={x.why} onSelect={onSelect} />
              ))}
            </div>
          ) : (
            <p className="text-caption text-fg-subtle">Qalam AI didn&apos;t name anything it relied on for this one.</p>
          )}
          <button type="button" onClick={() => setShowGiven((v) => !v)} className="q-item -mx-[8px] flex items-center gap-[6px] rounded-md px-[8px] py-[4px] text-left text-caption text-fg-muted hover:bg-hover hover:text-fg" aria-expanded={showGiven}>
            <ChevronRight {...ico} className={clsx("transition-[rotate] duration-fast", showGiven && "rotate-90")} />
            Also given, not relied on · {Math.max(0, d.givenCount - d.reliedOn.length)}
          </button>
          {showGiven && (
            <div className="flex flex-col gap-[8px]">
              {byGroup.map(([g, list]) => (
                <div key={g} className="flex flex-col">
                  <div className="flex items-center gap-[6px] px-[0px] py-[2px] text-micro text-fg-subtle">
                    {GROUP_LABEL[g]} · {list.length}
                  </div>
                  <div className="-mx-[8px] flex flex-col">
                    {list.slice(0, 12).map((x) => (
                      <NodeLink key={x.ref} n={x} faint onSelect={onSelect} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}
      {produced.length > 0 && (
        <Section title="Made or about" count={produced.length}>
          <div className="-mx-[8px] flex flex-col">
            {produced.slice(0, 16).map((o) => (
              <NodeLink key={o.ref} n={o} onSelect={onSelect} />
            ))}
          </div>
        </Section>
      )}
      {(before || after) && (
        <Section title={follows ? "Follows" : "In the same chat"}>
          <div className="-mx-[8px] flex flex-col">
            {before && <NodeLink n={before} onSelect={onSelect} />}
            {after && <NodeLink n={after} onSelect={onSelect} />}
          </div>
          <p className="text-micro text-fg-subtle">{follows ? "A fix starts from its critique's findings." : "Each request in a chat sees the turns before it."}</p>
        </Section>
      )}
      <Section title="Details">
        {d.model && <Row label="Model">{d.model}</Row>}
        <Row label="When">{new Date(n.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</Row>
        {!d.legacy && <Row label="Given">{d.givenCount} facts</Row>}
        <div className="flex flex-wrap gap-[6px] pt-[4px]">
          {frames.length > 0 && (
            <Button size="sm" variant="secondary" onClick={() => showOnCanvas(frames)}>
              Show on canvas
            </Button>
          )}
          {d.chatId && (
            <Button size="sm" variant="ghost" onClick={() => openTurn(d.chatId!, d.turnId)}>
              <MessageSquare {...ico} /> Open chat turn
            </Button>
          )}
        </div>
      </Section>
    </div>
  );
}

const ORDER: Group[] = ["you", "system", "learned", "research", "decision"];

function Overview({ graph, onFilter }: { graph: KnowledgeGraph; onFilter: (g: Group) => void }) {
  const counts = useMemo(() => {
    const c = new Map<Group, number>();
    for (const n of graph.nodes) c.set(n.group, (c.get(n.group) ?? 0) + 1);
    return c;
  }, [graph]);
  const traced = graph.nodes.some((n) => n.kind === "decision" && !n.decision?.legacy);
  const remembers = useMemo(() => {
    const answers = graph.nodes.filter((n) => n.kind === "answer").length;
    const learned = graph.nodes.filter((n) => n.group === "learned").length;
    const naming = graph.nodes.filter((n) => n.kind === "naming").length;
    const forgotten = graph.nodes.filter((n) => n.status === "forgotten").length;
    const pinned = graph.nodes.filter((n) => n.pinned).length;
    return { answers, learned, naming, forgotten, pinned };
  }, [graph]);

  return (
    <div className="flex flex-col">
      <div className="px-[16px] pt-[16px] pb-[12px]">
        <h2 className="text-title font-semibold text-fg">What Qalam AI knows</h2>
        <p className="mt-[4px] text-caption text-fg-muted">Everything it reads before it designs, critiques or tunes a system, and the decisions it made with it.</p>
      </div>
      <Section title="Knowledge">
        <div className="-mx-[8px] flex flex-col">
          {ORDER.map((g) => (
            <button key={g} type="button" onClick={() => onFilter(g)} className="q-item flex items-center gap-[8px] rounded-md px-[8px] py-[6px] text-left hover:bg-hover">
              <IconChip group={g} icon={GROUP_ICON[g]} size={24} />
              <span className="min-w-0 flex-1">
                <span className="block text-caption text-fg">{GROUP_LABEL[g]}</span>
                <span className="block truncate text-micro text-fg-subtle">{GROUP_HINT_SHORT[g]}</span>
              </span>
              <span className="text-caption text-fg-muted tnum">{counts.get(g) ?? 0}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="How it decides">
        <p className="text-caption text-fg-muted">Every request sends Qalam AI the facts that apply. It names the ones it relied on and why; Qalam keeps only names that were really sent, so nothing is made up.</p>
        <div className="flex flex-col gap-[4px] pt-[2px] text-caption text-fg-muted">
          <span className="flex items-center gap-[8px]">
            <svg width="28" height="8" aria-hidden>
              <line x1="0" y1="4" x2="28" y2="4" stroke="var(--color-ai)" strokeWidth="2" />
            </svg>
            Relied on
          </span>
          <span className="flex items-center gap-[8px]">
            <svg width="28" height="8" aria-hidden>
              <line x1="0" y1="4" x2="28" y2="4" stroke="var(--color-ai)" strokeWidth="1.25" strokeDasharray="3 4" />
            </svg>
            Given, not used
          </span>
        </div>
        {!traced && <p className="text-caption text-fg-subtle">Generate or critique a screen, then select its decision ◆ to see the facts behind it.</p>}
      </Section>
      <Section title="What it remembers">
        <Row label="Answers">{remembers.answers} of yours, kept in this project</Row>
        <Row label="Learned">
          {remembers.learned} {remembers.learned === 1 ? "fact" : "facts"} from critiques, Tune and naming
        </Row>
        <Row label="Chats">Each chat remembers its own earlier turns</Row>
        {(remembers.pinned > 0 || remembers.forgotten > 0) && (
          <Row label="You chose">
            {remembers.pinned} pinned · {remembers.forgotten} forgotten
          </Row>
        )}
      </Section>
    </div>
  );
}

const GROUP_HINT_SHORT: Record<Group, string> = {
  you: "Your answers, goals and interview",
  system: "The system's rules and guides",
  learned: "Concluded or taught: critiques, Tune, naming",
  research: "What it looked up, with sources",
  decision: "Screens made, verdicts, changes",
  anchor: "",
};
