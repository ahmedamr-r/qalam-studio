import { describe, expect, it } from "vitest";
import { dataRows, parseRows, rowAt, rowWho, sniffDelimiter, tableOf } from "./table";
import { dateOrder, mergeReadings, movedSince, parseDate, parseNumber, readingsFromTable, withReading, withReadings } from "./readings";
import { tally, voicesByQuote } from "@/hub/people";
import { strengthOf } from "@/hub/strength";
import type { SourceRecord } from "./sources";

const TICKETS = `id,customer,created,message
1,sara@x.com,2026-10-01,"The courier never says when he'll come, I waited 2 hours"
2,omar@y.com,2026-10-02,Where is my order?
3,sara@x.com,2026-10-03,"Again, no idea when the courier comes.
I gave up waiting."
4,lina@z.com,2026-10-04,"She said ""soon"" and came at 11pm"
`;

describe("a table source", () => {
  it("is read row by row, quoted cells, doubled quotes and line breaks inside cells too", () => {
    expect(sniffDelimiter(TICKETS)).toBe(",");
    const rows = parseRows(TICKETS, ",");
    expect(rows.map((r) => r.cells.length)).toEqual([4, 4, 4, 4, 4]);
    expect(rows[3].cells[3]).toBe("Again, no idea when the courier comes.\nI gave up waiting.");
    expect(rows[4].cells[3]).toBe('She said "soon" and came at 11pm');
    expect(TICKETS.slice(rows[2].start, rows[2].end)).toBe("2,omar@y.com,2026-10-02,Where is my order?");
    expect(tableOf(TICKETS)).toEqual({ delimiter: ",", columns: ["id", "customer", "created", "message"], rows: 4, who: "customer" });
  });

  it("isn't a table when it's prose, or one column", () => {
    expect(tableOf("We talked to Sara, Omar and Lina.\nThey all waited.\nNobody knew when.")).toBeNull();
    expect(tableOf("a\nb\nc\nd")).toBeNull();
    expect(tableOf("name\tcount\nx\t1\ny\t2\n")).toEqual({ delimiter: "\t", columns: ["name", "count"], rows: 2, who: "name" });
  });

  it("finds the row a quote sits in, and who wrote it", () => {
    const s = { text: TICKETS, table: tableOf(TICKETS)! };
    const rows = dataRows(s);
    expect(dataRows(s)).toBe(rows);
    const at = TICKETS.indexOf("I gave up waiting");
    expect(rowAt(rows, at)).toBe(2);
    expect(rowWho(s, rows[2])).toBe("sara@x.com");
    expect(rowAt(rows, 3)).toBe(-1);
  });

  it("makes each row someone's voice, the same customer's rows one voice, and counts the rows a need shows up in", () => {
    const quote = (id: string, words: string) => ({ id, text: words, span: [TICKETS.indexOf(words), TICKETS.indexOf(words) + words.length] as [number, number], kind: "pain" as const, addedBy: "ai" as const, at: 1 });
    const src = { v: 1, id: "t1", projectId: "b1", kind: "text", title: "Tickets", text: TICKETS, table: tableOf(TICKETS)!, addedAt: 1, read: [0], quotes: [quote("q1", "The courier never says when he'll come"), quote("q2", "no idea when the courier comes"), quote("q3", "came at 11pm")], needs: [] } as SourceRecord;
    const voices = voicesByQuote([src], []);
    expect([...voices.values()].map((v) => [v.key, v.name, v.row])).toEqual([
      ["source:t1:who:sara@x.com", "sara@x.com", { n: 0, of: 4 }],
      ["source:t1:who:sara@x.com", "sara@x.com", { n: 2, of: 4 }],
      ["source:t1:who:lina@z.com", "lina@z.com", { n: 3, of: 4 }],
    ]);
    expect(tally([...voices.values()]).voices).toBe(2);
    const s = strengthOf({ kind: "opportunity", evidence: ["q1", "q2", "q3"].map((q) => ({ id: q, kind: "quote" as const, text: q, piece: `hub:quote:${q}`, sourceId: "t1", addedBy: "ai" as const, at: 1 })) }, { now: 2, voices });
    expect(s.rows).toEqual([{ source: "t1", shown: 3, of: 4 }]);
    expect(s.why).toBe("2 voices (1 source) · in 3 of 4 rows (75%) · newest today");
  });
});

