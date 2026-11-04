import { describe, expect, it } from "vitest";

const { crawling } = (await import("../bin/fetch-electron.mjs" as string)) as { crawling: (samples: { at: number; bytes: number }[], now: number, window?: number, atLeast?: number) => boolean };

describe("the launcher's download", () => {
  const at = (s: number, bytes: number) => ({ at: s * 1000, bytes });

  it("gives a connection time before saying anything", () => {
    expect(crawling([at(0, 0), at(5, 0), at(40, 0)], 40_000)).toBe(false);
  });

  it("calls it crawling when too little has arrived over the window, however much came before", () => {
    expect(crawling([at(0, 0), at(30, 0), at(60, 0)], 60_000)).toBe(true);
    expect(crawling([at(0, 0), at(10, 60_000_000), at(55, 60_500_000)], 55_000)).toBe(true);
  });

  it("leaves a slow one alone that's still getting somewhere", () => {
    expect(crawling([at(0, 0), at(30, 2_000_000), at(60, 4_000_000)], 60_000)).toBe(false);
    expect(crawling([at(0, 0), at(10, 500_000), at(55, 1_600_000)], 55_000)).toBe(false);
  });
});
