import { useMemo } from "react";
import { useGoals } from "@/goals/client";
import { useOrgContext } from "@/org/context";
import { wordsFor } from "@/org/words";
import { useKnow } from "../setup/know";
import { useSetup, useSetupQuotes } from "../setup/setup";
import { canvasOf, type Canvas } from "./canvas";
import { useFirstRun } from "./flow";
import { placesOf, type Place } from "./places";

/*
 * What the setup's canvas draws, from what's kept: the door's own material (the setup's reading,
 * the know door's goals, the problems door's sources), around the organization as it is (its places,
 * the goals in goals.md, the tools connected). Before there's an organization, only its name, faint.
 */

export function useSetupCanvas(): { canvas: Canvas; empty: string | null; name: string; places: Place[] } {
  const fr = useFirstRun();
  const source = useSetup((s) => s.source);
  const quotes = useSetupQuotes();
  const pending = useSetup((s) => s.pending);
  const busy = useSetup((s) => !!s.busy);
  const know = useKnow();
  const goals = useGoals();
  const { about, products } = useOrgContext();
  const name = fr.org?.name ?? fr.naming.name ?? `Your ${wordsFor(fr.shape).org}`;
  return useMemo(() => {
    const knowGoals = fr.door === "know" && (know.phase === "asking" || know.phase === "review") ? know.goals : [];
    const named = knowGoals.flatMap((g) => (g.product && "name" in g.product ? [g.product.name] : []));
    const door =
      fr.door === "problems"
        ? { problems: fr.problems.sources ?? [] }
        : fr.door === "know"
          ? { know: knowGoals }
          : pending
            ? { pending: { docs: [...(pending.text ? [{ from: "said", title: "Your words" }] : []), ...(pending.url ? [{ from: "page", title: pending.url }] : []), ...(pending.docs ?? [])] } }
            : source?.setup
              ? { setup: { session: source.setup, sourceId: source.id, quotes, text: source.text } }
              : {};
    const org = fr.org;
    const places = org ? placesOf({ org: org.name, session: source?.setup ?? null, products, about, quotes, named }) : [];
    const canvas = canvasOf({
      ...door,
      busy,
      org: { name, ghost: !org },
      ...(org
        ? {
            places,
            tree: goals,
            tools: (fr.tools ?? []).filter((t) => t.tone === "ok").map((t) => ({ id: t.id, label: t.label })),
          }
        : {}),
    });
    // Nothing on it but the organization itself: a word on what will be.
    const quiet = canvas.nodes.every((n) => n.kind === "place" || n.kind === "tool") && canvas.nodes.filter((n) => n.kind === "place").every((n) => !n.quotes.length);
    return { canvas, empty: quiet ? `What ${name} is becoming shows here, wired from what you send.` : null, name, places };
  }, [fr.door, fr.problems.sources, fr.org, fr.tools, name, know.phase, know.goals, pending, source, quotes, busy, goals, about, products]);
}
