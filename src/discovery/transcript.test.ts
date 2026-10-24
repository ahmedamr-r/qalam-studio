import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCaptions } from "./captions";
import { findQuote } from "./quotes";
import { chunkText, type SourceQuote } from "./sources";
import type { RawTranscript } from "./stt/types";
import { buildTranscript, clock, finishExtracted, finishInterviewQuotes, scriptRuns, speakerNote, timeAt, trimTranscript, turnAt, type Built } from "./transcript";

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, "__fixtures__", name), "utf8");

const raw = (segments: RawTranscript["segments"], names?: Record<string, string>): RawTranscript => ({ provider: "local", model: "test", durationSec: 0, languages: [], segments, ...(names ? { names } : {}) });

/** A quote the way extract keeps it: found in the text, as the model wrote it. */
function quoteOf(b: Built, words: string): SourceQuote {
  const m = findQuote(b.text, words)!;
  return { id: words.slice(0, 8), text: m.words, span: m.span, ...(m.parts.length > 1 ? { parts: m.parts } : {}), kind: "pain", addedBy: "ai", at: 0 };
}

/** The transcript with roles as the builder confirmed them. */
const confirmed = (b: Built): Built => ({ ...b, transcript: { ...b.transcript, rolesConfirmed: true } });

describe("buildTranscript", () => {
  const b = buildTranscript(raw([
    { t0: 0, t1: 3, speaker: "SPK_A", text: "  How do you‏ order? " },
    { t0: 3.5, t1: 9, speaker: "SPK_B", text: "From my\nphone, on Thursdays." },
    { t0: 9, t1: 15, speaker: "SPK_B", text: "The driver is always late." },
    { t0: 16, t1: 18, speaker: "SPK_A", text: "Why?" },
    { t0: 18.5, t1: 20, speaker: "SPK_B", text: "" },
    { t0: 19, t1: 26, speaker: "SPK_B", text: "No idea, nobody tells me." },
  ]), { at: 1 });

  it("writes one turn per paragraph, labelled S1, S2… in the order people first speak", () => {
    expect(b.text).toBe("S1: How do you order?\n\nS2: From my phone, on Thursdays. The driver is always late.\n\nS1: Why?\n\nS2: No idea, nobody tells me.");
    expect(b.transcript.speakers.map((s) => [s.id, s.label])).toEqual([
      ["SPK_A", "S1"],
      ["SPK_B", "S2"],
    ]);
    expect(b.transcript.turns.map((t) => [t.id, t.speaker, t.seg])).toEqual([
      ["t001", "SPK_A", [0, 1]],
      ["t002", "SPK_B", [1, 3]],
      ["t003", "SPK_A", [3, 4]],
      ["t004", "SPK_B", [4, 5]],
    ]);
  });

  it("keeps each segment's words at its span, never a label, and no invisible marks", () => {
    for (const s of b.segments) expect(b.text.slice(s.span[0], s.span[1])).not.toMatch(/^S\d+:|\n/);
    expect(b.text.slice(b.segments[1].span[0], b.segments[1].span[1])).toBe("From my phone, on Thursdays.");
    for (const t of b.transcript.turns) expect(b.text.slice(t.span[0] - 4, t.span[0])).toMatch(/^S\d: $/);
    expect(b.text).not.toMatch(/[​-‏]/);
  });

  it("counts who asks and who talks, and proposes the interviewer", () => {
    const [s1, s2] = b.transcript.speakers;
    expect(s1.stats).toMatchObject({ turns: 2, questions: 2, questionShare: 1, talkSec: 5 });
    expect(s2.stats).toMatchObject({ turns: 2, questions: 0, talkSec: 18.5 });
    expect(s1.role).toBe("interviewer");
    expect(s2.role).toBe("participant");
    expect(b.transcript.proposal.interviewer).toBe("SPK_A");
    expect(b.transcript.rolesConfirmed).toBe(false);
    expect(s2.clips).toEqual([
      [3.5, 15],
      [19, 26],
    ]);
  });

  it("notes the language, length and engine", () => {
    expect(b.transcript.engine).toMatchObject({ provider: "local", model: "test", local: true, at: 1, params: { spoken: "en", provider: "local" } });
    expect(b.transcript.durationSec).toBe(26);
    expect(b.transcript.languages).toEqual(["en"]);
    expect(speakerNote(b.transcript)).toBe("S1 is the interviewer; S2 is a participant");
  });

  it("chunks a long interview only between turns", () => {
    const long = buildTranscript(raw(Array.from({ length: 400 }, (_, i) => ({ t0: i * 10, t1: i * 10 + 9, speaker: i % 2 ? "B" : "A", text: `${i % 2 ? "Answer" : "Question"} number ${i}. ${"Some words said here. ".repeat(6)}` }))));
    const chunks = chunkText(long.text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks.slice(0, -1)) expect(long.text.slice(c.end - 2, c.end)).toBe("\n\n");
  });

  it("builds from a caption file with the names it gives", () => {
    const zoom = buildTranscript(parseCaptions(fixture("interview-zoom.vtt")));
    expect(zoom.transcript.speakers.map((s) => [s.label, s.name, s.role])).toEqual([
      ["S1", "Lina Haddad", "interviewer"],
      ["S2", "Omar Khalil", "participant"],
    ]);
    expect(zoom.transcript.proposal.confidence).toBe("clear");
    expect(speakerNote(zoom.transcript)).toBe("S1 (Lina Haddad) is the interviewer; S2 (Omar Khalil) is a participant");
    const ar = buildTranscript(parseCaptions(fixture("interview-teams-ar.vtt")));
    expect(ar.transcript.speakers.find((s) => s.role === "interviewer")?.name).toBe("سارة منصور");
    expect(ar.transcript.engine.params.spoken).toBe("ar");
    const lev = buildTranscript(parseCaptions(fixture("interview-levantine.srt")));
    expect(lev.transcript.speakers.find((s) => s.role === "interviewer")?.name).toBe("Interviewer");
  });
});

