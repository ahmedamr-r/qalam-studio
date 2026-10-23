/**
 * Best-effort parse of JSON that is still being written, so the studio can build what the model
 * has written so far. Anything before the first `{` is skipped (prose, a code fence).
 *
 * Objects and arrays whose closing bracket hasn't arrived yet are marked (see `isPartial`); when
 * the last value in one was cut off mid-string, `partialKey` names it. Values that can't be read
 * yet are left out: a key without its value, half a number, `tru`. A closed object or array is
 * exactly what the finished JSON will hold.
 *
 * The marks are non-enumerable symbols: JSON.stringify and structuredClone drop them.
 */

const PARTIAL = Symbol("partial");
const LAST = Symbol("partialKey");

type Obj = Record<string, unknown>;

/** Not closed yet: more keys or items (or the rest of the last one) may follow. */
export function isPartial(v: unknown): boolean {
  return typeof v === "object" && v !== null && (v as Record<symbol, unknown>)[PARTIAL] === true;
}

/** The key (or index) of a string cut off mid-way at the end of an unclosed object or array. */
export function partialKey(v: unknown): string | number | undefined {
  return typeof v === "object" && v !== null ? ((v as Record<symbol, unknown>)[LAST] as string | number | undefined) : undefined;
}

const mark = (o: object, key?: string | number) => {
  Object.defineProperty(o, PARTIAL, { value: true, enumerable: false });
  if (key !== undefined) Object.defineProperty(o, LAST, { value: key, enumerable: false });
};

interface Read {
  v: unknown;
  /** The value ended before the text did. */
  done: boolean;
}

export function parsePartial(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  let i = start;
  const n = text.length;

  const ws = () => {
    while (i < n && (text[i] === " " || text[i] === "\n" || text[i] === "\r" || text[i] === "\t")) i++;
  };

  function str(): Read {
    i++; // opening quote
    let out = "";
    while (i < n) {
      const c = text[i];
      if (c === '"') {
        i++;
        return { v: out, done: true };
      }
      if (c === "\\") {
        const e = text[i + 1];
        if (e === undefined) break;
        if (e === "u") {
          const hex = text.slice(i + 2, i + 6);
          if (hex.length < 4) break;
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
        out += e === "n" ? "\n" : e === "t" ? "\t" : e === "r" ? "\r" : e === "b" ? "\b" : e === "f" ? "\f" : e;
        i += 2;
        continue;
      }
      out += c;
      i++;
    }
    i = n;
    return { v: out, done: false };
  }

  function num(): Read | undefined {
    const from = i;
    while (i < n && /[-+0-9.eE]/.test(text[i])) i++;
    // A number running to the end of the text may still have digits to come.
    if (i >= n) return undefined;
    const v = Number(text.slice(from, i));
    if (Number.isNaN(v)) throw new SyntaxError(`Bad number at ${from}`);
    return { v, done: true };
  }

  function literal(): Read | undefined {
    for (const [word, v] of [["true", true], ["false", false], ["null", null]] as const) {
      const rest = text.slice(i, i + word.length);
      if (rest === word) {
        i += word.length;
        return { v, done: true };
      }
      if (word.startsWith(rest) && i + rest.length >= n) {
        i = n;
        return undefined;
      }
    }
    throw new SyntaxError(`Unexpected "${text[i]}" at ${i}`);
  }

  function value(): Read | undefined {
    ws();
    if (i >= n) return undefined;
    const c = text[i];
    if (c === "{") return obj();
    if (c === "[") return arr();
    if (c === '"') return str();
    if (c === "-" || (c >= "0" && c <= "9")) return num();
    return literal();
  }

  function obj(): Read {
    i++;
    const o: Obj = {};
    for (;;) {
      ws();
      if (i >= n) break;
      const c = text[i];
      if (c === "}") {
        i++;
        return { v: o, done: true };
      }
      if (c === ",") {
        i++;
        continue;
      }
      if (c !== '"') throw new SyntaxError(`Expected a key at ${i}`);
      const key = str();
      if (!key.done) break;
      ws();
      if (i >= n) break;
      if (text[i] !== ":") throw new SyntaxError(`Expected ":" at ${i}`);
      i++;
      const val = value();
      if (!val) break;
      o[key.v as string] = val.v;
      if (!val.done) {
        mark(o, typeof val.v === "string" ? (key.v as string) : undefined);
        return { v: o, done: false };
      }
    }
    mark(o);
    return { v: o, done: false };
  }

  function arr(): Read {
    i++;
    const a: unknown[] = [];
    for (;;) {
      ws();
      if (i >= n) break;
      const c = text[i];
      if (c === "]") {
        i++;
        return { v: a, done: true };
      }
      if (c === ",") {
        i++;
        continue;
      }
      const val = value();
      if (!val) break;
      a.push(val.v);
      if (!val.done) {
        mark(a, typeof val.v === "string" ? a.length - 1 : undefined);
        return { v: a, done: false };
      }
    }
    mark(a);
    return { v: a, done: false };
  }

  try {
    return value()?.v;
  } catch {
    return undefined;
  }
}
