import { describe, expect, it } from "vitest";
import { SAMPLE_DS_FOUNDATIONS } from "@/ai/fixtures-ds";
import { designSystemFromExtraction } from "./fromExtraction";

describe("shared contrast fixes", () => {
  // Pinned before the contrast code moved out of fromExtraction.ts: extraction must not change.
  it("leave extraction's output exactly as it was", () => {
    const ds = designSystemFromExtraction({ foundations: SAMPLE_DS_FOUNDATIONS });
    expect({ tree: ds.tree, notes: ds.notes, fonts: ds.fonts }).toMatchSnapshot();
  });
});
