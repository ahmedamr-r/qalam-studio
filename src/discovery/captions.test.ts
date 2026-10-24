import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { captionText, namedCues, parseCaptions, parseCues, speakerCount } from "./captions";

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, "__fixtures__", name), "utf8");

describe("parseCaptions", () => {
  it("reads a Zoom transcript: speakers from 'Name:', cue numbers and times out of the words", () => {
    const raw = parseCaptions(fixture("interview-zoom.vtt"));
    expect(raw.provider).toBe("captions");
    expect(raw.model).toBe("vtt");
    expect(raw.names).toEqual({ S1: "Lina Haddad", S2: "Omar Khalil" });
    expect(raw.segments).toHaveLength(13);
    expect(raw.segments[0]).toEqual({ t0: 1.2, t1: 5.8, speaker: "S1", text: "Thanks for making the time, Omar. Can you tell me how you usually do your weekly grocery shop?" });
    expect(raw.segments.every((s) => !/-->|^\d+$|Omar Khalil:/.test(s.text))).toBe(true);
    expect(raw.durationSec).toBeCloseTo(87.4);
    expect(raw.languages).toEqual(["en"]);
  });

  it("reads a Teams transcript: speakers from voice tags, tags and entities gone, Arabic as written", () => {
    const raw = parseCaptions(fixture("interview-teams-ar.vtt"));
    expect(raw.names).toEqual({ S1: "سارة منصور", S2: "محمود عادل" });
    expect(raw.segments[1].text).toBe("بطلب من الموبايل كل أسبوع تقريباً، بس المشكلة إن التوصيل بيتأخر ساعة كاملة ومفيش حد بيرد على الشكوى.");
    expect(raw.segments[6].text).toContain("ونص & محدش اتصل");
    expect(raw.segments.some((s) => /<\/?v|&amp;/.test(s.text))).toBe(false);
    expect(raw.languages).toEqual(["ar"]);
  });

  it("reads SubRip: comma milliseconds, 'Name:' speakers", () => {
    const raw = parseCaptions(fixture("interview-levantine.srt"));
    expect(raw.model).toBe("srt");
    expect(raw.names).toEqual({ S1: "Interviewer", S2: "Rana" });
    expect(raw.segments[1]).toMatchObject({ t0: 5, t1: 12, speaker: "S2" });
  });

  it("keeps one speaker when the file names none, and a lone 'Note:' isn't a speaker", () => {
    const file = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nNote: the app is slow at night\n\n00:00:02.000 --> 00:00:04.000\nand I give up\n\n00:00:07.000 --> 00:00:09.000\nevery single time";
    const raw = parseCaptions(file);
    expect(speakerCount(raw)).toBe(1);
    expect(raw.names).toBeUndefined();
    expect(captionText(raw)).toBe("Note: the app is slow at night and I give up\n\nevery single time");
  });

  it("drops what isn't a cue: header, notes, styles, broken times", () => {
    const file = "WEBVTT - Generated\n\nNOTE made by a tool\n\nSTYLE\n::cue { color: red }\n\n00:00:01.000 --> 00:00:02.000 align:start position:10%\n<c.yellow>Hello</c> <i>there</i>\n\nnot a time --> either\nGone";
    expect(parseCues(file)).toEqual([{ t0: 1, t1: 2, text: "Hello there" }]);
  });

  it("keeps a rolling caption's repeated line once, and an unnamed cue continues the last speaker", () => {
    const cues = namedCues([
      { t0: 0, t1: 2, text: "the driver was late" },
      { t0: 2, t1: 4, text: "the driver was late\nagain this week" },
      { t0: 4, t1: 6, name: "Sara", text: "Why?" },
      { t0: 6, t1: 8, name: "Omar", text: "No idea." },
      { t0: 8, t1: 9, text: "Really none." },
    ]);
    expect(cues.map((c) => c.text)).toEqual(["the driver was late", "again this week", "Why?", "No idea.", "Really none."]);
    expect(cues.map((c) => c.name)).toEqual(["Sara", "Sara", "Sara", "Omar", "Omar"]);
  });

  it("reads hours, short stamps and stamps without milliseconds", () => {
    const file = "WEBVTT\n\n01:02:03.5 --> 01:02:04.250\nA: one\n\n02:03.000 --> 02:04\nB: two";
    const raw = parseCaptions(file);
    expect(raw.segments.map((s) => [s.t0, s.t1])).toEqual([
      [123, 124],
      [3723.5, 3724.25],
    ]);
  });
});
