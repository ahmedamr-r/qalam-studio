import { useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import { ChevronRight, CircleHelp, EyeOff, MessageSquare, RotateCcw, Waypoints } from "lucide-react";
import { useStudio } from "@/doc/store";
import { screenBriefFor } from "@/doc/brief";
import { useSystems } from "@/design-system/registry";
import { changesNote, changesSince, readRequest, type Change } from "@/knowledge/changes";
import { knowledgeGaps, type Gap } from "@/knowledge/gaps";
import { dsKeyOf } from "@/knowledge/refs";
import { useKnowledge } from "@/knowledge/store";
import type { Group, KnowledgeGraph, KnowledgeNode, ReliedOn } from "@/knowledge/types";
import { Button, Tag } from "../controls";
import { r } from "../recipes";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { nodeToDataURL } from "../exporter";
import { DECISION_ICON, IconChip, KIND_ICON } from "./icons";
import { DECISION_LABEL, GROUP_LABEL, KIND_LABEL } from "./labels";
import { controllable, critiqueAgain, forget, generateAgain, openTurn, restore, showOnCanvas, tellIt } from "./actions";
import EditFact from "./EditFact";

/**
 * "Why this design?": one decision told as a story a product manager can act on. What you asked,
 * the facts Qalam AI followed and how each shaped the design, what it knew but didn't use, what it
 * didn't know (and guessed), and, once the wrong facts are fixed, a way to make it again.
 */

const ico = { size: 12, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

export default function Story({ graph, decisionRef, onShowOnMap }: { graph: KnowledgeGraph; decisionRef: string; onShowOnMap: (ref: string) => void }) {
  const node = graph.byRef.get(decisionRef);
  const d = node?.decision;
  const doc = useStudio((s) => s.doc);
  const trace = useKnowledge((s) => (d?.traceId ? s.traces.find((t) => t.id === d.traceId) : undefined));
  const frameId = [...(d?.frames ?? []), ...(d?.about ?? [])].find((id) => doc.nodes[id]);
  const changes = useMemo(() => (trace ? changesSince(trace, graph, doc) : []), [trace, graph, doc]);
  // A revision's goals live on the screen it revised: ask about whichever has them.
  const gapScreen = [...(d?.frames ?? []), ...(d?.about ?? [])].find((id) => doc.nodes[id] && screenBriefFor(doc.brief, doc, id)) ?? frameId;
  const gaps = useMemo(() => (d && (d.kind === "generate" || d.kind === "section" || d.kind === "critique") ? knowledgeGaps(doc.brief, doc, gapScreen, d.assumed) : []), [d, doc, gapScreen]);
  if (!node || !d) return <p className="p-[24px] text-caption text-fg-subtle">Pick a design on the left to see why it looks the way it does.</p>;
  const relied = new Set(d.reliedOn.map((x) => x.ref));
  const alsoGiven = (trace?.given ?? []).map(([ref]) => ref).filter((ref) => !relied.has(ref) && !ref.startsWith("decision:"));
  const canRedo = (d.kind === "generate" || d.kind === "section") && !!frameId;
  const asked = readRequest(d.request ?? "");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <article key={decisionRef} className="q-rise mx-auto flex max-w-[720px] flex-col px-[24px] pt-[20px] pb-[24px]">
          <Header n={node} frameId={frameId} />
          <Block icon={<MessageSquare {...ico} />} title={d.kind === "critique" ? "You asked for a critique" : d.kind === "fix" ? "You asked it to fix the critique's findings" : asked.revise ? "You asked it to make this again with your fixes" : "You asked"}>
            {asked.revise ? (
              <>
                {asked.changes.length > 0 && (
                  <ul className="flex list-disc flex-col gap-[2px] pl-[18px] text-body text-fg marker:text-fg-faint">
                    {asked.changes.map((c, i) => (
                      <li key={i} dir="auto">
                        {c.charAt(0).toUpperCase() + c.slice(1)}
                      </li>
                    ))}
                  </ul>
                )}
                {asked.original && (
                  <p className="text-caption text-fg-subtle" dir="auto">
                    First asked: “{asked.original}”
                  </p>
                )}
              </>
            ) : d.request ? (
              <p className="text-body text-fg" dir="auto">
                “{d.request}”
              </p>
            ) : (
              <p className="text-caption text-fg-subtle">{d.kind === "critique" ? `Critique of ${frameId ? doc.nodes[frameId].name : "the screen"}` : "No request was recorded for this one."}</p>
            )}
            {d.summary && (
              <p className="mt-[8px] flex gap-[8px] text-body text-fg-muted" dir="auto">
                <QalamAIGlyph size={14} className="mt-[3px] shrink-0" />
                <span className="min-w-0 flex-1">{d.summary}</span>
              </p>
            )}
          </Block>

          {d.legacy ? (
            <Block title="What it followed">
              <p className="text-caption text-fg-muted">{d.untraced ? "This kind of request doesn't record what it followed yet." : "Made before Qalam AI recorded its reasons, so it can't say what it followed. Generate it again to get the story."}</p>
            </Block>
          ) : (
            <Block title={`Qalam AI followed these${d.reliedOn.length > 1 ? ", most important first" : ""}`} count={d.reliedOn.length}>
              {d.reliedOn.length ? (
                <ol className="flex flex-col">
                  {d.reliedOn.map((x) => (
                    <Followed key={x.ref} x={x} n={graph.byRef.get(x.ref)} change={changes.find((c) => c.ref === x.ref || (c.kind === "edited" && c.before === x.text))} onShowOnMap={onShowOnMap} />
                  ))}
                </ol>
              ) : (
                <p className="text-caption text-fg-subtle">It didn&apos;t name anything it followed for this one.</p>
              )}
            </Block>
          )}

          {alsoGiven.length > 0 && <AlsoKnew refs={alsoGiven} graph={graph} onShowOnMap={onShowOnMap} />}

          {gaps.length > 0 && <DidntKnow gaps={gaps} />}
        </article>
      </div>
      {(canRedo || (d.kind === "critique" && frameId)) && (
        <footer className="flex shrink-0 items-center gap-[12px] border-t border-line-subtle bg-panel px-[24px] py-[12px]">
          <div className="min-w-0 flex-1 text-caption text-fg-muted">
            {changes.length ? (
              <span className="flex flex-wrap items-center gap-x-[10px] gap-y-[2px]">
                <span className="text-fg">Since then you</span>
                {count(changes, "forgot", "forgot")}
                {count(changes, "edited", "edited")}
                {count(changes, "told", "told it")}
                {count(changes, "removed", "removed")}
              </span>
            ) : (
              "Fix what it followed or tell it what it didn't know, then make it again."
            )}
          </div>
          {canRedo ? (
            <Button size="sm" variant={changes.length ? "primary" : "secondary"} onClick={() => void generateAgain(d, frameId!, changesNote(changes))}>
              <QalamAIGlyph size={12} tone="current" /> {changes.length ? "Generate again with your fixes" : "Generate again"}
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => critiqueAgain(frameId!)}>
              Critique again
            </Button>
          )}
        </footer>
      )}
    </div>
  );
}

