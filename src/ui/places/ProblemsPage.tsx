import { useState } from "react";
import clsx from "clsx";
import { nanoid } from "nanoid";
import { useGoals } from "@/goals/client";
import type { Topic } from "@/hub/topics";
import { useOrgContext } from "@/org/context";
import { topicsDb } from "@/org/topics";
import { topicHref } from "@/projects/model";
import { Button, Select } from "../controls";
import { r } from "../recipes";
import { promptDialog } from "../surfaces/dialog";
import { PageFrame } from "../frame/PageFrame";
import { inScope } from "../home/scope";
import { useNeeds } from "../home/useNeeds";
import { useScope } from "../home/useScope";
import { ProblemsList } from "../goals/ProblemsList";
import { useBearings } from "../goals/useBearings";
import { FilingBanner } from "../org/TopicsList";
import { useOrgData } from "../org/useOrgData";
import { PlaceHead } from "./PlaceHead";

/**
 * The problems customers have (one page each, hub/topics), for the product in view, the best-backed
 * first, each with the goals it bears on: all of them, one goal's, or the ones no goal covers yet.
 * What customers said that the pages haven't taken in waits on top.
 */
export default function ProblemsPage() {
  const [scope, setScope] = useScope();
  const [goal, setGoal] = useState<string>("all");
  const { projects, sources, refresh } = useOrgData();
  const needs = useNeeds();
  const links = useBearings() ?? [];
  const tree = useGoals();
  const products = useOrgContext((s) => s.products);
  const product = scope !== "all" && scope !== "org" ? products.find((p) => p.id === scope) : undefined;
  const scoped = (needs?.needs ?? []).filter((n) => (scope === "all" ? true : scope === "org" ? !n.products.length : n.products.includes(scope)));
  const shown = scoped.filter((n) => {
    if (goal === "all") return true;
    const of = links.filter((l) => l.need === n.topic);
    return goal === "none" ? !of.length : of.some((l) => l.goal === goal);
  });

  const newProblem = async () => {
    const title = await promptDialog({
      title: "New problem",
      body: "In the customer's words: what they need, struggle with or wish for.",
      label: "The problem",
      placeholder: "I can't plan my day around the delivery window",
      confirmLabel: "Add page",
      validate: (v) => (v.trim() ? null : "Name it"),
    });
    if (!title) return;
    const now = Date.now();
    const t: Topic = { id: nanoid(10), kind: "need", title: title.trim().replace(/\s+/g, " ").slice(0, 100), products: product ? [product.id] : [], createdAt: now, updatedAt: now, lines: [], history: [] };
    await topicsDb.put(t, null);
    window.location.assign(topicHref(t.id));
  };

  return (
    <PageFrame place="problems" crumbs={[{ label: "Problems" }]} scope={scope} onScope={setScope}>
      <div className={clsx(r.pageMain, "max-w-[1080px]")}>
        <PlaceHead title="Problems" count={needs ? scoped.length : null} scope={scope}>
          <span className="flex items-center gap-[8px]">
            {!!tree.goals.length && (
              <Select
                ariaLabel="Bears on"
                value={goal}
                onChange={setGoal}
                options={[{ value: "all", label: "Every goal" }, ...tree.goals.map((g) => ({ value: g.id, label: g.id === tree.north ? `North Star: ${g.title}` : g.title })), { value: "none", label: "No goal yet" }]}
                className="w-[240px]"
              />
            )}
            <Button size="sm" variant="secondary" onClick={() => void newProblem()}>
              New problem
            </Button>
          </span>
        </PlaceHead>
        <FilingBanner sources={sources.filter((s) => inScope(s.product, scope))} onFiled={refresh} />
        {!needs ? (
          <div className="flex flex-col gap-[6px]" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className={clsx(r.skeleton, "h-[40px] rounded-lg")} />
            ))}
          </div>
        ) : !needs.indexed ? (
          <p className="text-caption text-fg-subtle">Ranking problems takes this computer&apos;s search, which isn&apos;t running. Connections says why.</p>
        ) : shown.length ? (
          <ProblemsList needs={shown} links={links} goals={tree.goals} projects={projects ?? []} />
        ) : (
          <p className="text-body text-fg-muted">{scoped.length ? "None here." : "No problems yet. They show here once Qalam AI reads what customers said: add material in Evidence, or bring it in from Connections."}</p>
        )}
      </div>
    </PageFrame>
  );
}
