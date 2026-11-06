import { findQuote } from "@/discovery/quotes";
import { quotePiece, type SourceRecord } from "@/discovery/sources";
import type { Topic, TopicLine } from "@/hub/topics";
import type { OrgStore } from "../../server/org/store";
import type { Persona } from "./types";

/**
 * Written into an organization with no model call, as "Try it with a sample" writes its own. For B3:
 * five problems whose evidence ranks them from loud to quiet. The loudest comes nearly all from free-tier
 * users and the quietest from the accounts that pay, which the quotes don't say and the person only
 * says if asked.
 */

const NOW = new Date(2026, 9, 20).getTime();

const FIVE: { id: string; title: string; quotes: { speaker: string; text: string }[][] }[] = [
  {
    id: "mobile-slow",
    title: "The mobile app is too slow to use on the go",
    quotes: [
      [{ speaker: "Dana", text: "the app takes forever to open on my phone" }, { speaker: "Dana", text: "I gave up checking my leave balance on mobile" }],
      [{ speaker: "Sami", text: "every screen spins for ten seconds on my phone" }, { speaker: "Sami", text: "I only use the mobile app when I absolutely must" }],
      [{ speaker: "Rita", text: "it's painfully slow on the train" }],
      [{ speaker: "Joel", text: "mobile is so slow I stopped using it" }],
      [{ speaker: "Mei", text: "the phone app freezes when I open my payslip" }],
      [{ speaker: "Tom", text: "opening the app on my phone takes longer than asking HR" }],
      [{ speaker: "Ana", text: "the mobile version is sluggish all the time" }],
      [{ speaker: "Luc", text: "it feels broken on my phone because it's so slow" }],
    ],
  },
  {
    id: "csv-export",
    title: "Exporting to CSV breaks our reports",
    quotes: [
      [{ speaker: "Priya", text: "the CSV export scrambles the date columns" }],
      [{ speaker: "Hugo", text: "I fix every export by hand before payroll" }, { speaker: "Hugo", text: "special characters in names break the CSV" }],
      [{ speaker: "Nora", text: "the export drops rows without saying so" }],
      [{ speaker: "Ivan", text: "our monthly report breaks whenever we export" }],
    ],
  },
  {
    id: "time-off",
    title: "Time-off approvals get lost",
    quotes: [
      [{ speaker: "Zoe", text: "managers never see my time-off request" }],
      [{ speaker: "Karim", text: "I chase approvals in chat because the tool doesn't remind anyone" }],
      [{ speaker: "Elsa", text: "requests sit for a week with no answer" }],
    ],
  },
  {
    id: "onboarding",
    title: "Setting up a new hire takes too many steps",
    quotes: [
      [{ speaker: "Paul", text: "adding one new hire takes me twenty minutes" }],
      [{ speaker: "Yara", text: "I enter the same details on three different screens" }],
    ],
  },
  {
    id: "sso",
    title: "No single sign-on for our company accounts",
    quotes: [
      [{ speaker: "Head of IT", text: "our security policy requires SSO for every vendor" }],
      [{ speaker: "IT director", text: "we can't renew anything without SAML single sign-on" }],
    ],
  },
];

/** The same material as a file, so the other side reads what this one has on its canvas. */
export function seedText(p: Persona): string | null {
  if (p.seed !== "five-problems") return null;
  return [
    "# Our five biggest problems, from customer calls",
    "",
    ...FIVE.flatMap((t) => {
      const quotes = t.quotes.flat();
      return [`## ${t.title}`, `${t.quotes.length} sources, ${quotes.length} quotes`, ...quotes.map((q) => `- ${q.speaker}: "${q.text}"`), ""];
    }),
  ].join("\n");
}

export async function seedOrg(store: OrgStore, p: Persona) {
  if (p.seed !== "five-problems") return;
  for (const t of FIVE) {
    const cites: string[] = [];
    for (const [i, said] of t.quotes.entries()) {
      const id = `${t.id}-${i + 1}`;
      const text = said.map((q) => `${q.speaker}: ${q.text}.`).join("\n");
      const record: SourceRecord = {
        v: 1,
        id,
        projectId: "seed",
        boards: [],
        kind: "interview",
        title: `Call with ${said[0].speaker}`,
        text,
        addedAt: NOW,
        read: [0],
        filed: said.map((_, j) => `${id}-q${j + 1}`),
        quotes: said.map((q, j) => {
          const m = findQuote(text, q.text);
          if (!m) throw new Error(`Not in its source word for word: ${q.text}`);
          return { id: `${id}-q${j + 1}`, text: q.text, span: m.span, kind: "need" as const, speaker: q.speaker, addedBy: "ai" as const, at: NOW };
        }),
        needs: [],
      } as SourceRecord;
      await store.putSource(record);
      cites.push(...record.quotes.map((q) => quotePiece(q.id)));
    }
    const line: TopicLine = { id: `${t.id}-l1`, section: "know", text: t.title, by: "ai" as TopicLine["by"], cites, from: [], at: NOW };
    const topic: Topic = { id: t.id, kind: "need", title: t.title, products: [], createdAt: NOW, updatedAt: NOW, lines: [line], history: [] };
    await store.putTopic(topic);
  }
}
