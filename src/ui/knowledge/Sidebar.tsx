import { useMemo } from "react";
import type { Group, KnowledgeGraph, KnowledgeNode } from "@/knowledge/types";
import { SideHeading, SideItem } from "../workspace/Workspace";
import { DECISION_ICON, GROUP_ICON, IconChip, KIND_ICON } from "./icons";
import { GROUP_LABEL, KIND_LABEL } from "./labels";

/**
 * The hub's left column: the groups (picking one dims the rest, so nothing moves), what the
 * designer pinned or forgot, and facts over a prompt's limit. With a search, the matches instead:
 * a way through the graph without the pointer.
 */

export type Filter = { kind: "all" } | { kind: "group"; group: Group } | { kind: "status"; status: "pinned" | "forgotten" | "capped" };

const GROUPS: Group[] = ["you", "system", "learned", "research", "decision", "anchor"];

/** The refs a filter keeps bright (null: everything). */
export function filterRefs(graph: KnowledgeGraph, f: Filter): Set<string> | null {
  if (f.kind === "all") return null;
  const keep = (n: KnowledgeNode) => (f.kind === "group" ? n.group === f.group : f.status === "pinned" ? !!n.pinned : n.status === f.status);
  return new Set(graph.nodes.filter(keep).map((n) => n.ref));
}

/** Search over labels and words; labels first. */
export function searchNodes(graph: KnowledgeGraph, q: string): KnowledgeNode[] {
  const n = q.trim().toLowerCase();
  if (!n) return [];
  const inLabel = graph.nodes.filter((x) => x.label.toLowerCase().includes(n));
  const inText = graph.nodes.filter((x) => !inLabel.includes(x) && (x.text.toLowerCase().includes(n) || (x.detail ?? "").toLowerCase().includes(n)));
  return [...inLabel, ...inText].slice(0, 40);
}

function Swatch({ group }: { group: Group }) {
  return <IconChip group={group} icon={GROUP_ICON[group]} size={20} className="ml-[2px]" />;
}

/** A node's kind icon (search results). */
function KindSwatch({ n }: { n: KnowledgeNode }) {
  return <IconChip group={n.group} icon={n.kind === "decision" && n.decision ? DECISION_ICON[n.decision.kind] : KIND_ICON[n.kind]} size={20} className="ml-[2px]" />;
}

export default function Sidebar({ graph, filter, setFilter, query, onPick, selected }: { graph: KnowledgeGraph; filter: Filter; setFilter: (f: Filter) => void; query: string; onPick: (ref: string) => void; selected: string | null }) {
  const counts = useMemo(() => {
    const c = { all: graph.nodes.length, pinned: 0, forgotten: 0, capped: 0, group: new Map<Group, number>() };
    for (const n of graph.nodes) {
      c.group.set(n.group, (c.group.get(n.group) ?? 0) + 1);
      if (n.pinned) c.pinned++;
      if (n.status === "forgotten") c.forgotten++;
      if (n.status === "capped") c.capped++;
    }
    return c;
  }, [graph]);
  const results = useMemo(() => searchNodes(graph, query), [graph, query]);
  const is = (f: Filter) => JSON.stringify(f) === JSON.stringify(filter);

  return (
    <nav aria-label="Knowledge groups" className="flex w-[232px] shrink-0 flex-col overflow-y-auto border-r border-line-subtle bg-app pt-[4px] pb-[16px]">
      {query.trim() ? (
        <>
          <SideHeading>
            {results.length ? `${results.length}${results.length === 40 ? "+" : ""} matches` : "No matches"}
          </SideHeading>
          {results.map((n) => (
            <SideItem key={n.ref} selected={selected === n.ref} onClick={() => onPick(n.ref)} lead={<KindSwatch n={n} />} title={`${KIND_LABEL[n.kind]}: ${n.text}`}>
              {n.label}
            </SideItem>
          ))}
        </>
      ) : (
        <>
          <SideHeading>Knowledge</SideHeading>
          <SideItem selected={is({ kind: "all" })} count={counts.all} onClick={() => setFilter({ kind: "all" })}>
            Everything
          </SideItem>
          {GROUPS.map((g) => (
            <SideItem key={g} selected={is({ kind: "group", group: g })} count={counts.group.get(g) ?? 0} onClick={() => setFilter(is({ kind: "group", group: g }) ? { kind: "all" } : { kind: "group", group: g })} lead={<Swatch group={g} />}>
              {g === "anchor" ? "Screens & anchors" : GROUP_LABEL[g]}
            </SideItem>
          ))}
          <div className="mt-[8px]" />
          <SideHeading>Your choices</SideHeading>
          <SideItem selected={is({ kind: "status", status: "pinned" })} count={counts.pinned} onClick={() => setFilter({ kind: "status", status: "pinned" })} title="Always sent, ahead of any limit">
            Pinned
          </SideItem>
          <SideItem selected={is({ kind: "status", status: "forgotten" })} count={counts.forgotten} onClick={() => setFilter({ kind: "status", status: "forgotten" })} title="Not sent to Qalam AI">
            Forgotten
          </SideItem>
          <SideItem selected={is({ kind: "status", status: "capped" })} count={counts.capped} onClick={() => setFilter({ kind: "status", status: "capped" })} title="Past a prompt's limit, so not sent">
            Not sent: over the limit
          </SideItem>
        </>
      )}
    </nav>
  );
}
