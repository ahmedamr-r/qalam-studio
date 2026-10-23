import type { CSSProperties, ReactNode } from "react";
import clsx from "clsx";
import { px, contrastRatio, wcagLevel, type TokenSet } from "@/design-system/resolve";
import type { DesignDocs } from "@/design-system/docs";
import { r } from "../recipes";
import { Swatch, Tag } from "../controls";
import { cssGradient, cssShadow } from "../css";

/*
 * Read-only views of a design system's tokens (the Tokens panel and the token editor). The chrome is
 * themed; the previews are the system's own colours, so each sits on a hairline (and swatches on the
 * swatch ring) to stay visible when a dark system meets the dark theme.
 */

const Label = ({ children }: { children: ReactNode }) => <div className={clsx(r.eyebrow, "mb-[6px]")}>{children}</div>;
/** A preview drawn with the system's own fills: a hairline keeps its edge in both themes. */
const previewEdge = "shadow-[inset_0_0_0_1px_var(--color-line-subtle)]";

/**
 * Observed in the screenshot vs inferred from the language (recorded in token descriptions): a filled
 * nuqta for what was seen, a hollow one for what Qalam AI inferred (the AI glyph's own grammar).
 */
function Provenance({ description }: { description?: string }) {
  if (!description) return null;
  const observed = description.startsWith("Observed");
  if (!observed && !description.startsWith("Inferred")) return null;
  return (
    <span
      title={description}
      role="img"
      className={clsx("inline-block size-[6px] shrink-0 rotate-45 rounded-[1px]", observed ? "bg-fg-muted" : "shadow-[inset_0_0_0_1px_var(--color-fg-subtle)]")}
      aria-label={observed ? "Observed in the source" : "Inferred"}
    />
  );
}

const GROUP_LABEL: Record<string, string> = { "bg.": "Background", "text.": "Text", "icon.": "Icon", "border.": "Border", "feedback.": "Feedback", "color.": "Primitives" };

