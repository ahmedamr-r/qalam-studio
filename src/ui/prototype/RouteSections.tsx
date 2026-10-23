import clsx from "clsx";
import { useMemo } from "react";
import { AppWindow, Bell, CircleAlert, Layers2, Menu as MenuIcon, PanelBottom, PanelBottomOpen, Plus, Trash2, TriangleAlert } from "lucide-react";
import type { Dismiss, Doc, OverlayKind, RouteAction, RouteProto, RouteRef, RouteRule, VarDef } from "@/doc/schema";
import { studio } from "@/doc/store";
import { SURFACE_LABEL, type Surface } from "@/design-system/surfaces";
import { DISMISS, partFrames, partOf, resolveRef, routeOf } from "@/proto/routes";
import { lintRoute, type ProtoIssue } from "@/proto/lint";
import { collectionElements } from "@/proto/items";
import { addPart, addRule, removePart, removeRule, rulesFrom, setOverlay } from "@/proto/edit";
import { Button, Checkbox, Field, Hint, IconBtn, Row, Section, Select, Tag } from "../controls";
import { Menu, MenuItem } from "../menu";
import { r } from "../recipes";

/*
 * The Prototype tab's route sections: a screen's parts (the sheets, dialogs, toasts and menus it
 * opens, the bars it shows), what opens them, and how each closes. Qalam AI builds these too; here
 * the designer adds and adjusts them by hand. Each change is one undo step (proto/edit.ts).
 */

export const PART_ICON: Record<OverlayKind | "bar", typeof PanelBottomOpen> = {
  sheet: PanelBottomOpen,
  dialog: AppWindow,
  toast: Bell,
  menu: MenuIcon,
  bar: PanelBottom,
};

const DISMISS_LABEL: Record<Dismiss, string> = { scrim: "Tapping outside", drag: "Dragging it down", back: "Back", timer: "On its own" };
/** Which ways each kind can close on its own. */
const DISMISS_FOR: Record<OverlayKind, Dismiss[]> = { sheet: ["scrim", "drag", "back"], dialog: ["scrim", "back"], toast: ["timer"], menu: ["scrim", "back"] };

const partName = (doc: Doc, screen: string, part: string) => {
  const route = routeOf(doc, screen);
  const frame = route?.overlays[part]?.frame ?? route?.addOns[part]?.frame;
  return (frame && doc.nodes[frame]?.name) || part;
};

/** What an action does, in a few words. */
function actionText(doc: Doc, screen: string, a: RouteAction): string {
  switch (a.do) {
    case "open":
      return `Opens ${partName(doc, screen, a.part)}`;
    case "close":
      return a.part ? `Closes ${partName(doc, screen, a.part)}` : "Closes what's open";
    case "back":
      return "Goes back";
    case "go":
      return `Goes to ${doc.nodes[a.screen]?.name ?? "a screen"}`;
    case "next":
      return `Goes on to ${routeOf(doc, screen)?.next?.[a.page]?.name ?? "a page"}, not designed yet`;
    case "set":
      return `Sets ${a.v}`;
    case "inc":
      return a.by >= 0 ? `Adds ${a.by} to ${a.v}` : `Takes ${-a.by} from ${a.v}`;
    case "toggle":
      return `Toggles ${a.v}`;
    case "push":
      return `Adds to ${a.v.replace(/^app\./, "")}`;
    case "remove":
      return `Removes from ${a.v.replace(/^app\./, "")}`;
    case "change":
      return `${a.by >= 0 ? "Adds" : "Takes"} ${Math.abs(a.by)} ${a.by >= 0 ? "to" : "from"} its line's ${a.field}`;
    case "scrollTo":
      return "Scrolls to it";
  }
}

function triggerText(ru: RouteRule): string {
  const w = ru.when;
  switch (w.on) {
    case "tap":
      return "Tap";
    case "press":
      return "Press";
    case "hover":
      return "Hover";
    case "enter":
      return "On open";
    case "delay":
      return `After ${w.ms} ms`;
  }
}

/** The route sections for what's in scope: a screen (or a component on it), or one of a screen's parts. */
export function RouteSections({ doc, scope }: { doc: Doc; scope: { screen: string; path?: string } }) {
  const info = partOf(doc, scope.screen);
  if (info) return <PartSections doc={doc} owner={info.owner} part={info.part} path={scope.path} />;
  return scope.path === undefined ? (
    <>
      <ScreenParts doc={doc} screen={scope.screen} />
      <Behaviour doc={doc} screen={scope.screen} />
      <RouteChecks doc={doc} screen={scope.screen} />
    </>
  ) : (
    <Interactions doc={doc} screen={scope.screen} at={{ path: scope.path }} />
  );
}

