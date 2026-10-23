import type { Doc, Flag, FlagSeverity, FrameNode, SceneNode, TextNode, TextProps } from "@/doc/schema";
import { contrastRatio, flatten, isLargeText, px, wcagLevel, type TokenSet } from "@/design-system/resolve";
import { tokensForNode } from "@/design-system/registry";
import { isDirectional } from "@/design-system/icons";
import { descendants, topFrameOf, worldBounds, type Box } from "@/doc/geometry";
import { studio } from "@/doc/store";
import { measureText, fitText } from "@/doc/ops";
import { hasAutoLayout, inFlow } from "@/doc/autolayout";

export type Category = "tokens" | "accessibility" | "rtl" | "content" | "system";

export type Fix =
  | { kind: "fill-token"; token: string }
  | { kind: "stroke-token"; token: string }
  | { kind: "stroke-width-token"; token: string }
  | { kind: "shadow-token"; token: string }
  | { kind: "radius-token"; token: string }
  | { kind: "type-token"; token: string }
  | { kind: "text-dir"; dir: "rtl" | "ltr" }
  | { kind: "mirror-icon"; mirrored: boolean }
  | { kind: "letter-spacing-0" }
  | { kind: "font-arabic" }
  | { kind: "min-size"; size: number }
  | { kind: "auto-height" };

export interface Finding {
  id: string;
  nodeId: string;
  nodeName: string;
  rule: string;
  category: Category;
  severity: FlagSeverity;
  message: string;
  wcag?: string;
  replaceWith?: string;
  fix?: Fix & { label: string };
}

/** Flags created while building components; they survive re-linting. */
const BUILD_RULES = new Set([
  "not-in-system",
  "unknown-prop",
  "missing-prop",
  "char-limit",
  "off-system-value",
  "unknown-icon",
  "too-many-items",
  "out-of-range",
  "unexpected-children",
  "unknown-token",
  // Graphics and made components (see design-system/custom.ts).
  "bad-path",
  "graphic-bounds",
  "graphic-empty",
  "nested-custom",
  "local-component",
  "bad-image",
]);

const hasArabic = (s: string) => /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(s);

function frameDir(doc: Doc, n: SceneNode): "ltr" | "rtl" {
  let p = n.parentId;
  while (p) {
    const f = doc.nodes[p];
    if (f.type === "frame") return (f as FrameNode).dir;
    p = f.parentId;
  }
  return n.type === "frame" ? (n as FrameNode).dir : "ltr";
}

const contains = (a: Box, b: Box) => a.x <= b.x + 0.5 && a.y <= b.y + 0.5 && a.x + a.w >= b.x + b.w - 0.5 && a.y + a.h >= b.y + b.h - 0.5;

/** Colour painted behind a node: covering earlier siblings first, then ancestors' fills. */
export function effectiveBackground(doc: Doc, id: string): { color: string; token?: string; from: string } {
  const target = worldBounds(doc, id);
  let cur = doc.nodes[id];
  while (cur) {
    const siblings = cur.parentId ? doc.nodes[cur.parentId].children : doc.roots;
    const idx = siblings.indexOf(cur.id);
    for (let i = idx - 1; i >= 0; i--) {
      const s = doc.nodes[siblings[i]];
      if (!s?.visible || !s.fill || s.type === "text" || s.type === "icon") continue;
      if (contains(worldBounds(doc, s.id), target)) return { color: s.fill.color, token: s.fill.token, from: s.name };
      // A covering sibling frame may contain a filled child underneath us.
    }
    if (!cur.parentId) break;
    const parent = doc.nodes[cur.parentId];
    if (parent.fill && parent.visible) return { color: parent.fill.color, token: parent.fill.token, from: parent.name };
    cur = parent;
  }
  return { color: "#FFFFFF", from: "canvas" };
}

let seq = 0;
const fid = () => `f${++seq}`;

/**
 * Where a line may break between words: breaking spaces (not no-break ones, which hold "42.00 AED"
 * together), and after a dash or slash that a letter follows ("check-in", "AED/month").
 */
const WORD_BREAK = /[ \t\n\r\f\v\u1680\u2000-\u2006\u2008-\u200B\u2028\u2029\u205F\u3000]+|(?<=[-\u2010\u2013\u2014/])(?=\p{L})/u;

