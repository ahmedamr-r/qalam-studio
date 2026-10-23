import { beforeAll, describe, expect, it } from "vitest";
import { ensureYoga } from "@/engine/layout";
import type { Doc, RouteProto } from "@/doc/schema";
import { foodMenuDoc } from "./fixtures/food-menu";
import { lintRoute } from "./lint";

beforeAll(async () => {
  await ensureYoga();
});

/** The menu with its route changed. */
function menu(change?: (r: RouteProto) => RouteProto): { doc: Doc; screen: string } {
  const { doc, ids } = foodMenuDoc();
  if (!change) return { doc, screen: ids.menu };
  const routes = doc.proto!.routes!;
  return { doc: { ...doc, proto: { ...doc.proto!, routes: { ...routes, [ids.menu]: change(routes[ids.menu]) } } }, screen: ids.menu };
}

const issues = (m: { doc: Doc; screen: string }) => lintRoute(m.doc, m.screen);
/** The options sheet's "Add · {total}" copy. */
const totalBinding = (r: RouteProto) => (r.bindings ?? []).findIndex((b) => b.kind === "text" && b.ref.part === "options" && Object.values(b.slots).some((s) => s.fmt === "money"));

describe("checks on a route", () => {
  it("find nothing wrong with the menu its recipes built", () => {
    expect(issues(menu())).toEqual([]);
  });

  it("flag a sheet nothing closes, and a sheet nothing opens", () => {
    const shut = menu((r) => ({
      ...r,
      overlays: { ...r.overlays, options: { ...r.overlays.options, dismiss: [] } },
      rules: r.rules.filter((ru) => !("ref" in ru.when && ru.when.ref.part === "options" && ru.then.some((a) => a.do === "close" || a.do === "back"))),
    }));
    expect(issues(shut)).toContainEqual(expect.objectContaining({ severity: "error", check: "closes", at: { part: "options" } }));
    const orphan = menu((r) => ({ ...r, rules: r.rules.filter((ru) => !ru.then.some((a) => a.do === "open")) }));
    expect(issues(orphan)).toContainEqual(expect.objectContaining({ severity: "warning", check: "opens", at: { part: "options" } }));
  });

  it("flag what points at a layer that isn't there any more", () => {
    const m = menu((r) => ({ ...r, bindings: r.bindings!.map((b, i) => (i === 0 ? { ...b, ref: { ...b.ref, path: "body.9" } } : b)) }));
    expect(issues(m)).toContainEqual(expect.objectContaining({ check: "ref", at: { binding: 0 } }));
    expect(issues(m).find((x) => x.check === "ref")!.message).toContain("body.9");
  });

  it("flag a total that's written in, and a count shown as money", () => {
    const written = menu((r) => {
      const i = totalBinding(r);
      return { ...r, bindings: r.bindings!.map((b, j) => (j === i && b.kind === "text" ? { ...b, slots: Object.fromEntries(Object.entries(b.slots).map(([k, s]) => [k, { ...s, e: 1800 }])) } : b)) };
    });
    expect(issues(written)).toContainEqual(expect.objectContaining({ severity: "error", check: "written-total" }));
    const count = menu((r) => {
      const i = totalBinding(r);
      return { ...r, bindings: r.bindings!.map((b, j) => (j === i && b.kind === "text" ? { ...b, slots: Object.fromEntries(Object.entries(b.slots).map(([k, s]) => [k, { ...s, e: { v: "qty" } }])) } : b)) };
    });
    const typed = issues(count).find((x) => x.check === "type");
    expect(typed?.message).toMatch(/is a count, not an amount of money/);
  });

  it("flag a rule that sets a value to the wrong kind, or picks an item that isn't there", () => {
    const m = menu((r) => ({
      ...r,
      rules: [
        ...r.rules,
        { id: "x1", when: { on: "tap", ref: { path: "body.0" } }, then: [{ do: "set", v: "qty", e: "large" }] },
        { id: "x2", when: { on: "tap", ref: { path: "body.0" } }, then: [{ do: "set", v: "section", e: "body.9" }] },
        { id: "x3", when: { on: "tap", ref: { path: "body.0" } }, then: [{ do: "inc", v: "section", by: 1 }] },
        { id: "x4", when: { on: "tap", ref: { path: "body.0" } }, then: [{ do: "set", v: "nowhere", e: 1 }] },
      ],
    }));
    const by = (rule: string) => issues(m).filter((x) => x.at.rule === rule).map((x) => x.message);
    expect(by("x1").join()).toMatch(/"qty" to is text, not a count/);
    expect(by("x2").join()).toMatch(/no such item/);
    expect(by("x3").join()).toMatch(/isn't a number/);
    expect(by("x4").join()).toMatch(/doesn't remember/);
  });

  it("flag a row drawn for each of what isn't a list, and a line changed from outside the rows drawn for it", () => {
    const m = menu((r) => ({
      ...r,
      bindings: [...(r.bindings ?? []), { kind: "repeat", ref: { path: "body.2" }, of: "app.nowhere" }],
      rules: [...r.rules, { id: "rX", when: { on: "tap", ref: { path: "header.0" } }, then: [{ do: "change", v: "app.basket", field: "qty", by: 1 }] }],
    }));
    const found = issues(m).map((x) => x.message);
    expect(found).toContain('A row is drawn for each of "app.nowhere", which isn\'t a list.');
    expect(found).toContain('A rule changes a line of "app.basket" from a layer that isn\'t in a row drawn for each line.');
  });

  it("flag a target too small to tap", () => {
    // The rating's stars and caption are a line of small copy, not a button.
    const m = menu((r) => ({ ...r, rules: [...r.rules, { id: "x1", when: { on: "tap", ref: { path: "body.0" } }, then: [{ do: "open", part: "options" }] }] }));
    const t = issues(m).find((x) => x.check === "target");
    expect(t).toMatchObject({ severity: "warning", at: { rule: "x1" } });
    expect(t!.message).toMatch(/too small to tap \(44×44 at least\)/);
  });
});