export function ColorView({ ts }: { ts: TokenSet }) {
  const groups = Object.keys(GROUP_LABEL);
  return (
    <div className="flex flex-col gap-[14px] p-[12px]">
      <p className="flex items-center gap-[12px] px-[4px] text-micro text-fg-subtle">
        <span className="flex items-center gap-[6px]">
          <Provenance description="Observed" /> Observed
        </span>
        <span className="flex items-center gap-[6px]">
          <Provenance description="Inferred" /> Inferred
        </span>
      </p>
      {groups.map((g) => {
        const list = ts.ofType("color", g);
        if (!list.length) return null;
        return (
          <div key={g}>
            <div className="flex items-baseline justify-between px-[4px]">
              <Label>{GROUP_LABEL[g]}</Label>
              <span className="text-micro text-fg-subtle tnum">{list.length}</span>
            </div>
            <div className="flex flex-col">
              {list.map((t) => (
                <div key={t.path} className="q-item flex min-h-[32px] items-center gap-[10px] rounded-md px-[4px] py-[4px] hover:bg-hover" title={t.description}>
                  <Swatch color={t.value as string} size={18} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-[6px] text-caption font-medium text-fg">
                      <span className="truncate">{t.path}</span> <Provenance description={t.description} />
                    </div>
                    {t.aliasOf && <div className="truncate text-micro text-fg-subtle">→ {t.aliasOf}</div>}
                  </div>
                  <span className="shrink-0 font-mono text-micro text-fg-subtle">{String(t.value)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TypeView({ ts }: { ts: TokenSet }) {
  const fam = (p: string) => String(ts.get(p)?.value ?? "");
  const arabic = fam("font.family.arabic");
  return (
    <div className="flex flex-col gap-[8px] p-[12px]">
      <div className="mb-[4px] grid grid-cols-3 gap-[6px] text-micro">
        {(["latin", "display", "arabic"] as const).map((k) => (
          <div key={k} className={clsx(note, "px-[8px] py-[6px]")}>
            <div className="text-fg-subtle capitalize">{k}</div>
            <div className="truncate text-caption font-medium text-fg" style={{ fontFamily: fam(`font.family.${k}`) }}>
              {fam(`font.family.${k}`)}
            </div>
          </div>
        ))}
      </div>
      {ts.ofType("typography").map((t) => {
        const s = ts.typography(t.path)!;
        return (
          <div key={t.path} className={clsx(note, "p-[10px] text-fg")}>
            <div className="mb-[6px] flex justify-between gap-[8px] text-micro text-fg-subtle">
              <span className="truncate font-medium text-fg-muted">{t.path}</span>
              <span className="shrink-0 tnum">
                {s.fontFamily} · {s.fontSize}/{s.lineHeight} · {s.fontWeight}
              </span>
            </div>
            <div style={{ fontFamily: s.fontFamily, fontSize: Math.min(s.fontSize, 28), fontWeight: s.fontWeight, lineHeight: `${Math.min(s.lineHeight, 34)}px`, letterSpacing: s.letterSpacing }}>Where to next?</div>
            <div dir="rtl" style={{ fontFamily: arabic, fontSize: Math.min(s.fontSize, 24), fontWeight: s.fontWeight, lineHeight: 1.55 }}>
              إلى أين الآن؟
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ShapeView({ ts }: { ts: TokenSet }) {
  return (
    <div className="flex flex-col gap-[16px] p-[12px]">
      <div>
        <Label>Radius</Label>
        <div className="grid grid-cols-4 gap-[8px]">
          {ts.ofType("dimension", "radius.").map((t) => (
            <div key={t.path} className="flex flex-col items-center gap-[4px]">
              <div className="size-[44px] border-[1.5px] border-fg-subtle bg-hover" style={{ borderRadius: Math.min(px(t.value), 22) }} />
              <span className="mt-[2px] text-micro text-fg-muted">{t.path.replace("radius.", "")}</span>
              <span className="text-micro text-fg-subtle tnum">{px(t.value)}</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <Label>Border width</Label>
        <div className="grid grid-cols-4 gap-[8px]">
          {ts.ofType("dimension", "border-width.").map((t) => (
            <div key={t.path} className="flex flex-col items-center gap-[4px]">
              {/* The system's own border colour, on the light stage it was made for. */}
              <div className="h-[40px] w-[44px] rounded-md bg-stage" style={{ border: `${px(t.value)}px solid ${ts.color("border.strong")}` }} />
              <span className="mt-[2px] text-micro text-fg-muted">{t.path.replace("border-width.", "")}</span>
              <span className="text-micro text-fg-subtle tnum">{px(t.value)}</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <Label>Space</Label>
        {ts.ofType("dimension", "space.").map((t) => (
          <div key={t.path} className="flex h-[22px] items-center gap-[8px]">
            <span className="w-[72px] shrink-0 truncate text-micro text-fg-muted">{t.path}</span>
            <div className="h-[8px] rounded-xs bg-fg-subtle/60" style={{ width: Math.max(1, px(t.value) * 2) }} />
            <span className="text-micro text-fg-subtle tnum">{px(t.value)}</span>
          </div>
        ))}
      </div>
      <div>
        <Label>Layout</Label>
        {ts.ofType("dimension", "layout.").map((t) => (
          <div key={t.path} className="flex h-[22px] items-center justify-between text-micro">
            <span className="text-fg-muted">{t.path}</span>
            <span className="text-fg-subtle tnum">{px(t.value)}px</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** CSS rendering of a fill token (flat or gradient). */
function bg(ts: TokenSet, path: string): string {
  const p = ts.paint(path);
  return p?.gradient ? cssGradient(p.gradient) : (p?.color ?? "transparent");
}

/** Live previews of the component recipes, drawn with CSS from the token values. */
function Recipes({ ts }: { ts: TokenSet }) {
  const d = (p: string) => ts.dimension(p) ?? 0;
  const c = (p: string) => ts.color(p) ?? "transparent";
  const sh = (p: string) => cssShadow(ts.shadowLayers(p));
  const type = (p: string): CSSProperties => {
    const s = ts.typography(p)!;
    return { fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight };
  };
  const border = (color: string, width: string) => (d(width) > 0 ? `${d(width)}px solid ${c(color)}` : "none");
  return (
    <div className={clsx("flex flex-col gap-[12px] rounded-xl p-[12px]", previewEdge)} style={{ background: c("bg.canvas") }}>
      <div className="flex flex-wrap gap-[8px]">
        <div className="flex items-center justify-center" style={{ ...type("type.body-strong"), height: d("component.button.height-md"), padding: `0 ${d("component.button.padding-x-md")}px`, borderRadius: d("component.button.radius"), background: bg(ts, "component.button.primary.fill"), color: c("component.button.primary.label"), boxShadow: sh("component.button.shadow") }}>
          Primary
        </div>
        <div className="flex items-center justify-center" style={{ ...type("type.body-strong"), height: d("component.button.height-md"), padding: `0 ${d("component.button.padding-x-md")}px`, borderRadius: d("component.button.radius"), background: bg(ts, "component.button.secondary.fill"), color: c("component.button.secondary.label"), border: border("component.button.secondary.border", "component.button.secondary.border-width") }}>
          Secondary
        </div>
      </div>
      <div className="flex items-center" style={{ ...type("type.body"), height: d("component.input.height"), padding: `0 ${d("component.input.padding-x")}px`, borderRadius: d("component.input.radius"), background: bg(ts, "component.input.fill"), color: c("text.secondary"), border: border("component.input.border", "component.input.border-width"), boxShadow: sh("component.input.shadow") }}>
        Search
      </div>
      <div className="flex flex-wrap gap-[8px]">
        {["All", "Income"].map((l, i) => (
          <div key={l} className="flex items-center" style={{ ...type("type.label"), height: d("component.chip.height"), padding: `0 ${d("component.chip.padding-x")}px`, borderRadius: d("component.chip.radius"), background: bg(ts, i ? "component.chip.fill" : "component.chip.selected.fill"), color: c(i ? "component.chip.label" : "component.chip.selected.label"), border: i ? border("component.chip.border", "component.chip.border-width") : "none" }}>
            {l}
          </div>
        ))}
      </div>
      <div style={{ padding: 16, borderRadius: d("component.card.radius"), background: bg(ts, "bg.surface-raised"), border: border("component.card.raised.border", "component.card.raised.border-width"), boxShadow: sh("component.card.raised.shadow") }}>
        <div style={{ ...type("type.headline"), color: c("text.primary") }}>Raised card</div>
        <div style={{ ...type("type.caption"), color: c("text.secondary") }}>component.card.raised.*</div>
      </div>
      <div className="flex items-center gap-[12px]" style={{ padding: d("component.banner.padding"), borderRadius: d("component.banner.radius"), background: bg(ts, "component.banner.brand.fill"), boxShadow: sh("component.banner.shadow") }}>
        <div style={{ ...type("type.title"), color: c("component.banner.brand.title") }}>Promo banner</div>
      </div>
    </div>
  );
}

export function EffectsView({ ts }: { ts: TokenSet }) {
  return (
    <div className="flex flex-col gap-[16px] p-[12px]">
      <div>
        <Label>Component recipes</Label>
        <Recipes ts={ts} />
      </div>
      <div>
        <Label>Shadows</Label>
        <div className={clsx("grid grid-cols-3 gap-[12px] rounded-xl p-[12px]", previewEdge)} style={{ background: ts.color("bg.surface") }}>
          {ts.roles("shadow").map((t) => {
            const layers = ts.shadowLayers(t.path) ?? [];
            return (
              <div key={t.path} className="flex flex-col items-center gap-[6px]" title={layers.map((l) => `${l.kind} ${l.x} ${l.y} blur ${l.blur} spread ${l.spread} ${l.color}`).join("\n") || "none"}>
                <div className="h-[44px] w-full rounded-lg" style={{ background: ts.color("bg.surface-raised"), boxShadow: cssShadow(layers) }} />
                {/* Labels sit on the system's surface, so they take its text colours. */}
                <span className="text-micro" style={{ color: ts.color("text.primary") }}>
                  {t.path.replace("shadow.", "")}
                </span>
                <span className="text-micro" style={{ color: ts.color("text.secondary") }}>{layers.length ? `${layers.length} layer${layers.length > 1 ? "s" : ""}${layers.some((l) => l.kind === "inner") ? " · inner" : ""}` : "none"}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div>
        <Label>Gradients</Label>
        <div className="flex flex-col gap-[8px]">
          {ts.ofType("gradient").map((t) => (
            <div key={t.path} className="flex items-center gap-[10px]" title={t.description}>
              <div className="h-[32px] w-[64px] shrink-0 rounded-md shadow-swatch" style={{ background: bg(ts, t.path) }} />
              <div className="min-w-0">
                <div className="text-caption font-medium text-fg">{t.path}</div>
                {t.description && <div className="truncate text-micro text-fg-subtle">{t.description}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const Para = ({ title, children }: { title: string; children: ReactNode }) =>
  children ? (
    <div>
      <Label>{title}</Label>
      <div className="text-body leading-[20px] text-fg">{children}</div>
    </div>
  ) : null;

const Bullets = ({ items }: { items: string[] }) => (
  <ul className="flex list-disc flex-col gap-[2px] pl-[16px] text-body leading-[20px] text-fg marker:text-fg-faint">
    {items.map((i, k) => (
      <li key={k}>{i}</li>
    ))}
  </ul>
);

export function LanguageView({ docs }: { docs: DesignDocs }) {
  const l = docs.language;
  if (!l.summary) return <Empty>No design language yet.</Empty>;
  return (
    <div className="flex flex-col gap-[14px] p-[12px]">
      <div>
        <div className="text-heading font-semibold text-fg">{l.name}</div>
        <p className="mt-[4px] text-body leading-[20px] text-fg-muted">{l.summary}</p>
        {l.personality.length > 0 && (
          <div className="mt-[8px] flex flex-wrap gap-[4px]">
            {l.personality.map((p) => (
              <Tag key={p}>{p}</Tag>
            ))}
          </div>
        )}
      </div>
      {l.principles.length > 0 && (
        <div className="flex flex-col gap-[6px]">
          <Label>Principles</Label>
          {l.principles.map((p) => (
            <div key={p.title} className={clsx(note, "px-[10px] py-[8px]")}>
              <div className="text-body font-medium text-fg">{p.title}</div>
              <div className="mt-[2px] text-caption text-fg-muted">{p.body}</div>
            </div>
          ))}
        </div>
      )}
      <Para title="Colour">{l.color}</Para>
      <Para title="Typography">{l.typography}</Para>
      <Para title="Shape">{l.shape}</Para>
      <Para title="Depth">{l.depth}</Para>
      <Para title="Density">{l.density}</Para>
      <Para title="Iconography">{l.iconography}</Para>
      <Para title="Imagery">{l.imagery}</Para>
      <Para title="Voice">{l.voice}</Para>
      {l.dos.length > 0 && <Para title="Do">{<Bullets items={l.dos} />}</Para>}
      {l.donts.length > 0 && <Para title="Don't">{<Bullets items={l.donts} />}</Para>}
    </div>
  );
}

export function LayoutView({ docs }: { docs: DesignDocs }) {
  const l = docs.layout;
  if (!l.summary) return <Empty>No layout orchestration yet.</Empty>;
  return (
    <div className="flex flex-col gap-[14px] p-[12px]">
      <p className="text-body leading-[20px] text-fg">
        {l.summary} <Tag>{l.density}</Tag>
      </p>
      <Para title="Grid">{l.grid}</Para>
      <Para title="Rhythm">{l.rhythm}</Para>
      <Para title="Navigation">{l.navigation}</Para>
      <Para title="Hierarchy">{l.hierarchy}</Para>
      {l.templates.length > 0 && (
        <div className="flex flex-col gap-[6px]">
          <Label>Screen templates</Label>
          {l.templates.map((t) => (
            <div key={t.name} className={clsx(note, "px-[10px] py-[8px]")}>
              <div className="text-body font-medium text-fg">{t.name}</div>
              <div className="mb-[6px] text-caption text-fg-muted">{t.whenToUse}</div>
              {t.regions.map((x, i) => (
                <div key={i} className="flex gap-[8px] text-caption leading-[20px]">
                  <span className="w-[48px] shrink-0 text-fg-subtle">{x.region}</span>
                  <span className="text-fg">{x.components.join(" → ")}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {l.rules.length > 0 && <Para title="Rules">{<Bullets items={l.rules} />}</Para>}
    </div>
  );
}

/** WCAG level → tone: both passes are success (AAA carries a ring), large-only is a warning, fail is danger. */
const LEVEL = {
  AAA: "bg-success-subtle text-success shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-success)_45%,transparent)]",
  AA: "bg-success-subtle text-success",
  "AA Large": "bg-warning-subtle text-warning",
  Fail: "bg-danger-subtle text-danger",
} as const;

export function ContrastView({ ts }: { ts: TokenSet }) {
  const fgs = ["text.primary", "text.secondary", "text.tertiary", "text.inverse", "text.on-brand", "text.on-brand-strong", "text.link", "text.error"];
  const bgs = ["bg.canvas", "bg.surface", "bg.brand", "bg.brand-strong", "bg.brand-subtle", "bg.inverse", "bg.go", "bg.get"];
  return (
    <div className="overflow-x-auto p-[12px]">
      <p className="mb-[8px] text-caption text-fg-muted">WCAG 2.2 contrast for body text (4.5:1 AA). Hover a cell for the ratio.</p>
      <table className="border-separate border-spacing-[2px] text-micro tnum">
        <thead>
          <tr>
            <th />
            {bgs.map((b) => (
              <th key={b} className="h-[64px] w-[28px] align-bottom font-medium text-fg-subtle">
                <div className="flex origin-bottom-left translate-x-[10px] -rotate-60 whitespace-nowrap">{b.replace("bg.", "")}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {fgs.map((f) => (
            <tr key={f}>
              <td className="pr-[4px] text-right whitespace-nowrap text-fg-muted">{f.replace("text.", "")}</td>
              {bgs.map((b) => {
                const ratio = contrastRatio(ts.color(f)!, ts.color(b)!);
                const lvl = wcagLevel(ratio);
                return (
                  <td key={b} title={`${f} on ${b}: ${ratio.toFixed(2)}:1 (${lvl})`} className={clsx("size-[28px] rounded-sm text-center font-medium", LEVEL[lvl as keyof typeof LEVEL])}>
                    {ratio.toFixed(1)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-[10px] flex flex-wrap gap-[6px]">
        <span className={clsx(r.tag, LEVEL.AAA)}>AAA ≥7</span>
        <Tag tone="success">AA ≥4.5</Tag>
        <Tag tone="warning">Large only ≥3</Tag>
        <Tag tone="danger">Fail</Tag>
      </div>
    </div>
  );
}

/** Shared by the type and language views: a filled note on the muted surface. */
const note = "rounded-lg bg-muted shadow-[inset_0_0_0_1px_var(--color-line-subtle)]";

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-[16px] py-[24px] text-center text-body text-fg-subtle">{children}</p>;
}