const count = (changes: { kind: string }[], kind: string, verb: string) => {
  const n = changes.filter((c) => c.kind === kind).length;
  return n ? (
    <span className="tnum">
      {verb} {n} {n === 1 ? "fact" : "facts"}
    </span>
  ) : null;
};

function Header({ n, frameId }: { n: KnowledgeNode; frameId: string | undefined }) {
  const d = n.decision!;
  const frame = useStudio((s) => (frameId ? s.doc.nodes[frameId] : undefined));
  const thumb = useMemo(() => {
    if (!frameId || !frame) return null;
    try {
      return nodeToDataURL(frameId, Math.min(0.5, 112 / Math.max(frame.w, frame.h, 1)));
    } catch {
      return null;
    }
  }, [frameId, frame]);
  const I = DECISION_ICON[d.kind];
  return (
    <header className="flex items-start gap-[16px] pb-[16px]">
      <div className="grid h-[112px] w-[64px] shrink-0 place-items-center overflow-hidden rounded-md bg-muted shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
        {thumb ? <img src={thumb} alt="" className="max-h-full max-w-full object-contain" /> : <IconChip group="decision" icon={I} size={28} />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-[4px] pt-[2px]">
        <span className={r.eyebrow}>Why this design?</span>
        <h2 className="text-title font-semibold text-fg" dir="auto">
          {frame?.name ?? n.label}
        </h2>
        <span className="text-caption text-fg-subtle tnum">
          {DECISION_LABEL[d.kind]} · {new Date(n.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          {d.model ? ` · ${d.model}` : ""}
        </span>
        <div className="mt-[6px] flex flex-wrap gap-[6px]">
          {frameId && (
            <Button size="sm" variant="secondary" onClick={() => showOnCanvas([frameId])}>
              Show on canvas
            </Button>
          )}
          {d.chatId && (
            <Button size="sm" variant="ghost" onClick={() => openTurn(d.chatId!, d.turnId)}>
              <MessageSquare {...ico} /> Open the chat
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

function Block({ title, icon, count: n, children }: { title: string; icon?: ReactNode; count?: number; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-[8px] border-t border-line-subtle py-[16px]">
      <h3 className={clsx(r.eyebrow, "flex items-center gap-[6px] tnum")}>
        {icon}
        {title}
        {n !== undefined && <span className="text-fg-faint">· {n}</span>}
      </h3>
      {children}
    </section>
  );
}

/** Where a fact came from, in the designer's words ("Your screen goal", "Design system rule · Qalam"). */
function sourceOf(n: KnowledgeNode | undefined, systemName: (id: string) => string): string {
  if (!n) return "A fact it read";
  if (n.kind === "answer") return n.pinned ? "Your answer · pinned" : n.origin === "interview" ? "Your interview" : "Your answer";
  if (n.kind === "screen-goal") return "Your screen goal";
  if (n.kind === "summary") return "What the project solves";
  if (n.kind === "decision") return "An earlier step in this chat";
  const ds = dsKeyOf(n.ref);
  if (ds) return `${n.group === "learned" ? "Learned rule" : n.group === "you" ? "Your edit" : KIND_LABEL[n.kind]} · ${systemName(ds.systemId)}`;
  return KIND_LABEL[n.kind];
}

function Followed({ x, n, change, onShowOnMap }: { x: ReliedOn; n: KnowledgeNode | undefined; change?: Change; onShowOnMap: (ref: string) => void }) {
  const changed = change?.kind;
  const systems = useSystems((s) => s.systems);
  const [editing, setEditing] = useState(false);
  const can = n ? controllable(n) : { forget: false, pin: false };
  const group: Group = n?.group ?? "system";
  const I = n ? (n.kind === "decision" && n.decision ? DECISION_ICON[n.decision.kind] : KIND_ICON[n.kind]) : KIND_ICON.rule;
  const systemName = (id: string) => systems.find((s) => s.id === id)?.name ?? "the system";
  const forgotten = n?.status === "forgotten";
  return (
    <li className="group flex gap-[12px] border-t border-line-subtle py-[12px] first:border-t-0 first:pt-[4px]">
      <IconChip group={group} icon={I} size={28} muted={forgotten} />
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <div className="flex items-center gap-[6px] text-micro text-fg-subtle">
          <span className="truncate">{sourceOf(n, systemName)}</span>
          {changed === "forgot" || forgotten ? <Tag icon={<EyeOff {...ico} />}>Forgotten</Tag> : null}
          {changed === "edited" && <Tag>Edited since</Tag>}
          {changed === "removed" && <Tag>Removed since</Tag>}
        </div>
        {editing && n ? (
          <EditFact n={n} onDone={() => setEditing(false)} />
        ) : (
          <p className={clsx("text-body text-fg", forgotten && "text-fg-subtle line-through decoration-fg-faint")} dir="auto">
            {x.text}
          </p>
        )}
        {changed === "edited" && change!.text !== x.text && (
          <p className="text-caption text-fg-subtle" dir="auto">
            Now: {change!.text}
          </p>
        )}
        {x.why && (
          <p className="text-body text-fg-muted" dir="auto">
            <span className="text-fg-faint">→ </span>
            {x.why}
          </p>
        )}
        {n && (
          <div className="mt-[2px] flex flex-wrap items-center gap-x-[12px] text-caption text-fg-subtle">
            {EditFact.canEdit(n) && !editing && !forgotten && (
              <button type="button" className="hover:text-fg hover:underline" onClick={() => setEditing(true)}>
                {n.ref.startsWith("ds:builtin:") ? "Edit a copy" : "Edit"}
              </button>
            )}
            {can.forget &&
              (forgotten ? (
                <button type="button" className="inline-flex items-center gap-[4px] hover:text-fg hover:underline" onClick={() => restore(n.ref)}>
                  <RotateCcw {...ico} /> Restore
                </button>
              ) : (
                <button type="button" className="hover:text-fg hover:underline" onClick={() => forget(n.ref)} title="Stop sending this to Qalam AI in this project">
                  Forget
                </button>
              ))}
            <button type="button" className="inline-flex items-center gap-[4px] hover:text-fg hover:underline" onClick={() => onShowOnMap(n.ref)}>
              <Waypoints {...ico} /> On the map
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

function AlsoKnew({ refs, graph, onShowOnMap }: { refs: string[]; graph: KnowledgeGraph; onShowOnMap: (ref: string) => void }) {
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => {
    const m = new Map<Group, KnowledgeNode[]>();
    for (const ref of refs) {
      const n = graph.byRef.get(ref);
      if (n) m.set(n.group, [...(m.get(n.group) ?? []), n]);
    }
    return [...m.entries()];
  }, [refs, graph]);
  return (
    <section className="border-t border-line-subtle py-[12px]">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={clsx(r.eyebrow, "q-item -mx-[6px] flex items-center gap-[6px] rounded-sm px-[6px] py-[4px] hover:text-fg")}>
        <ChevronRight {...ico} className={clsx("transition-[rotate] duration-fast", open && "rotate-90")} />
        It also knew, but didn&apos;t use · {refs.length}
      </button>
      {open && (
        <div className="mt-[8px] flex flex-col gap-[12px]">
          {groups.map(([g, list]) => (
            <div key={g} className="flex flex-col">
              <span className="pb-[4px] text-micro text-fg-subtle">
                {GROUP_LABEL[g]} · {list.length}
              </span>
              {list.map((n) => (
                <button key={n.ref} type="button" onClick={() => onShowOnMap(n.ref)} className="q-item -mx-[6px] flex items-center gap-[8px] rounded-sm px-[6px] py-[4px] text-left hover:bg-hover">
                  <IconChip group={n.group} icon={KIND_ICON[n.kind]} size={20} muted={n.status === "forgotten"} />
                  <span className={clsx("min-w-0 flex-1 truncate text-caption", n.status === "forgotten" ? "text-fg-subtle line-through" : "text-fg-muted")} dir="auto">
                    {n.label}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DidntKnow({ gaps }: { gaps: Gap[] }) {
  return (
    <section className="mt-[4px] flex flex-col gap-[4px] rounded-lg bg-warning-subtle px-[14px] py-[12px]">
      <h3 className="flex items-center gap-[6px] text-micro font-medium text-warning">
        <CircleHelp {...ico} /> It didn&apos;t know
      </h3>
      <p className="pb-[4px] text-caption text-fg-muted">Nobody told Qalam AI these. Answer them and the next design will know.</p>
      {gaps.map((g) => (
        <GapRow key={`${g.topic}:${g.field ?? ""}`} g={g} />
      ))}
    </section>
  );
}

function GapRow({ g }: { g: Gap }) {
  const [v, setV] = useState("");
  const [saved, setSaved] = useState(false);
  const save = (text: string) => {
    if (!text.trim()) return;
    tellIt(g, text);
    setSaved(true);
  };
  return (
    <div className="flex flex-col gap-[6px] border-t border-[color-mix(in_oklab,var(--color-warning)_18%,transparent)] py-[10px] first-of-type:border-t-0">
      <span className="text-body font-medium text-fg">{g.question}</span>
      {g.guess && (
        <span className="text-caption text-fg-muted" dir="auto">
          It guessed: “{g.guess}”
        </span>
      )}
      {saved ? (
        <span className="text-caption text-fg-muted">Saved to the brief. The next design will know.</span>
      ) : (
        <div className="flex items-center gap-[6px]">
          <input
            value={v}
            dir="auto"
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save(v)}
            placeholder="Tell it…"
            aria-label={g.question}
            className="ds-input min-w-0 flex-1"
          />
          <Button size="sm" variant="secondary" onClick={() => save(v)}>
            Save
          </Button>
          {g.guess && (
            <Button size="sm" variant="ghost" onClick={() => save(g.guess!)}>
              That&apos;s right
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
