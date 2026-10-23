/**
 * Expressions (pure): the closed JSON form a prototype's values are worked out in (proto-types.ts
 * Expr), turned into TypeScript for the compiled prototype, and typed so a sum of money never
 * meets a count. Nothing here evaluates a string: the compiled code is the only evaluator.
 */
import type { Expr, VarDef, VarType } from "@/doc/schema";

export type ExprType = "bool" | "int" | "money" | "text" | "id" | "ids" | "list" | "null" | "any";

/** How compiled code reaches what an expression reads. */
export interface CodeEnv {
  /** A route var ("qty" → "d.qty"). */
  routeVar: (name: string) => string;
  /** An app var ("basket" → "s.app.basket"). */
  appVar: (name: string) => string;
  /** The item this element belongs to (a record), when there is one. */
  it?: string;
  /** The item the open part is about. */
  ctx?: string;
  /** A collection's records, by id ("dishes" → "ITEMS.menu.dishes"). */
  items: (collection: string) => string;
}

/** What an expression reads, for typing. */
export interface TypeEnv {
  routeVars: Record<string, VarDef>;
  appVars: Record<string, VarDef>;
  /** Collection id → its records' fields and their types. */
  fields: Record<string, Record<string, ExprType>>;
  /** The collection `it` and `ctx` come from. */
  it?: string;
  ctx?: string;
}

const lit = (v: unknown) => JSON.stringify(v);
const NUMERIC = new Set<ExprType>(["int", "money", "any"]);

export function varType(t: VarType): ExprType {
  switch (t.t) {
    case "bool":
      return "bool";
    case "int":
      return "int";
    case "money":
      return "money";
    case "text":
      return "text";
    case "choice":
      return "id";
    case "set":
      return "ids";
    case "list":
      return "list";
  }
}

const isObj = (e: Expr): e is Exclude<Expr, string | number | boolean | null> => !!e && typeof e === "object";

/** An app var's name, when `v` reads one ("app.basket" → "basket"). */
export const appVarName = (v: string): string | null => (v.startsWith("app.") ? v.slice(4) : null);

/** TypeScript for an expression; `el` is the element of the count or sum it's inside. */
export function exprToTS(e: Expr, env: CodeEnv, el = "el"): string {
  if (!isObj(e)) return lit(e);
  if ("v" in e) {
    const app = appVarName(e.v);
    return app ? env.appVar(app) : env.routeVar(e.v);
  }
  if ("it" in e) return `${env.it ?? "undefined"}?.${e.it}`;
  if ("ctx" in e) return `${env.ctx ?? "undefined"}?.${e.ctx}`;
  if ("el" in e) return `${el}.${e.el}`;
  if ("money" in e) return lit(e.money);
  const sub = (x: Expr) => exprToTS(x, env, el);
  // A number that may be missing (a var not set, an item without a price) counts as 0; literals and counts never are.
  const n = (x: Expr) =>
    typeof x === "number" || (isObj(x) && "money" in x) ? sub(x) : isObj(x) && "op" in x && (x.op === "count" || x.op === "sum" || x.op === "+" || x.op === "-" || x.op === "*") ? sub(x) : `(${sub(x)} ?? 0)`;
  switch (e.op) {
    case "+":
    case "-":
    case "*":
      return `(${e.a.map(n).join(` ${e.op} `)})`;
    case "min":
    case "max":
      return `Math.${e.op}(${e.a.map(sub).join(", ")})`;
    case "and":
      return `(${e.a.map((x) => `!!(${sub(x)})`).join(" && ")})`;
    case "or":
      return `(${e.a.map((x) => `!!(${sub(x)})`).join(" || ")})`;
    case "==":
      return `(${sub(e.a[0])} === ${sub(e.a[1])})`;
    case "!=":
      return `(${sub(e.a[0])} !== ${sub(e.a[1])})`;
    case "<":
    case "<=":
    case ">":
    case ">=":
      return `(${n(e.a[0])} ${e.op} ${n(e.a[1])})`;
    case "not":
      return `!(${sub(e.a[0])})`;
    case "if":
      return `(${sub(e.a[0])} ? ${sub(e.a[1])} : ${sub(e.a[2])})`;
    case "has":
      return `(${sub(e.set)} ?? []).includes(${sub(e.a)} as never)`;
    case "get":
      return `${env.items(e.of)}[String(${sub(e.id)})]?.${e.field}`;
    case "titles":
      return `([] as unknown[]).concat(${sub(e.ids)} ?? []).map((id) => ${env.items(e.of)}[String(id)]?.title).filter(Boolean).join(", ")`;
    case "join":
      return `[${e.a.map(sub).join(", ")}].filter((x) => x !== undefined && x !== null && x !== "").join(${lit(e.sep)})`;
    case "count":
    case "sum": {
      // Lists are typed by the prototype's data (a basket's lines, a collection's items).
      const from = "items" in e.of ? `Object.values(${env.items(e.of.items)})` : `(${exprToTS(e.of, env, el)} ?? [])`;
      // Nested counts get their own element name.
      const inner = `${el}_`;
      const where = e.where ? `.filter((${inner}) => ${exprToTS(e.where, env, inner)})` : "";
      if (e.op === "count") return `${from}${where}.length`;
      const value = e.value ? exprToTS(e.value, env, inner) : inner;
      return `${from}${where}.reduce((n, ${inner}) => n + (Number(${value}) || 0), 0)`;
    }
  }
}

