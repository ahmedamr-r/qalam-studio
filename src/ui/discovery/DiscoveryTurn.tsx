import { projectHref } from "@/projects/model";
import { TriangleAlert } from "lucide-react";
import { studio, useStudio } from "@/doc/store";
import { runCommand } from "@/commands/registry";
import type { ChatTurn, DiscoveryOutcome } from "../ai/chatTypes";
import { getController } from "../CanvasView";
import { r } from "../recipes";
import { EvidenceList, Lineage, RiskiestAssumptions } from "./Lineage";
import { saveThenGo } from "./links";
import { useSources } from "./sources";
import { openBrainDump } from "./dump";
import type { DumpSession } from "@/discovery/dump";

const ICON = { size: 12, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const linkBtn = `${r.link} self-start text-caption font-medium`;

/** A Discovery turn in the chat: the drafted tree, or (in a Screens project) the solution being designed. */
export default function DiscoveryTurnView({ t, o }: { t: ChatTurn; o: DiscoveryOutcome }) {
  if (o.action === "handoff" && o.handoff) return <HandoffView o={o} />;
  if (o.action === "dump") return <DumpView t={t} o={o} />;
  return <DraftView t={t} o={o} />;
}

const PHASE: Record<DumpSession["phase"], string> = {
  reading: "Qalam AI is reading it",
  asking: "Qalam AI has questions for you",
  analyzing: "Qalam AI is reading your answers",
  ready: "Ready to place on the board",
  placing: "Qalam AI is placing it",
  review: "Its changes wait on the board for you",
  placed: "Placed",
  failed: "Didn't finish",
};

/** A brain dump in the chat: what Qalam AI took from it and where it stands; the card holds the conversation. */
function DumpView({ t, o }: { t: ChatTurn; o: DiscoveryOutcome }) {
  const source = useSources((s) => s.list.find((x) => x.id === o.sourceId));
  const s = source?.dump;
  if (!source || !s) return <p className="text-caption text-fg-subtle">The brain dump was removed from the board&apos;s sources.</p>;
  const rounds = s.buckets.filter((b) => b.form.submitted).length;
  const c = s.placed?.counts;
  return (
    <div className="flex flex-col gap-[8px]">
      {s.understanding && <p className="text-body leading-[20px] text-fg-muted">{s.understanding}</p>}
      <p className="text-caption text-fg-muted tnum">
        {[PHASE[s.phase], s.challenges.length ? `${s.challenges.length} pushback` : "", rounds ? `${rounds} ${rounds === 1 ? "round" : "rounds"} answered` : "", c ? `${c.added} added · ${c.attached} attached · ${c.edited} changed` : ""].filter(Boolean).join(" · ")}
      </p>
      <button type="button" className={linkBtn} onClick={() => openBrainDump({ sourceId: source.id })}>
        Open the brain dump
      </button>
      {t.sample && <span className="text-micro text-fg-subtle">Recorded sample · Basket, a fictional grocery app</span>}
    </div>
  );
}

function DraftView({ t, o }: { t: ChatTurn; o: DiscoveryOutcome }) {
  const onBoard = useStudio((s) => !!o.rootId && !!s.doc.nodes[o.rootId]);
  const c = o.counts;
  return (
    <div className="flex flex-col gap-[8px]">
      {o.summary && <p className="text-body leading-[20px] text-fg-muted">{o.summary}</p>}
      {c && (
        <p className="text-caption text-fg-muted tnum">
          {o.partial ? "Kept what was drafted before you stopped: " : "On the board: "}1 outcome, {c.opportunities} {c.opportunities === 1 ? "opportunity" : "opportunities"}, {c.solutions} {c.solutions === 1 ? "solution" : "solutions"}.
        </p>
      )}
      {c && c.assumed > 0 && (
        <div className="flex items-start gap-[8px] rounded-lg bg-warning-subtle px-[10px] py-[8px] text-caption text-fg [&>svg]:mt-[2px] [&>svg]:shrink-0 [&>svg]:text-warning">
          <TriangleAlert {...ICON} />
          <span>
            {c.assumed} {c.assumed === 1 ? "opportunity is" : "opportunities are"} Assumed: nothing you said backs {c.assumed === 1 ? "it" : "them"} yet. Talk to customers, then add what they say as evidence.{" "}
            <button type="button" className={linkBtn} onClick={() => runCommand("discovery.select-assumed", "toolbar")}>
              Select {c.assumed === 1 ? "it" : "them"}
            </button>
          </span>
        </div>
      )}
      {onBoard && (
        <button
          type="button"
          className={linkBtn}
          onClick={() => {
            studio().select([o.rootId!]);
            getController()?.glideToFit();
          }}
        >
          Show the tree
        </button>
      )}
      {t.sample && <span className="text-micro text-fg-subtle">Recorded sample · Basket, a fictional grocery app</span>}
    </div>
  );
}

function HandoffView({ o }: { o: DiscoveryOutcome }) {
  const h = o.handoff!;
  return (
    <div className="flex flex-col gap-[10px] rounded-lg p-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <Lineage h={h} lead="Designing" />
      <EvidenceList evidence={h.evidence} />
      <RiskiestAssumptions assumptions={h.assumptions} />
      <a href={`${projectHref({ id: h.from.projectId, type: "discovery" })}?card=${h.from.cardId}`} onClick={saveThenGo} className={linkBtn}>
        Open {h.from.projectName} in Discovery
      </a>
    </div>
  );
}