describe("where and when", () => {
  const b = buildTranscript(raw([
    { t0: 10, t1: 14, speaker: "A", text: "Tell me more." },
    { t0: 20, t1: 30, speaker: "B", text: "0123456789" },
  ]));

  it("times a span by where it sits in its segment", () => {
    const [seg] = b.segments.slice(1);
    // Characters 2–5 of a 10-second, 10-character segment: said from 22 s to 26 s.
    expect(timeAt(b.segments, [seg.span[0] + 2, seg.span[0] + 6])).toEqual([22, 26]);
    expect(timeAt(b.segments, b.segments[0].span)).toEqual([10, 14]);
    // From the label on: the words' start.
    expect(timeAt(b.segments, [0, b.segments[0].span[1]])).toEqual([10, 14]);
    expect(timeAt([], [0, 1])).toBeUndefined();
    expect(timeAt(b.segments, [seg.span[0], seg.span[1]], 25)).toEqual([20, 25]);
  });

  it("finds a character's turn, its label included", () => {
    const [t1, t2] = b.transcript.turns;
    expect(turnAt(b.transcript.turns, 0)?.id).toBe(t1.id);
    expect(turnAt(b.transcript.turns, t1.span[1] + 1)?.id).toBe(t2.id);
    expect(turnAt(b.transcript.turns, t2.span[0] + 3)?.id).toBe(t2.id);
  });

  it("writes times as a clock", () => {
    expect([clock(0), clock(65.9), clock(3723)]).toEqual(["0:00", "1:05", "1:02:03"]);
  });

  it("splits Latin words out of Arabic for display", () => {
    expect(scriptRuns("التطبيق Talabat Pro بطيء")).toEqual([
      { text: "التطبيق ", latin: false },
      { text: "Talabat Pro", latin: true },
      { text: " بطيء", latin: false },
    ]);
  });

  it("trims the transcript to the start of a text that was cut", () => {
    const t = trimTranscript(b, b.segments[0].span[1] + 3);
    expect(t.segments).toHaveLength(1);
    expect(t.transcript.turns).toHaveLength(1);
  });
});