/** A text's widest word, measured on one line in the text's own style. */
function widestWord(t: TextProps): { word: string; w: number } | null {
  let widest: { word: string; w: number } | null = null;
  for (const word of new Set(t.content.split(WORD_BREAK))) {
    if (!word) continue;
    const w = measureText({ ...t, content: word, maxLines: undefined }, null).w;
    if (!widest || w > widest.w) widest = { word, w };
  }
  return widest;
}

const arabicFace = (ts: TokenSet) => String(ts.get("font.family.arabic")?.value ?? "IBM Plex Sans Arabic");
const sameEffects = (a: unknown, b: unknown) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

/** Lint one node against the design system its screen is bound to (or `ts`). */
/** The platform of the generated screen a node is in (mobile when it isn't in one). */
function platformOfNode(doc: Doc, id: string): string {
  return doc.nodes[topFrameOf(doc, id)]?.meta.spec?.platform ?? "mobile";
}

export function auditNode(doc: Doc, n: SceneNode, ts: TokenSet = tokensForNode(doc, n.id)): Finding[] {
  const out: Finding[] = [];
  const push = (f: Omit<Finding, "id" | "nodeId" | "nodeName">) => out.push({ id: fid(), nodeId: n.id, nodeName: n.name, ...f });
  if (!n.visible) return out;
  const isText = n.type === "text";
  const isIcon = n.type === "icon";

  // --- colour tokens -------------------------------------------------------
  if (n.fill) {
    const prefer = isText ? ["text."] : isIcon ? ["icon."] : n.type === "path" ? ["bg.", "icon.", "feedback.", "border."] : ["bg.", "feedback.", "border."];
    if (!n.fill.token) {
      // Only same-role tokens count (text fills vs text.*); a text colour never binds to bg.*.
      const same = ts.colorMatches(n.fill.color).filter((t) => prefer.some((p) => t.path.startsWith(p)));
      let nearest = ts.nearestColor(n.fill.color, prefer);
      if (isText || isIcon) {
        // Suggest the closest token that also passes contrast where it sits (e.g. grey caption → text.secondary).
        const bg = effectiveBackground(doc, n.id).color;
        const need = isText ? (isLargeText((n as TextNode).text.fontSize, (n as TextNode).text.fontWeight) ? 3 : 4.5) : 3;
        const passing = ts.ofType("color", prefer[0]).filter((t) => contrastRatio(t.value as string, bg) >= need);
        const diff = passing
          .map((t) => ({ token: t, deltaE: ts.nearestColor(n.fill!.color, [t.path])!.deltaE }))
          .sort((a, b) => a.deltaE - b.deltaE)[0];
        if (diff) nearest = diff;
      }
      if (same.length > 1) {
        const pick = prefer.flatMap((p) => same.filter((t) => t.path.startsWith(p)))[0].path;
        push({
          rule: "ambiguous-color",
          category: "tokens",
          severity: "warning",
          message: `Raw ${n.fill.color} matches ${same.map((t) => t.path).join(", ")}. Same value, different meaning: bind by intent.`,
          replaceWith: pick,
          fix: { kind: "fill-token", token: pick, label: `Bind ${pick}` },
        });
      } else if (nearest) {
        push({
          rule: "off-token-color",
          category: "tokens",
          severity: nearest.deltaE < 2 ? "info" : "warning",
          message: `Raw ${isText ? "text" : isIcon ? "icon" : "fill"} colour ${n.fill.color} is not a token${nearest.deltaE < 2 ? ` (≈ ${nearest.token.path})` : ""}.`,
          replaceWith: nearest.token.path,
          fix: { kind: "fill-token", token: nearest.token.path, label: `Use ${nearest.token.path}` },
        });
      }
    } else {
      const v = ts.paint(n.fill.token)?.color;
      if (!v)
        push({ rule: "unknown-token", category: "tokens", severity: "error", message: `Fill token "${n.fill.token}" does not exist.` });
      else if (v !== n.fill.color.toUpperCase())
        push({
          rule: "token-drift",
          category: "tokens",
          severity: "warning",
          message: `Bound to ${n.fill.token} (${v}) but painted ${n.fill.color}.`,
          fix: { kind: "fill-token", token: n.fill.token, label: "Re-apply token" },
        });
    }
  }
  if (n.stroke?.token && n.stroke.width > 0) {
    const v = ts.color(n.stroke.token);
    if (!v) push({ rule: "unknown-token", category: "tokens", severity: "error", message: `Stroke token "${n.stroke.token}" does not exist.` });
    else if (v !== n.stroke.color.toUpperCase())
      push({ rule: "token-drift", category: "tokens", severity: "warning", message: `Stroke bound to ${n.stroke.token} (${v}) but painted ${n.stroke.color}.`, fix: { kind: "stroke-token", token: n.stroke.token, label: "Re-apply token" } });
  }
  if (n.stroke?.widthToken) {
    const w = ts.dimension(n.stroke.widthToken);
    if (w !== undefined && w !== n.stroke.width)
      push({ rule: "token-drift", category: "tokens", severity: "warning", message: `Stroke width bound to ${n.stroke.widthToken} (${w}px) but is ${n.stroke.width}px.`, fix: { kind: "stroke-width-token", token: n.stroke.widthToken, label: "Re-apply token" } });
  }
  if (n.shadowToken) {
    const layers = ts.shadowLayers(n.shadowToken);
    if (!layers) push({ rule: "unknown-token", category: "tokens", severity: "error", message: `Shadow token "${n.shadowToken}" does not exist.` });
    else if (!sameEffects(layers, n.effects))
      push({ rule: "token-drift", category: "tokens", severity: "warning", message: `Shadow bound to ${n.shadowToken} but its layers differ.`, fix: { kind: "shadow-token", token: n.shadowToken, label: "Re-apply token" } });
  }
  if (n.stroke && !n.stroke.token && n.stroke.width > 0) {
    const nearest = ts.nearestColor(n.stroke.color, ["border."]);
    if (nearest)
      push({
        rule: "off-token-color",
        category: "tokens",
        severity: "warning",
        message: `Raw stroke colour ${n.stroke.color} is not a border token.`,
        replaceWith: nearest.token.path,
        fix: { kind: "stroke-token", token: nearest.token.path, label: `Use ${nearest.token.path}` },
      });
  }

  // --- radius ----------------------------------------------------------------
  if (n.radius && (n.type === "frame" || n.type === "rect" || n.type === "image")) {
    const r = n.radius;
    const values = [r.tl, r.tr, r.br, r.bl];
    const elliptical = values.some((c) => Math.abs(c.rx - c.ry) > 0.01);
    if (elliptical)
      push({ rule: "elliptical-radius", category: "tokens", severity: "info", message: "Elliptical corners (radius X ≠ Y) are not part of the radius scale." });
    else if (r.token) {
      const v = ts.dimension(r.token);
      const drift = v !== undefined && values.some((c) => c.rx !== 0 && c.rx !== v);
      if (drift)
        push({ rule: "token-drift", category: "tokens", severity: "warning", message: `Radius bound to ${r.token} (${v}px) but drawn differently.`, fix: { kind: "radius-token", token: r.token, label: "Re-apply token" } });
    } else {
      const scale = ts.ofType("dimension", "radius.").map((t) => px(t.value));
      const off = values.map((c) => c.rx).filter((v) => v > 0 && !scale.includes(v) && v < Math.min(n.w, n.h) / 2);
      if (off.length) {
        const nearest = ts.nearestDimension(off[0], "radius.");
        push({
          rule: "off-scale-radius",
          category: "tokens",
          severity: "warning",
          message: `Corner radius ${off[0]}px is off the radius scale.`,
          replaceWith: nearest?.token.path,
          fix: nearest ? { kind: "radius-token", token: nearest.token.path, label: `Use ${nearest.token.path} (${px(nearest.token.value)}px)` } : undefined,
        });
      }
    }
  }

  // --- text ------------------------------------------------------------------
  if (isText) {
    const t = (n as TextNode).text;
    const arabic = hasArabic(t.content);
    const dir = frameDir(doc, n);
    const style = t.typeToken ? ts.typography(t.typeToken) : undefined;
    const matchesToken = style && style.fontSize === t.fontSize && style.fontWeight === t.fontWeight;
    if (!t.typeToken || !matchesToken) {
      const nearest = ts.nearestTypography(t.fontSize, t.fontWeight);
      push({
        rule: "off-scale-type",
        category: "tokens",
        severity: "warning",
        message: `${t.fontSize}px/${t.fontWeight} text is not a type style.`,
        replaceWith: nearest?.token.path,
        fix: nearest ? { kind: "type-token", token: nearest.token.path, label: `Use ${nearest.token.path}` } : undefined,
      });
    }
    if (t.fontSize < 12) push({ rule: "min-font-size", category: "accessibility", severity: "warning", message: `${t.fontSize}px is below the 12px minimum for legible UI text.`, wcag: "1.4.4 Resize Text" });

    if (n.fill) {
      const bg = effectiveBackground(doc, n.id);
      const fg = flatten(n.fill.color, bg.color);
      const ratio = contrastRatio(fg, bg.color);
      const large = isLargeText(t.fontSize, t.fontWeight);
      const need = large ? 3 : 4.5;
      if (ratio < need) {
        // Passing text tokens, closest in colour first, so a grey caption becomes text.secondary, not text.primary.
        const candidates = ts
          .ofType("color", "text.")
          .map((t) => ({ p: t.path, r: contrastRatio(t.value as string, bg.color), d: ts.nearestColor(n.fill!.color, [t.path])!.deltaE }))
          .filter((c) => c.r >= need)
          .sort((a, b) => a.d - b.d);
        push({
          rule: "contrast",
          category: "accessibility",
          severity: "error",
          message: `Text contrast ${ratio.toFixed(2)}:1 on ${bg.token ?? bg.color} (${bg.from}) fails ${large ? "3:1 (large text)" : "4.5:1"} — ${wcagLevel(ratio, large)}.${candidates.length ? "" : ` No text token reaches ${need}:1 on this background: a palette gap for the DS backlog.`}`,
          wcag: "1.4.3 Contrast (Minimum)",
          replaceWith: candidates[0]?.p,
          fix: candidates[0] ? { kind: "fill-token", token: candidates[0].p, label: `Use ${candidates[0].p} (${candidates[0].r.toFixed(1)}:1)` } : undefined,
        });
      }
    }

    // overflow / truncation
    const measured = measureText({ ...t, maxLines: undefined }, t.autoSize === "width" ? null : n.w);
    if (t.autoSize === "fixed" && measured.h > n.h + 1)
      push({ rule: "text-overflow", category: "content", severity: "warning", message: "Text is taller than its box and will be clipped.", fix: { kind: "auto-height", label: "Switch to auto height" } });
    if (t.maxLines) {
      const full = measureText({ ...t, maxLines: undefined }, n.w);
      if (full.h > t.maxLines * (t.lineHeight || t.fontSize * 1.3) + 1)
        push({ rule: "truncated", category: "content", severity: arabic ? "warning" : "info", message: `Copy is truncated to ${t.maxLines} line${t.maxLines > 1 ? "s" : ""}${arabic ? " — Arabic usually runs ~25% longer; shorten the copy or allow wrapping" : ""}.` });
    }
    // Laid out narrower than one of its words (a price squeezed in a row), the word itself breaks.
    // Only text that doesn't fit on one line can; layout rounds sizes up, so 0.5px is noise.
    if (t.autoSize !== "width" && measureText(t, null).w > n.w + 0.5) {
      const widest = widestWord(t);
      if (widest && widest.w > n.w + 0.5) {
        const oneLine = t.maxLines === 1;
        push({
          rule: "squeezed-text",
          category: "content",
          severity: oneLine ? "warning" : "error",
          message: `"${widest.word.slice(0, 40)}" needs ${Math.ceil(widest.w)}px on one line but its text is laid out ${Math.round(n.w)}px wide, so the word ${oneLine ? "is cut off" : "breaks mid-word"}. Give it room: fewer parts beside it, a shorter word, or a line of its own.`,
        });
      }
    }

    // RTL
    if (arabic && t.direction === "ltr")
      push({ rule: "rtl-direction", category: "rtl", severity: "error", message: "Arabic text is set to LTR; punctuation and numbers will be misordered.", fix: { kind: "text-dir", dir: "rtl", label: "Set RTL" } });
    if (dir === "rtl" && t.direction === "ltr" && !arabic)
      push({ rule: "rtl-direction", category: "rtl", severity: "warning", message: "LTR text inside an RTL frame; align/start will point the wrong way.", fix: { kind: "text-dir", dir: "rtl", label: "Set RTL" } });
    if (arabic && t.letterSpacing !== 0)
      push({ rule: "arabic-letter-spacing", category: "rtl", severity: "error", message: `Letter spacing ${t.letterSpacing}px breaks Arabic cursive joining.`, fix: { kind: "letter-spacing-0", label: "Set tracking to 0" } });
    if (arabic && t.fontFamily !== arabicFace(ts))
      push({ rule: "arabic-font", category: "rtl", severity: "info", message: `${t.fontFamily} has no Arabic glyphs; it falls back to ${arabicFace(ts)} with Latin metrics.`, fix: { kind: "font-arabic", label: "Use Arabic face" } });
    if (arabic && /\bAED\b|\$|USD/.test(t.content))
      push({ rule: "rtl-currency", category: "rtl", severity: "info", message: "Latin currency code in Arabic copy. Use «د.إ» after the amount (e.g. ٢٥ د.إ or 25 د.إ)." });
  }

  // --- icons -----------------------------------------------------------------
  if (isIcon) {
    const ic = n as SceneNode & { icon: string; mirrored: boolean };
    const dir = frameDir(doc, n);
    if (isDirectional(ic.icon) && dir === "rtl" && !ic.mirrored)
      push({ rule: "rtl-icon-mirror", category: "rtl", severity: "warning", message: `Directional icon "${ic.icon}" is not mirrored in an RTL layout.`, fix: { kind: "mirror-icon", mirrored: true, label: "Mirror icon" } });
    if (ic.mirrored && dir === "ltr")
      push({ rule: "rtl-icon-mirror", category: "rtl", severity: "warning", message: `"${ic.icon}" is mirrored in an LTR layout.`, fix: { kind: "mirror-icon", mirrored: false, label: "Un-mirror" } });
    if (n.fill) {
      const bg = effectiveBackground(doc, n.id);
      const ratio = contrastRatio(flatten(n.fill.color, bg.color), bg.color);
      if (ratio < 3)
        push({ rule: "non-text-contrast", category: "accessibility", severity: "warning", message: `Icon contrast ${ratio.toFixed(2)}:1 is below 3:1.`, wcag: "1.4.11 Non-text Contrast" });
    }
  }

  // --- targets -----------------------------------------------------------------
  if (n.meta.interactive) {
    // Desktop apps are used with a pointer: WCAG's 24px minimum, not the system's touch size.
    const min = platformOfNode(doc, n.id) === "app" ? 24 : (ts.dimension("size.touch-min") ?? 44);
    const tw = Math.max(n.w, n.meta.hitArea ?? 0);
    const th = Math.max(n.h, n.meta.hitArea ?? 0);
    if (tw < 24 || th < 24)
      push({ rule: "touch-target", category: "accessibility", severity: "error", message: `Interactive target ${Math.round(tw)}×${Math.round(th)} is below 24×24.`, wcag: "2.5.8 Target Size (Minimum)", fix: { kind: "min-size", size: min, label: `Grow to ${min}px` } });
    else if (tw < min || th < min)
      push({ rule: "touch-target", category: "accessibility", severity: "warning", message: `Interactive target ${Math.round(tw)}×${Math.round(th)} is below the system's ${min}px (size.touch-min).`, wcag: "2.5.8 Target Size (Minimum)", fix: { kind: "min-size", size: min, label: `Grow to ${min}px` } });
  }
  return out;
}

