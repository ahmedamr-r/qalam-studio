import { describe, expect, it } from "vitest";
import { isPartial, parsePartial, partialKey } from "./partial-json";
import { SAMPLE_GENERATE } from "./fixtures";

/** Every closed object or array in `got` must equal the original at the same place. */
function checkClosed(got: unknown, want: unknown, path = "$"): void {
  if (typeof got !== "object" || got === null) return;
  if (!isPartial(got)) {
    expect(got, path).toEqual(want);
    return;
  }
  const w = want as Record<string, unknown>;
  for (const [k, v] of Object.entries(got)) checkClosed(v, w[k], `${path}.${k}`);
}

describe("parsePartial", () => {
  it("reads every prefix of a real generate response without throwing, and closed parts are final", () => {
    const full = JSON.stringify(SAMPLE_GENERATE);
    for (let n = 0; n <= full.length; n += 7) {
      const got = parsePartial(full.slice(0, n));
      if (n > 0) checkClosed(got, SAMPLE_GENERATE);
    }
    expect(parsePartial(full)).toEqual(SAMPLE_GENERATE);
    expect(isPartial(parsePartial(full))).toBe(false);
  });

  it("also handles pretty-printed JSON at every character", () => {
    const want = { a: [1, { b: "x y" }, [true, null]], c: { d: -2.5e3 } };
    const full = JSON.stringify(want, null, 2);
    for (let n = 1; n <= full.length; n++) checkClosed(parsePartial(full.slice(0, n)), want);
  });

  it("keeps a string cut off mid-way and names its key", () => {
    const got = parsePartial('{"name":"Order trac') as Record<string, unknown>;
    expect(got.name).toBe("Order trac");
    expect(isPartial(got)).toBe(true);
    expect(partialKey(got)).toBe("name");
  });

  it("leaves out values that can't be read yet", () => {
    expect(parsePartial('{"a":1,"b"')).toEqual({ a: 1 });
    expect(parsePartial('{"a":1,"b":')).toEqual({ a: 1 });
    expect(parsePartial('{"a":12')).toEqual({});
    expect(parsePartial('{"a":tr')).toEqual({});
    expect(parsePartial('{"a":[1,2')).toEqual({ a: [1] });
    expect(partialKey(parsePartial('{"a":12'))).toBeUndefined();
  });

  it("decodes escapes, including one split at the end", () => {
    expect((parsePartial('{"q":"say \\"hi\\" \\u0645\\n"}') as { q: string }).q).toBe('say "hi" م\n');
    expect((parsePartial('{"q":"a\\') as { q: string }).q).toBe("a");
    expect((parsePartial('{"q":"a\\u06') as { q: string }).q).toBe("a");
  });

  it("keeps Arabic text", () => {
    expect(parsePartial('{"t":"مرحبا بك"}')).toEqual({ t: "مرحبا بك" });
  });

  it("skips prose before the JSON and returns nothing without any", () => {
    expect(parsePartial('Here you go:\n```json\n{"a":1}')).toEqual({ a: 1 });
    expect(parsePartial("thinking…")).toBeUndefined();
  });

  it("marks nested unclosed containers only", () => {
    const got = parsePartial('{"body":[{"component":"Card","props":{"title":"Hi"},"children":[{"component":"Text"') as {
      body: { props: object; children: object[] }[];
    };
    expect(isPartial(got)).toBe(true);
    expect(isPartial(got.body)).toBe(true);
    expect(isPartial(got.body[0])).toBe(true);
    expect(isPartial(got.body[0].props)).toBe(false);
    expect(isPartial(got.body[0].children[0])).toBe(true);
  });

  it("drops its marks when cloned or serialized", () => {
    const got = parsePartial('{"a":{"b":1,') as object;
    expect(isPartial(structuredClone(got))).toBe(false);
    expect(JSON.stringify(got)).toBe('{"a":{"b":1}}');
  });
});
