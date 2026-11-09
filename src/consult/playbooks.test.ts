import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generated, playbookFiles, skillFiles } from "../../scripts/playbooks.mts";
import { PLAYBOOK_HEADINGS, playbookFrom, unusable, wordsIn } from "./playbook-md";
import { PLAYBOOKS, PLAYBOOK_IDS, SKILLS, SKILL_IDS } from "./playbooks.gen";

describe("the consultant's playbooks", () => {
  it("are what the Markdown says: run pnpm gen:playbooks after changing one", () => {
    const now = readFileSync(new URL("./playbooks.gen.ts", import.meta.url), "utf8");
    expect(now, "src/consult/playbooks.gen.ts is out of date: run pnpm gen:playbooks").toBe(generated());
  });

  it("are the four the first version handles, each in its own layer's folder", () => {
    expect([...PLAYBOOK_IDS]).toEqual(["business", "grow", "idea", "page"]);
    expect(playbookFiles().map((f) => f.path)).toEqual(["src/consult/playbooks/business/business.md", "src/consult/playbooks/growth/grow.md", "src/consult/playbooks/idea/idea.md", "src/consult/playbooks/product/page.md"]);
  });

  it("each has its four sections, says when it fits and what it proposes, and stays short", () => {
    for (const p of PLAYBOOKS) {
      expect([...p.body.matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual([...PLAYBOOK_HEADINGS]);
      expect(p.when.length).toBeGreaterThan(0);
      expect(["diagnosis", "goals"]).toContain(p.propose);
      expect(wordsIn(p.body), p.id).toBeLessThanOrEqual(700);
    }
  });

  it("carry no figures: a playbook guides the questions, and nothing a card shows may come from it", () => {
    for (const p of PLAYBOOKS) expect(p.body, p.id).not.toMatch(/\p{Nd}/u);
  });

  it("are named by role, never by one product", () => {
    for (const p of PLAYBOOKS) expect(`${p.title} ${p.when.join(" ")} ${p.body}`, p.id).not.toMatch(/\b(basket|cart|checkout|delivery app|grocery|talabat|uber)\b/i);
  });

  it("credit what they learned from, under a license that allows it", () => {
    for (const p of PLAYBOOKS) {
      expect(p.credits.length, p.id).toBeGreaterThan(0);
      for (const c of p.credits) expect(unusable(c.license), `${p.id}: ${c.source}`).toBe(false);
    }
    expect(unusable("CC BY-NC-SA 4.0")).toBe(true);
    expect(unusable("MIT")).toBe(false);
  });

  it("keep the skills apart: what one call goes by, held to the same rules, never a playbook the consultant switches to", () => {
    expect([...SKILL_IDS]).toEqual(["screens"]);
    expect(skillFiles().map((f) => f.path)).toEqual(["src/consult/skills/screens.md"]);
    for (const s of SKILLS) {
      expect([...s.body.matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual([...PLAYBOOK_HEADINGS]);
      expect(s.propose).toBe("review");
      expect(wordsIn(s.body), s.id).toBeLessThanOrEqual(700);
      expect(s.body, s.id).not.toMatch(/\p{Nd}/u);
      expect(`${s.title} ${s.when.join(" ")} ${s.body}`, s.id).not.toMatch(/\b(basket|cart|checkout|delivery app|grocery|talabat|uber)\b/i);
      expect(s.credits.length).toBeGreaterThan(0);
      for (const c of s.credits) expect(unusable(c.license), `${s.id}: ${c.source}`).toBe(false);
    }
  });

  it("refuses a file that isn't whole", () => {
    expect(() => playbookFrom('---\nid: "x1"\n---\n\n## How to ask\n')).toThrow(/id/);
    expect(() => playbookFrom('---\nid: "page"\nlayer: "product"\ntitle: "T"\nwhen: ["w"]\npropose: "diagnosis"\n---\n\n## How to ask\n')).toThrow(/sections/);
  });
});