/** An expression's type, and what's wrong with it (unknown names, money meeting a count…). */
export function typeOf(e: Expr, env: TypeEnv, el?: Record<string, ExprType>, problems: string[] = []): { type: ExprType; problems: string[] } {
  const t = (x: Expr, elf = el) => typeOf(x, env, elf, problems).type;
  const say = (m: string) => {
    problems.push(m);
    return { type: "any" as ExprType, problems };
  };
  if (e === null) return { type: "null", problems };
  if (typeof e === "string") return { type: "text", problems };
  if (typeof e === "number") return { type: Number.isInteger(e) ? "int" : "any", problems };
  if (typeof e === "boolean") return { type: "bool", problems };
  if ("v" in e) {
    const app = appVarName(e.v);
    const def = app ? env.appVars[app] : env.routeVars[e.v];
    return def ? { type: varType(def.type), problems } : say(`No value called "${e.v}"`);
  }
  if ("it" in e || "ctx" in e) {
    const from = "it" in e ? env.it : env.ctx;
    const field = "it" in e ? e.it : e.ctx;
    if (!from) return say(`"${field}" reads an item, but nothing here is about one`);
    const ty = env.fields[from]?.[field];
    return ty ? { type: ty, problems } : say(`Items in "${from}" have no "${field}"`);
  }
  if ("el" in e) {
    const ty = el?.[e.el];
    return ty ? { type: ty, problems } : say(`What's counted here has no "${e.el}"`);
  }
  if ("money" in e) return { type: "money", problems };
  switch (e.op) {
    case "+":
    case "-": {
      const ts = e.a.map((x) => t(x));
      if (ts.some((x) => !NUMERIC.has(x))) return say(`${e.op} works on numbers and money`);
      const money = ts.filter((x) => x === "money").length;
      if (money && money !== ts.filter((x) => x !== "any").length) return say(`Money ${e.op === "+" ? "plus" : "minus"} a count: give both the same kind`);
      return { type: money ? "money" : "int", problems };
    }
    case "*": {
      const ts = e.a.map((x) => t(x));
      if (ts.some((x) => !NUMERIC.has(x))) return say("× works on numbers and money");
      const money = ts.filter((x) => x === "money").length;
      if (money > 1) return say("Money times money isn't money");
      return { type: money ? "money" : "int", problems };
    }
    case "min":
    case "max": {
      const ts = e.a.map((x) => t(x));
      return { type: ts.find((x) => x !== "any") ?? "any", problems };
    }
    case "and":
    case "or":
    case "not":
      e.a.forEach((x) => t(x));
      return { type: "bool", problems };
    case "==":
    case "!=":
    case "<":
    case "<=":
    case ">":
    case ">=":
      e.a.forEach((x) => t(x));
      return { type: "bool", problems };
    case "if": {
      t(e.a[0]);
      const a = t(e.a[1]);
      const b = t(e.a[2]);
      return { type: a === b ? a : a === "null" ? b : b === "null" ? a : "any", problems };
    }
    case "has":
      t(e.set);
      t(e.a);
      return { type: "bool", problems };
    case "get": {
      t(e.id);
      const ty = env.fields[e.of]?.[e.field];
      return ty ? { type: ty, problems } : say(`Items in "${e.of}" have no "${e.field}"`);
    }
    case "titles": {
      const ty = t(e.ids);
      if (!env.fields[e.of]) return say(`No collection called "${e.of}"`);
      if (!["id", "ids", "text", "null", "any"].includes(ty)) return say(`Titles are of items: give an item or a set of them`);
      return { type: "text", problems };
    }
    case "join":
      e.a.forEach((x) => t(x));
      return { type: "text", problems };
    case "count":
    case "sum": {
      let elFields: Record<string, ExprType> | undefined;
      if ("items" in e.of) {
        elFields = env.fields[e.of.items];
        if (!elFields) return say(`No collection called "${e.of.items}"`);
      } else {
        const name = e.of.v;
        const app = appVarName(name);
        const def = app ? env.appVars[app] : env.routeVars[name];
        if (!def) return say(`No value called "${name}"`);
        if (def.type.t === "list") elFields = Object.fromEntries(Object.entries(def.type.fields).map(([k, f]) => [k, f as ExprType]));
        else if (def.type.t === "set") elFields = { id: "id" };
        else return say(`"${name}" isn't a list to ${e.op}`);
      }
      if (e.where) typeOf(e.where, env, elFields, problems);
      if (e.op === "count") return { type: "int", problems };
      const vt = e.value ? typeOf(e.value, env, elFields, problems).type : "any";
      return { type: vt === "money" ? "money" : "int", problems };
    }
  }
}
