import * as React from "react";
import * as JSXRuntime from "react/jsx-runtime";
import * as Motion from "motion/react";
import { transform } from "sucrase";
import { lucideShape } from "@/design-system/icons";

/**
 * Runs a compiled prototype in the studio: the exported TSX itself, transpiled in the browser
 * (sucrase) and evaluated against the studio's own React and Motion, so what plays here is exactly
 * what Copy / Download hand over. Nothing animates on the canvas.
 */

const kebabToCamel = (k: string) => k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

type IconProps = React.SVGProps<SVGSVGElement> & { size?: number | string; color?: string; absoluteStrokeWidth?: boolean };

/**
 * lucide-react, drawn from the same Lucide data the canvas uses (the `lucide` package, same
 * version), so the prototype needs none of lucide-react's 1,600 modules. Same API: `size`,
 * `color`, `strokeWidth`, `absoluteStrokeWidth`, a forwarded ref.
 */
const icons = new Map<string, React.ComponentType<IconProps>>();
function lucideIcon(name: string) {
  let Icon = icons.get(name);
  if (Icon) return Icon;
  const shape = lucideShape(name.replace(/^Lucide|Icon$/g, "")) ?? [];
  const Comp = React.forwardRef<SVGSVGElement, IconProps>(function LucideIcon({ size = 24, color = "currentColor", strokeWidth = 2, absoluteStrokeWidth, className, children, ...rest }, ref) {
    const width = absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth;
    return React.createElement(
      "svg",
      {
        ref,
        xmlns: "http://www.w3.org/2000/svg",
        width: size,
        height: size,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: color,
        strokeWidth: width,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": true,
        className: ["lucide", className].filter(Boolean).join(" "),
        ...rest,
      },
      ...shape.map(([tag, attrs], i) => React.createElement(tag, { key: i, ...Object.fromEntries(Object.entries(attrs).map(([k, v]) => [kebabToCamel(k), v])) })),
      children,
    );
  });
  Comp.displayName = name;
  Icon = Comp as unknown as React.ComponentType<IconProps>;
  icons.set(name, Icon);
  return Icon;
}

const lucideReact = new Proxy({} as Record<string, unknown>, {
  get: (_, name) => (typeof name === "string" && name !== "then" && name !== "__esModule" ? lucideIcon(name) : undefined),
});

const MODULES: Record<string, unknown> = {
  react: React,
  "react/jsx-runtime": JSXRuntime,
  "motion/react": Motion,
  "lucide-react": lucideReact,
};

/** TSX → CommonJS. Throws with the line when the code doesn't parse. */
export function transpile(tsx: string): string {
  return transform(tsx, { transforms: ["typescript", "jsx", "imports"], jsxRuntime: "automatic", production: true }).code;
}

/** Evaluate a transpiled module against the studio's packages; returns its exports. */
export function evaluate(js: string): Record<string, unknown> {
  const module = { exports: {} as Record<string, unknown> };
  const require = (id: string) => {
    if (!(id in MODULES)) throw new Error(`The prototype imports "${id}", which the preview doesn't provide.`);
    return MODULES[id];
  };
  // The code is the compiler's own output for this document (codegen/compile.ts), never fetched.
  new Function("require", "module", "exports", js)(require, module, module.exports);
  return module.exports;
}

/** What a compiled prototype's <Prototype /> takes (`from` and `onChange` only with routes). */
export interface PlayerProps {
  start?: string;
  from?: { state: unknown; y?: number };
  onChange?: (s: unknown) => void;
}

/** The default-exported <Prototype /> of compiled code. */
export function loadPrototype(tsx: string): React.ComponentType<PlayerProps> {
  return loadPrototypeModule(tsx).Prototype;
}

/** Compiled code's <Prototype />, and its route machine (initial, step, TAPS) when it has routes. */
export function loadPrototypeModule(tsx: string): { Prototype: React.ComponentType<PlayerProps>; exports: Record<string, unknown> } {
  const exports = evaluate(transpile(tsx));
  const Prototype = exports.default;
  if (typeof Prototype !== "function") throw new Error("The compiled code has no default export.");
  return { Prototype: Prototype as React.ComponentType<PlayerProps>, exports };
}