/** What a value holds, in a few words ("one of 4", "1–20"). */
function holds(doc: Doc, screen: string, d: VarDef, route: RouteProto): string {
  const t = d.type;
  const count = (id: string) => {
    const c = route.items?.[id];
    return c ? collectionElements(doc, screen, c).length : 0;
  };
  switch (t.t) {
    case "bool":
      return "yes / no";
    case "int":
      return `${t.min}–${t.max}`;
    case "money":
      return "an amount";
    case "text":
      return "text";
    case "choice":
      return `one of ${count(t.of)}`;
    case "set":
      return `any of ${count(t.of)}`;
    case "list":
      return "a list";
  }
}

/** A layer's name for people ("ChipGroup" → "Chip group"). */
const layerName = (doc: Doc, id: string | null) => {
  const n = (id && doc.nodes[id]?.name) || "A layer";
  return n.replace(/([a-z])([A-Z])/g, (_, a: string, b: string) => `${a} ${b.toLowerCase()}`);
};

/** What the screen remembers and what scrolling does, read-only (Qalam AI and the recipes set these). */
function Behaviour({ doc, screen }: { doc: Doc; screen: string }) {
  const route = routeOf(doc, screen);
  if (!route) return null;
  const vars = Object.entries(route.vars ?? {});
  const used = new Set(JSON.stringify(route).match(/app\.[a-zA-Z][a-zA-Z0-9]*/g) ?? []);
  const app = Object.entries(doc.proto?.vars ?? {}).filter(([name]) => used.has(`app.${name}`));
  const scroll = route.scroll ?? [];
  if (!vars.length && !app.length && !scroll.length) return null;
  const row = (key: string, name: string, what: string, title?: string) => (
    <div key={key} title={title} className={clsx(r.layerRow, "w-full pl-[6px]")}>
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="shrink-0 text-caption text-fg-subtle">{what}</span>
    </div>
  );
  const caption = (text: string) => <p className="pt-[4px] pl-[6px] text-micro text-fg-subtle">{text}</p>;
  return (
    <Section title="Behaviour">
      <div className="-mt-[4px] flex flex-col pr-[8px]">
        {(vars.length > 0 || app.length > 0) && caption("Remembers")}
        {vars.map(([name, d]) => row(`v:${name}`, d.label, holds(doc, screen, d, route), d.resetOn ? `Starts over each time ${partName(doc, screen, d.resetOn)} opens` : undefined))}
        {app.map(([name, d]) => row(`a:${name}`, d.label, `${holds(doc, screen, d, route)}, every screen`, "Kept across screens"))}
        {scroll.length > 0 && caption("While scrolling")}
        {scroll.map((e, i) =>
          e.kind === "stick"
            ? row(`s:${i}`, layerName(doc, resolveRef(doc, screen, e.ref)), "sticks")
            : e.kind === "spy"
              ? row(`s:${i}`, route.vars?.[e.v]?.label ?? e.v, "follows")
              : row(`s:${i}`, route.vars?.[e.v]?.label ?? e.v, "turns on"),
        )}
      </div>
    </Section>
  );
}

/** Where an issue is: the part, or the layer its rule, value or scroll effect points at. */
function issueRef(doc: Doc, screen: string, at: ProtoIssue["at"]): RouteRef | null {
  const route = routeOf(doc, screen);
  if (!route) return null;
  if (at.part) return { part: at.part };
  if (at.rule) {
    const ru = route.rules.find((x) => x.id === at.rule);
    return ru && "ref" in ru.when ? ru.when.ref : null;
  }
  if (at.binding !== undefined) return route.bindings?.[at.binding]?.ref ?? null;
  if (at.swap !== undefined) return route.swaps?.[at.swap]?.ref ?? null;
  if (at.scroll !== undefined) {
    const e = route.scroll?.[at.scroll];
    return e && e.kind !== "spy" ? e.ref : null;
  }
  return null;
}

