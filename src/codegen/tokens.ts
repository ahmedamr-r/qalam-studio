import type { TypeStyle } from "@/design-system/resolve";
import { num } from "./names";

/**
 * Design tokens in generated code: colours, spacing, radii and shadows become CSS variables, type
 * styles become classes. A token's value is what the screens' nodes resolved it to (they store
 * both), so compiling needs no design system; the first use defines it, and a node whose value
 * differs (a screen reskinned by hand) keeps its literal value rather than drawing wrong.
 */

const TYPE_KEYS = ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing"] as const satisfies readonly (keyof TypeStyle)[];

export const varName = (path: string) => `--${path.replace(/[^A-Za-z0-9-]+/g, "-")}`;
export const typeClass = (path: string) => path.replace(/[^A-Za-z0-9-]+/g, "-");

/** A family for CSS, with a generic fallback. */
export const fontFamilyCSS = (family: string) => `'${family.replace(/['"\\]/g, "")}', sans-serif`;

export class TokenTable {
  private vars = new Map<string, string>();
  private types = new Map<string, TypeStyle>();

  /** `typography`: the canonical type styles (the screens' design system); without it the first use defines each. */
  constructor(private readonly typography?: (path: string) => TypeStyle | undefined) {}

  /** `var(--token)` when `path` names `value`, the literal otherwise. */
  value(path: string | undefined, value: string): string {
    if (!path) return value;
    const name = varName(path);
    const cur = this.vars.get(name);
    if (cur === undefined) this.vars.set(name, value);
    else if (cur !== value) return value;
    return `var(${name})`;
  }

  /** A length: a number of px, or the token's variable. */
  px(path: string | undefined, v: number): string | number {
    if (!path) return v;
    const out = this.value(path, `${num(v)}px`);
    return out.startsWith("var(") ? out : v;
  }

  /** The class for a type token and what a text's own style changes from it. */
  type(path: string, actual: TypeStyle): { className: string; overrides: Partial<TypeStyle> } {
    let t = this.types.get(path);
    if (!t) {
      const canonical = this.typography?.(path);
      t = canonical ? { ...canonical } : { ...actual };
      this.types.set(path, t);
    }
    const overrides: Partial<TypeStyle> = {};
    for (const k of TYPE_KEYS) if (t[k] !== actual[k]) (overrides as Record<string, unknown>)[k] = actual[k];
    return { className: typeClass(path), overrides };
  }

  get empty() {
    return !this.vars.size && !this.types.size;
  }

  /** The stylesheet: Yoga's flex defaults for everything in a screen, then the tokens. */
  css(): string {
    const lines = [
      "/* Auto layout's defaults: items don't shrink below their size unless told to, and every layer positions its absolute children. */",
      ".q-screen, .q-screen * { box-sizing: border-box; position: relative; flex-shrink: 0; min-width: 0; min-height: 0; }",
      ".q-screen p { margin: 0; }",
    ];
    if (this.vars.size) {
      lines.push(".q-screen {");
      for (const [name, value] of [...this.vars].sort(([a], [b]) => a.localeCompare(b))) lines.push(`  ${name}: ${value};`);
      lines.push("}");
    }
    for (const [path, t] of [...this.types].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(
        `.q-screen .${typeClass(path)} { font-family: ${fontFamilyCSS(t.fontFamily)}; font-size: ${num(t.fontSize)}px; font-weight: ${t.fontWeight}; line-height: ${num(t.lineHeight)}px; letter-spacing: ${num(t.letterSpacing)}px; }`,
      );
    }
    return lines.join("\n");
  }
}
