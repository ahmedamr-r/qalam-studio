import { compilePrototype } from "@/codegen/compile";
import type { Inst } from "@/design-system/builders";
import { instOf } from "@/design-system/instances";
import { dsIdForNode, tokenSetFor } from "@/design-system/registry";
import type { Doc, RouteProto } from "@/doc/schema";
import { moneyFormat } from "./agent/parts";
import { editRoutes, withRoute } from "./edit";
import { findMoney, formatMoney } from "./money";
import { actionWords, resolveRef } from "./routes";
import { scanFrame } from "./scan";
import { walkthrough, type Machine } from "./walk";
import { evaluate, transpile } from "@/ui/prototype/runtime";

/*
 * Pages a screen goes on to before they're designed (the basket, checkout): what Generate is told
 * to draw one from — the screen it's from, the action's words, what the page shows, and what the
 * prototype carries to it (the basket's lines) — and wiring the screen to it once it's drawn.
 */

/** The words of what leads to a page ("View basket"), off the layer its rule is tapped on. */
function leadsWith(doc: Doc, screen: string, route: RouteProto, page: string): string {
  const ru = route.rules.find((r) => r.then.some((a) => a.do === "next" && a.page === page));
  const id = ru && "ref" in ru.when ? resolveRef(doc, screen, ru.when.ref) : null;
  const props = ((id ? instOf(doc, id) : undefined) as Inst | undefined)?.props ?? {};
  const label = [props.label, props.title].find((x): x is string => typeof x === "string" && !!x.trim());
  return label ? actionWords(label) : "";
}

/** What the prototype carries to the page: the app's lists as they are after the screen's steps ("2 × Chicken shawarma · AED 28.00"). */
export function carried(doc: Doc, screen: string): string[] {
  const vars = doc.proto?.vars ?? {};
  if (!Object.values(vars).some((v) => v.type.t === "list")) return [];
  try {
    const ts = tokenSetFor(dsIdForNode(doc, screen));
    const r = compilePrototype(doc, { screens: [screen], typography: (p) => ts.typography(p) });
    const key = r.screens.find((s) => s.id === screen)?.key;
    if (!key) return [];
    const app = walkthrough(evaluate(transpile(r.code)) as unknown as Machine, doc, screen, key, { max: 2000 }).end.state.app;
    const money = moneyFormat(doc, screen, scanFrame(doc, screen)) ?? findMoney("AED 0.00")!.format;
    const picked = pickedOptions(doc, screen);
    const out: string[] = [];
    for (const [name, def] of Object.entries(vars)) {
      const rows = app[name];
      if (def.type.t !== "list" || !Array.isArray(rows) || !rows.length) continue;
      const lines = rows.slice(0, 6).map((x: Record<string, unknown>) => {
        const qty = typeof x.qty === "number" ? x.qty : 1;
        const each = typeof x.unit === "number" ? x.unit : null;
        return `${qty} × ${String(x.title ?? x.item ?? "item")}${picked.length ? ` (${picked.join(", ")})` : ""}${each !== null ? ` · ${formatMoney(each * qty, money)}` : ""}`;
      });
      out.push(`${def.label}: ${lines.join("; ")}`);
    }
    return out;
  } catch {
    return [];
  }
}

/** The options the walkthrough picks in a part as it adds something (a size, an extra): the rows it taps there, by title. */
function pickedOptions(doc: Doc, screen: string): string[] {
  const route = doc.proto?.routes?.[screen];
  const out: string[] = [];
  for (const st of route?.steps ?? []) {
    if (st.recipe !== "configureAndAdd") continue;
    for (const a of st.play) {
      if (a.do !== "tap" || !a.ref.part || !a.ref.path || a.ref.sub) continue;
      const id = resolveRef(doc, screen, a.ref);
      const props = ((id ? instOf(doc, id) : undefined) as Inst | undefined)?.props ?? {};
      if (id && doc.nodes[id]?.meta.component?.startsWith("ListItem") && typeof props.title === "string") out.push(props.title);
    }
  }
  return out.slice(0, 4);
}

/** Generate's brief for a page (within its 800 characters). */
export function nextBrief(doc: Doc, screen: string, page: string): string {
  const route = doc.proto?.routes?.[screen];
  const np = route?.next?.[page];
  if (!route || !np) return "";
  const from = doc.nodes[screen]?.name ?? "the screen before";
  const words = leadsWith(doc, screen, route, page);
  const lines = carried(doc, screen);
  return [
    `Design the "${np.name}" screen: it's what ${words ? `"${words}" opens on` : "comes after"} "${from}", the screen before it in this product's flow.`,
    np.brief ? `It shows: ${np.brief.replace(/\.$/, "")}.` : "",
    lines.length ? `When it opens it holds what the prototype put there (use these): ${lines.join(". ")}.` : "",
    "Same product, design system, platform and language as that screen, with the same names, prices and money format.",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 790);
}

/** The screen goes to `to` where it went on to the page; the page's card and its step's "not designed yet" go. One undo step. */
export function resolveNext(screen: string, page: string, to: string) {
  editRoutes((p) =>
    withRoute(p, screen, (r) => {
      const next = { ...r.next };
      const name = next[page]?.name;
      delete next[page];
      return {
        ...r,
        rules: r.rules.map((ru) => (ru.then.some((a) => a.do === "next" && a.page === page) ? { ...ru, then: ru.then.map((a) => (a.do === "next" && a.page === page ? { do: "go" as const, screen: to, transition: a.transition } : a)) } : ru)),
        ...(Object.keys(next).length ? { next } : { next: undefined }),
        steps: r.steps?.map((s) => (s.recipe === "nextPage" && name && s.label.includes(name) ? { ...s, label: s.label.replace(/,? not designed yet$/, "") } : s)),
      };
    }),
  );
}