/** What would break or mislead in the route's prototype (proto/lint.ts), for the screen or one of its parts; a row selects what it's about. */
function RouteChecks({ doc, screen, part }: { doc: Doc; screen: string; part?: string }) {
  const all = useMemo(() => lintRoute(doc, screen), [doc, screen]);
  // On a part, what opens it is under Opened by already.
  const issues = part ? all.filter((x) => (issueRef(doc, screen, x.at)?.part ?? undefined) === part && !(x.check === "opens" && x.at.part === part)) : all;
  if (!issues.length) return null;
  const show = (x: ProtoIssue) => {
    const ref = issueRef(doc, screen, x.at);
    const id = ref ? resolveRef(doc, screen, ref) : screen;
    if (id) studio().select([id]);
  };
  return (
    <Section
      title={
        <span className="flex items-center gap-[8px]">
          Checks <Tag tone={issues.some((x) => x.severity === "error") ? "danger" : "warning"}>{issues.length}</Tag>
        </span>
      }
    >
      <div className="-mt-[4px] flex flex-col pr-[8px]">
        {issues.map((x, i) => (
          <button key={i} type="button" className={clsx(r.layerRow, "h-auto w-full items-start gap-[8px] py-[6px] pl-[6px] text-left text-caption")} onClick={() => show(x)}>
            {x.severity === "error" ? <CircleAlert size={14} className="mt-px shrink-0 text-danger" /> : <TriangleAlert size={14} className="mt-px shrink-0 text-warning" />}
            <span className="min-w-0 flex-1 text-fg">{x.message}</span>
          </button>
        ))}
      </div>
    </Section>
  );
}