describe("finishInterviewQuotes", () => {
  const b = confirmed(buildTranscript(parseCaptions(fixture("interview-zoom.vtt"))));

  it("keeps a participant's words with who said them, their turns and when", () => {
    const [q] = finishInterviewQuotes(b, [quoteOf(b, "the driver still shows up late, so I lose half my morning waiting")]);
    expect(q).toMatchObject({ speaker: "Omar Khalil", speakerId: "S2", turnIds: ["t002"] });
    expect(q.time![0]).toBeGreaterThan(13.1);
    // It ends just before the cue's full stop.
    expect(q.time![1]).toBeGreaterThan(21.7);
    expect(q.time![1]).toBeLessThanOrEqual(21.9);
    // "the driver" starts about halfway through a cue said from 13.1 s to 21.9 s.
    expect(clock(q.time![0])).toBe("0:17");
  });

  it("never keeps the interviewer's words", () => {
    expect(finishInterviewQuotes(b, [quoteOf(b, "What do you do while you wait?")])).toEqual([]);
  });

  it("cuts a label the model left on, and refuses a quote across two people's turns", () => {
    const labelled = quoteOf(b, "S2: Honestly I just sit by the door.");
    const [q] = finishInterviewQuotes(b, [labelled]);
    expect(q.text).toBe("Honestly I just sit by the door.");
    expect(b.text.slice(q.span[0], q.span[1])).toBe(q.text);
    expect(finishInterviewQuotes(b, [quoteOf(b, "It feels like the app owns my Friday. … When was the last time that happened?")])).toEqual([]);
  });

  it("keeps a quote that leaves words out across one participant's turns", () => {
    const [q] = finishInterviewQuotes(b, [quoteOf(b, "I order on Thursday night from my phone … The problem is the delivery window.")]);
    expect(q.parts).toHaveLength(2);
    expect(q.turnIds).toEqual(["t002"]);
  });

  it("follows the roles as confirmed: a participant made 'other' isn't quoted", () => {
    const other: Built = { ...b, transcript: { ...b.transcript, speakers: b.transcript.speakers.map((s) => ({ ...s, role: "other" as const })) } };
    expect(finishInterviewQuotes(other, [quoteOf(b, "Honestly I just sit by the door.")])).toEqual([]);
  });

  it("works on an Arabic interview with a re-spelled quote", () => {
    const ar = confirmed(buildTranscript(parseCaptions(fixture("interview-teams-ar.vtt"))));
    const [q] = finishInterviewQuotes(ar, [quoteOf(ar, "التوصيل بيتاخر ساعه كامله ومفيش حد بيرد علي الشكوي")]);
    expect(q.text).toBe("التوصيل بيتأخر ساعة كاملة ومفيش حد بيرد على الشكوى");
    expect(q.speaker).toBe("محمود عادل");
  });

  it("leaves other sources' quotes alone, and drops needs whose quotes all went", () => {
    const keep = quoteOf(b, "Honestly I just sit by the door.");
    const drop = quoteOf(b, "What do you do while you wait?");
    const doc: SourceQuote = { ...keep, id: "doc" };
    const got = finishExtracted(
      {
        quotes: [
          { sourceId: "iv", quote: keep },
          { sourceId: "iv", quote: drop },
          { sourceId: "pdf", quote: doc },
        ],
        needs: [
          { sourceId: "iv", need: { id: "n1", title: "Waiting", quoteIds: [keep.id, drop.id] } },
          { sourceId: "iv", need: { id: "n2", title: "Asking", quoteIds: [drop.id] } },
        ],
      },
      (id) => (id === "iv" ? b : { text: "" }),
    );
    expect(got.quotes.map((x) => x.quote.id)).toEqual([keep.id, "doc"]);
    expect(got.needs.map((n) => [n.need.id, n.need.quoteIds])).toEqual([["n1", [keep.id]]]);
  });
});
