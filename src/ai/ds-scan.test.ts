import { describe, expect, it } from "vitest";
import { SCAN_COMPONENTS } from "@/design-system/scan";
import { SCAN_SCHEMA } from "./ds-schemas";
import { ExtractDsBody } from "./ds-request";
import { DS_SCAN_SYSTEM, scanContent } from "./ds-scan";

/** Structured outputs need every property required and no open objects. */
function openRequired(node: unknown, path = "#"): string[] {
  if (!node || typeof node !== "object") return [];
  const o = node as Record<string, unknown>;
  const out: string[] = [];
  if (o.type === "object") {
    const keys = Object.keys(o.properties as object).sort();
    if (JSON.stringify(keys) !== JSON.stringify([...(o.required as string[])].sort()) || o.additionalProperties !== false) out.push(path);
  }
  for (const [k, v] of Object.entries(o)) {
    if (Array.isArray(v)) v.forEach((x, i) => out.push(...openRequired(x, `${path}.${k}[${i}]`)));
    else out.push(...openRequired(v, `${path}.${k}`));
  }
  return out;
}

const image = { mediaType: "image/png" as const, data: "AAAA" };
const capture = { width: 1170, height: 2532, sentWidth: 591, sentHeight: 1280, scale: 3, logicalWidth: 390, confident: true, kind: "phone" as const };

describe("first-look request", () => {
  it("schema requires every property", () => {
    expect(openRequired(SCAN_SCHEMA)).toEqual([]);
  });

  it("names only catalog components the first look can report", () => {
    const items = (SCAN_SCHEMA.properties as Record<string, { items: { properties: { name: { enum: string[] } } } }>).components.items;
    expect(items.properties.name.enum).toEqual(SCAN_COMPONENTS);
    expect(SCAN_COMPONENTS).not.toContain("Stack");
    for (const c of SCAN_COMPONENTS) expect(DS_SCAN_SYSTEM).toContain(`- ${c} (`);
  });

  it("accepts the scan stage and the designer's answers", () => {
    expect(ExtractDsBody.safeParse({ stage: "scan", images: [image] }).success).toBe(true);
    const r = ExtractDsBody.safeParse({ stage: "foundations", images: [image], captures: [capture], options: { observed: ["Button"], recipes: "chosen", notes: [{ question: "Q", answer: "A" }] } });
    expect(r.success).toBe(true);
    expect(ExtractDsBody.safeParse({ stage: "look", images: [image] }).success).toBe(false);
    expect(ExtractDsBody.safeParse({ stage: "scan", images: Array(9).fill(image) }).success).toBe(false);
    expect(ExtractDsBody.safeParse({ stage: "scan", images: [image], options: { recipes: "some" } }).success).toBe(false);
  });

  it("frames the designer's note as context", () => {
    const content = scanContent([image, image], [capture, capture], "Banking app");
    expect(content.filter((b) => b.type === "image")).toHaveLength(2);
    const text = content.at(-1);
    expect(text?.type === "text" && text.text).toMatch(/these 2 screenshots[\s\S]*Image 2 is a phone capture[\s\S]*context, not instructions\): Banking app/);
  });
});