/** A screen's parts, and adding one. */
function ScreenParts({ doc, screen }: { doc: Doc; screen: string }) {
  const parts = partFrames(doc, screen);
  const route = routeOf(doc, screen);
  return (
    <Section
      title="Parts"
      actions={
        <Menu
          label="Add a part"
          align="end"
          trigger={
            <button type="button" aria-label="Add a part" className={clsx(r.iconButtonSm, "aria-expanded:bg-active aria-expanded:text-fg")}>
              <Plus size={14} />
            </button>
          }
        >
          {(["sheet", "dialog", "toast", "menu", "bar"] as Surface[]).map((k) => {
            const Icon = PART_ICON[k];
            return (
              <MenuItem key={k} icon={<Icon size={14} />} onSelect={() => void addPart(screen, k).then((p) => p && studio().select([p.frame]))}>
                {SURFACE_LABEL[k]}
              </MenuItem>
            );
          })}
        </Menu>
      }
    >
      {parts.length ? (
        <div className="-mt-[4px] flex flex-col pr-[8px]">
          {parts.map((p) => {
            const Icon = PART_ICON[p.kind];
            const opens = (route?.rules ?? []).filter((ru) => ru.then.some((a) => a.do === "open" && a.part === p.part)).length;
            return (
              <button key={p.part} type="button" className={clsx(r.layerRow, "w-full pl-[6px] text-left")} onClick={() => studio().select([p.frame])}>
                <Icon size={14} className="shrink-0 text-fg-subtle" />
                <span className="min-w-0 flex-1 truncate">{doc.nodes[p.frame]?.name ?? p.part}</span>
                <span className="shrink-0 text-caption text-fg-subtle">{opens ? `${SURFACE_LABEL[p.kind]} · opened by ${opens}` : SURFACE_LABEL[p.kind]}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="pr-[8px] text-caption text-fg-muted">What this screen opens without leaving it — a sheet, a dialog, a toast, a menu — or shows over it, like a basket bar. Each is a frame of its own under the screen.</p>
      )}
    </Section>
  );
}

/** What tapping a component does to the route: the rules that start there, and adding one. */
function Interactions({ doc, screen, at, self }: { doc: Doc; screen: string; at: RouteRef; self?: string }) {
  const route = routeOf(doc, screen);
  const rules = rulesFrom(route, at);
  const parts = partFrames(doc, screen).filter((p) => p.part !== self);
  const options = [
    ...parts.map((p) => ({ value: `open:${p.part}`, label: `Open ${doc.nodes[p.frame]?.name ?? p.part}`, group: "Open" })),
    ...(self ? [{ value: `close:${self}`, label: "Close it", group: "Close" }] : []),
    { value: "back", label: "Go back (closes what's open first)", group: "Back" },
  ];
  const add = (v: string) => {
    const a: RouteAction = v === "back" ? { do: "back" } : v.startsWith("open:") ? { do: "open", part: v.slice(5) } : { do: "close", part: v.slice(6) };
    addRule(screen, { when: { on: "tap", ref: at }, then: [a] });
  };
  return (
    <Section title={self ? "On tap" : "Opens"}>
      {rules.length > 0 && (
        <div className="-mt-[4px] flex flex-col pr-[8px]">
          {rules.map((ru) => (
            <div key={ru.id} className={clsx(r.layerRow, "w-full pl-[6px]")}>
              <span className="shrink-0 text-caption text-fg-subtle">{triggerText(ru)}</span>
              <span className="min-w-0 flex-1 truncate">{ru.then.map((a) => actionText(doc, screen, a)).join(", then ")}</span>
              <IconBtn size="sm" label="Remove" onClick={() => removeRule(screen, ru.id)}>
                <Trash2 size={12} />
              </IconBtn>
            </div>
          ))}
        </div>
      )}
      <Field label={rules.length ? "Also on tap" : "On tap"}>
        <Row>
          <Select className="col-span-2" ariaLabel="On tap" value="" options={options} onChange={add} />
        </Row>
      </Field>
      {!parts.length && !self && <Hint tone="info">Add a part to the screen (select the screen, then + in Parts) to open it from here.</Hint>}
    </Section>
  );
}

/** One of a screen's parts: how it closes and what opens it; a component in it: what tapping it does. */
function PartSections({ doc, owner, part, path }: { doc: Doc; owner: string; part: string; path?: string }) {
  const route = routeOf(doc, owner);
  const o = route?.overlays[part];
  const kind: OverlayKind | "bar" = o?.kind ?? "bar";
  const Icon = PART_ICON[kind];
  if (path !== undefined) return <Interactions doc={doc} screen={owner} at={{ part, path }} self={part} />;
  const openers = (route?.rules ?? []).filter((ru) => ru.then.some((a) => a.do === "open" && a.part === part));
  return (
    <>
      <Section title={SURFACE_LABEL[kind]}>
        <p className="flex min-w-0 items-center gap-[6px] pr-[8px] text-caption text-fg-subtle">
          <Icon size={12} className="shrink-0" />
          <span className="shrink-0">Part of</span>
          <button type="button" className={clsx(r.link, "min-w-0 truncate text-left")} onClick={() => studio().select([owner])}>
            {doc.nodes[owner]?.name ?? "its screen"}
          </button>
        </p>
        {o && (
          <Field label="Closes by">
            <div className="flex flex-col">
              {DISMISS_FOR[o.kind]
                .filter((d) => DISMISS.includes(d))
                .map((d) => (
                  <Checkbox
                    key={d}
                    checked={o.dismiss.includes(d)}
                    label={d === "timer" ? `${DISMISS_LABEL[d]} after ${(o.ms ?? 3000) / 1000} s` : DISMISS_LABEL[d]}
                    onChange={(on) => setOverlay(owner, part, { dismiss: on ? [...o.dismiss, d] : o.dismiss.filter((x) => x !== d) })}
                  />
                ))}
            </div>
          </Field>
        )}
        {o?.kind === "sheet" && (
          <Field label="Height">
            <Row>
              <Select
                className="col-span-2"
                ariaLabel="Sheet height"
                value={o.detent ?? "content"}
                options={[
                  { value: "content", label: "As tall as its content" },
                  { value: "full", label: "Full height" },
                ]}
                onChange={(v) => setOverlay(owner, part, { detent: v })}
              />
            </Row>
          </Field>
        )}
        {o?.kind === "toast" && (
          <Field label="Shows for">
            <Row>
              <Select
                className="col-span-2"
                ariaLabel="Toast time"
                value={String(o.ms ?? 3000)}
                options={["2000", "3000", "4000", "6000"].map((v) => ({ value: v, label: `${Number(v) / 1000} seconds` }))}
                onChange={(v) => setOverlay(owner, part, { ms: Number(v) })}
              />
            </Row>
          </Field>
        )}
      </Section>
      <Section title="Opened by">
        {openers.length ? (
          <div className="-mt-[4px] flex flex-col pr-[8px]">
            {openers.map((ru) => {
              const from = "ref" in ru.when ? ru.when.ref : null;
              const where = from?.path ? `${from.part ? partName(doc, owner, from.part) : (doc.nodes[owner]?.name ?? "")} · ${from.path}` : "the screen";
              return (
                <div key={ru.id} className={clsx(r.layerRow, "w-full pl-[6px]")}>
                  <span className="shrink-0 text-caption text-fg-subtle">{triggerText(ru)}</span>
                  <span className="min-w-0 flex-1 truncate">{where}</span>
                  <IconBtn size="sm" label="Remove" onClick={() => removeRule(owner, ru.id)}>
                    <Trash2 size={12} />
                  </IconBtn>
                </div>
              );
            })}
          </div>
        ) : (
          <Hint tone="info">Nothing opens it yet: select a component on {doc.nodes[owner]?.name ?? "its screen"} and pick it under Opens.</Hint>
        )}
        <Row>
          <Button variant="secondary" className="col-span-2 min-w-0" onClick={() => removePart(owner, part)}>
            <Layers2 size={14} /> <span className="truncate">Remove this part</span>
          </Button>
        </Row>
      </Section>
      <RouteChecks doc={doc} screen={owner} part={part} />
    </>
  );
}