describe("an outcome's readings", () => {
  it("parses numbers and dates as exports write them", () => {
    expect([parseNumber("1,234.5"), parseNumber("12%"), parseNumber("$40"), parseNumber("٣٫٥"), parseNumber("3,5"), parseNumber("n/a")]).toEqual([1234.5, 12, 40, 3.5, 3.5, null]);
    expect(dateOrder(["2026-01-03", "2026-02-10"])).toBe("ymd");
    expect(dateOrder(["13/01/2026", "02/02/2026"])).toBe("dmy");
    expect(dateOrder(["01/13/2026", "02/02/2026"])).toBe("mdy");
    expect(dateOrder(["01/02/2026"])).toBe("dmy");
    expect(dateOrder(["Jan 3, 2026", "Feb 10, 2026"])).toBe("ymd");
    expect(parseDate("13/01/2026", "dmy")).toBe(Date.UTC(2026, 0, 13, 12));
    expect(parseDate("31/02/2026", "dmy")).toBeNull();
  });

  it("are read from an export: the date column, and the number named like the metric", () => {
    const csv = "week,orders,reorders per customer\n2026-09-07,1200,1.2\n2026-09-14,1250,1.25\nbad,1,x\n2026-09-21,1300,1.31\n";
    const r = readingsFromTable(csv, { name: "Weekly reorders per customer", from: "weekly.csv" })!;
    expect(r).toMatchObject({ dateColumn: "week", valueColumn: "reorders per customer", order: "ymd", skipped: 1 });
    expect(r.readings.map((x) => x.value)).toEqual([1.2, 1.25, 1.31]);
    expect(r.readings[0]).toEqual({ at: Date.UTC(2026, 8, 7, 12), value: 1.2, from: "weekly.csv" });
    expect(readingsFromTable(csv)!.valueColumn).toBe("orders");
    expect(readingsFromTable("just,words\nno,dates\nat,all\n")).toBeNull();
  });

  it("move the current number, keep the first as the baseline when there's none, and replace a day's reading", () => {
    const m = { name: "Reorders", direction: "increase" as const, baseline: null, current: null, target: 1.5 };
    const a = withReadings(m, [{ at: Date.UTC(2026, 8, 7), value: 1.2 }, { at: Date.UTC(2026, 8, 14), value: 1.25 }]);
    expect(a).toMatchObject({ baseline: 1.2, current: 1.25 });
    const b = withReading(a, 1.3, Date.UTC(2026, 8, 14, 18));
    expect(b.readings!.map((r) => r.value)).toEqual([1.2, 1.3]);
    expect(b).toMatchObject({ baseline: 1.2, current: 1.3 });
    expect(mergeReadings([{ at: 1, value: NaN }])).toEqual([]);
  });

  it("say how the number moved since a day (a ship date)", () => {
    const m = withReadings({ name: "Reorders", direction: "increase", baseline: null, current: null, target: 1.5 }, [{ at: Date.UTC(2026, 8, 1), value: 1.2 }, { at: Date.UTC(2026, 9, 1), value: 1.18 }]);
    expect(movedSince(m, Date.UTC(2026, 8, 10))).toEqual({ before: 1.2, after: 1.18, change: expect.closeTo(-0.02, 6), better: false, days: 21 });
    expect(movedSince(m, Date.UTC(2026, 9, 5))).toBeNull();
    expect(movedSince(m, Date.UTC(2026, 7, 1))).toBeNull();
  });
});