export function auditSubtree(doc: Doc, rootIds: string[]): Finding[] {
  const out: Finding[] = [];
  for (const rid of rootIds) {
    if (!doc.nodes[rid]) continue;
    for (const id of [rid, ...descendants(doc, rid)]) {
      const n = doc.nodes[id];
      out.push(...auditNode(doc, n));
      for (const f of n.meta.flags ?? []) {
        if (BUILD_RULES.has(f.rule)) out.push({ id: fid(), nodeId: id, nodeName: n.name, rule: f.rule, category: "system", severity: f.severity, message: f.message });
      }
    }
  }
  const rank = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** Run the audit and store results as node flags (not recorded in undo history). */
export function lintNodes(rootIds: string[]): Finding[] {
  const doc = studio().doc;
  const findings = auditSubtree(doc, rootIds);
  const byNode = new Map<string, Flag[]>();
  for (const f of findings) {
    if (f.category === "system") continue;
    if (f.severity === "info") continue;
    const list = byNode.get(f.nodeId) ?? [];
    list.push({ rule: f.rule, severity: f.severity, message: f.message });
    byNode.set(f.nodeId, list);
  }
  studio().mutate(
    (d) => {
      for (const rid of rootIds) {
        if (!d.nodes[rid]) continue;
        for (const id of [rid, ...descendants(d, rid)]) {
          const n = d.nodes[id];
          const kept = (n.meta.flags ?? []).filter((f) => BUILD_RULES.has(f.rule));
          const next = [...kept, ...(byNode.get(id) ?? [])];
          if (next.length || n.meta.flags?.length) n.meta.flags = next.length ? next : undefined;
        }
      }
    },
    { history: false },
  );
  return findings;
}

export function applyFix(f: Finding) {
  if (!f.fix) return;
  const fix = f.fix;
  studio().mutate((d) => {
    const n = d.nodes[f.nodeId];
    if (!n) return;
    const ts = tokensForNode(d, n.id);
    switch (fix.kind) {
      case "fill-token": {
        const p = ts.paint(fix.token);
        if (p) n.fill = { color: p.color, token: fix.token, ...(p.gradient ? { gradient: p.gradient } : {}) };
        break;
      }
      case "stroke-token":
        if (n.stroke) n.stroke = { ...n.stroke, color: ts.color(fix.token) ?? n.stroke.color, token: fix.token };
        break;
      case "stroke-width-token":
        if (n.stroke) n.stroke.width = ts.dimension(fix.token) ?? n.stroke.width;
        break;
      case "shadow-token": {
        const layers = ts.shadowLayers(fix.token) ?? [];
        n.shadowToken = fix.token;
        n.effects = layers.length ? layers : undefined;
        break;
      }
      case "radius-token": {
        const v = ts.dimension(fix.token) ?? 0;
        if (n.radius) {
          // Re-applying a corner-masked token (e.g. a sheet's top corners) keeps square corners square.
          const corners = ["tl", "tr", "br", "bl"] as const;
          const masked = n.radius.token === fix.token && corners.some((c) => n.radius![c].rx === 0) && corners.some((c) => n.radius![c].rx > 0);
          for (const c of corners) if (!masked || n.radius[c].rx > 0) n.radius[c] = { rx: v, ry: v };
          n.radius.linked = !masked;
          n.radius.circular = true;
          n.radius.token = fix.token;
        }
        break;
      }
      case "type-token": {
        if (n.type !== "text") break;
        const s = ts.typography(fix.token)!;
        const arabic = hasArabic(n.text.content);
        Object.assign(n.text, s, { typeToken: fix.token });
        if (arabic) {
          n.text.fontFamily = arabicFace(ts);
          n.text.letterSpacing = 0;
        }
        fitText(n);
        break;
      }
      case "text-dir":
        if (n.type === "text") n.text.direction = fix.dir;
        break;
      case "mirror-icon":
        if (n.type === "icon") n.mirrored = fix.mirrored;
        break;
      case "letter-spacing-0":
        if (n.type === "text") n.text.letterSpacing = 0;
        break;
      case "font-arabic":
        if (n.type === "text") {
          n.text.fontFamily = arabicFace(ts);
          fitText(n);
        }
        break;
      case "min-size": {
        // Auto layout owns the geometry: a minimum size grows the target and reflows around it.
        if (inFlow(d, n) || hasAutoLayout(n)) {
          n.minW = Math.max(n.minW ?? 0, fix.size);
          n.minH = Math.max(n.minH ?? 0, fix.size);
          break;
        }
        const w = Math.max(n.w, fix.size);
        const h = Math.max(n.h, fix.size);
        const dx = (w - n.w) / 2;
        const dy = (h - n.h) / 2;
        n.x -= dx;
        n.y -= dy;
        n.w = w;
        n.h = h;
        // Keep contents centred in the larger target.
        for (const c of n.children) {
          d.nodes[c].x += dx;
          d.nodes[c].y += dy;
        }
        break;
      }
      case "auto-height":
        if (n.type === "text") {
          n.text.autoSize = "height";
          fitText(n);
        }
        break;
    }
  });
}
