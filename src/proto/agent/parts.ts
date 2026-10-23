/**
 * What a new part says when code writes it (pure): the plainest sheet, bar, dialog or toast that
 * does the job, from what's on the screen — an item's own title, caption and price; the action's
 * own words. The prototyping agent asks the model for better (a dish's sizes and extras, the
 * words a bank would use); these stand in when it isn't asked, or when what it wrote doesn't pass.
 */
import type { Inst, ScreenSpec } from "@/design-system/builders";
import type { Doc } from "@/doc/schema";
import { collectionMoney, itemRecord } from "../items";
import { formatMoney, findMoney } from "../money";
import type { FrameScan } from "../scan";
import type { Candidate, PartRole } from "./candidates";

/** The few words code writes, in the screen's language (English otherwise). */
const WORDS = {
  en: { add: "Add", view: "View basket", cancel: "Cancel", done: "Done", sure: "This can't be undone." },
  ar: { add: "أضف", view: "عرض السلة", cancel: "إلغاء", done: "تم", sure: "لا يمكن التراجع عن هذا." },
};
const words = (lang: string | undefined) => (lang?.startsWith("ar") ? WORDS.ar : WORDS.en);

/** The screen's spec basics a part shares (platform, direction, language). */
function base(doc: Doc, screen: string): Pick<ScreenSpec, "platform" | "dir" | "lang"> {
  const spec = doc.nodes[screen]?.meta.spec as ScreenSpec | undefined;
  return { platform: spec?.platform, dir: spec?.dir, lang: spec?.lang };
}

const text = (t: string, style = "body", tone = "primary"): Inst => ({ component: "Text", props: { text: t, style, tone } });

/** A part for a candidate, written by code. */
export function partFor(doc: Doc, screen: string, scan: FrameScan, c: Candidate): ScreenSpec | null {
  const role: PartRole | undefined = c.needs?.role;
  const b = base(doc, screen);
  const w = words(b.lang);
  const col = scan.collections[0];
  const first = col ? itemRecord(doc, findPath(doc, screen, col.items[0]) ?? "", col.items[0], 0) : null;
  const price = first?.money ? formatMoney(first.money, moneyFormat(doc, screen, scan) ?? findMoney("AED 0.00")!.format) : "";
  switch (role) {
    case "options":
      if (!first) return null;
      // The item, how many, and Add with what it comes to: the recipe makes it about whichever item opened it.
      return {
        ...b,
        name: `${first.title} options`.slice(0, 40),
        surface: "sheet",
        header: [{ component: "TopBar", props: { title: first.title.slice(0, 24), leading: "close" } }],
        body: first.caption ? [text(first.caption, "body", "secondary")] : [],
        footer: [
          {
            component: "Stack",
            props: { direction: "horizontal", gap: "300", align: "center" },
            children: [
              { component: "Stepper", props: { value: 1 } },
              { component: "Button", props: { label: `${w.add}${price ? ` · ${price}` : ""}`.slice(0, 24), variant: "primary", fullWidth: true } },
            ],
          },
        ],
      };
    case "collection":
      return { ...b, name: "Basket bar", surface: "bar", body: [{ component: "Button", props: { label: `${w.view}${price ? ` · ${price}` : ""}`.slice(0, 24), variant: "primary", icon: "shopping-bag", fullWidth: true } }] };
    case "confirm": {
      const act = scan.actions.find((a) => a.path === c.opts?.action);
      if (!act) return null;
      const danger = act.variant === "danger";
      // It asks in the action's own words, and does it with the same button.
      return {
        ...b,
        name: `Confirm ${act.label}`.slice(0, 40),
        surface: "dialog",
        header: [text(`${act.label}?`, "title")],
        body: danger ? [text(w.sure, "body", "secondary")] : [],
        footer: [
          { component: "Button", props: { label: act.label.slice(0, 24), variant: danger ? "danger" : "primary", fullWidth: true } },
          { component: "Button", props: { label: w.cancel, variant: "tertiary", fullWidth: true } },
        ],
      };
    }
    case "done": {
      // A toast a block asked for says what it was asked to.
      const said = c.blocks?.find((x) => x.kind === "toast")?.text?.trim();
      return { ...b, name: "Done", surface: "toast", body: [text((said || w.done).slice(0, 60), "body-strong")] };
    }
    default:
      return null;
  }
}

/** The money format the screen's prices are written in: its items' first, then any copy, then its actions. */
export function moneyFormat(doc: Doc, screen: string, scan: FrameScan) {
  for (const col of scan.collections) {
    const f = collectionMoney(doc, screen, { label: "", of: { path: col.pattern }, component: col.component });
    if (f) return f;
  }
  for (const t of scan.texts) {
    const m = findMoney(t.text);
    if (m) return m.format;
  }
  for (const a of scan.actions) {
    const m = findMoney(a.label);
    if (m) return m.format;
  }
  return null;
}

/** A layer of the screen by spec path. */
function findPath(doc: Doc, frame: string, path: string): string | null {
  const stack = [...(doc.nodes[frame]?.children ?? [])];
  while (stack.length) {
    const id = stack.shift()!;
    const n = doc.nodes[id];
    if (!n) continue;
    if (n.meta.specPath === path) return id;
    stack.unshift(...n.children);
  }
  return null;
}
