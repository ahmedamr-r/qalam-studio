import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { fromBytes, XLSX, type Readers } from "./core";
import { isFigures, parseDelimited, rowsText, sheetText, tableText, xlsxSheetRows } from "./rows";

describe("spreadsheets of people's answers", () => {
  it("reads CSV and TSV, quotes and lines inside cells included", () => {
    expect(parseDelimited('Name,Comment\nSara,"Too slow, honestly"\r\nOmar,"He said ""no""\nthen left"\n', ",")).toEqual([
      ["Name", "Comment"],
      ["Sara", "Too slow, honestly"],
      ["Omar", 'He said "no"\nthen left'],
    ]);
    expect(parseDelimited("a\tb\n1\t2", "\t")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("writes each row as one person's words, named by its name column, never its email", () => {
    const rows = parseDelimited("Name,Email,Rating,What could we do better?\nSara,sara@x.com,2,Delivery slots are always full on Sunday\nOmar,omar@x.com,4,\n,lee@x.com,1,I can never find my last order", ",");
    expect(rowsText(rows)).toBe("Sara (rating 2): Delivery slots are always full on Sunday\n\nRespondent 3 (rating 1): I can never find my last order");
  });

  it("names the columns when a row has several answers, and reads a sheet without people's words as plain text", () => {
    const rows = [
      ["Customer", "Why did you cancel?", "Anything else?"],
      ["Mona", "Fees were higher than the shop", "The app logged me out twice"],
    ];
    expect(rowsText(rows)).toBe("Mona: Why did you cancel?: Fees were higher than the shop · Anything else?: The app logged me out twice");
    expect(
      rowsText([
        ["Order", "Total", "Date"],
        ["1001", "45.00", "2026-10-01"],
      ]),
    ).toBeNull();
  });

  it("reads a CSV file and a real XLSX workbook as who said what", async () => {
    const readers: Readers = { pdf: async () => ({ text: "", pages: [] }), docx: async () => ({ text: "" }), html: async (t) => ({ text: t }) };
    const csv = new TextEncoder().encode("Name,Comment\nSara,Delivery slots are always full on Sunday evenings\n");
    expect((await fromBytes(csv.buffer as ArrayBuffer, "text/csv", "survey.csv", undefined, readers)).text).toBe("Sara: Delivery slots are always full on Sunday evenings");
    const zip = new JSZip();
    zip.file("xl/sharedStrings.xml", "<sst><si><t>Name</t></si><si><t>Feedback</t></si><si><t>I can never find my last order in the app</t></si></sst>");
    zip.file("xl/worksheets/sheet1.xml", '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Omar</t></is></c><c r="B2" t="s"><v>2</v></c></row></sheetData>');
    const bytes = await zip.generateAsync({ type: "arraybuffer" });
    const read = await fromBytes(bytes, XLSX, "answers.xlsx", undefined, readers);
    expect([read.title, read.text]).toEqual(["answers", "Omar: I can never find my last order in the app"]);
  });

  it("reads an XLSX sheet's cells, shared strings and inline text alike", () => {
    const shared = "<sst><si><t>Name</t></si><si><t>Feedback</t></si><si><r><t>Too </t></r><r><t>many steps &amp; fees</t></r></si></sst>";
    const sheet = '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Sara</t></is></c><c r="C2" t="s"><v>2</v></c></row></sheetData>';
    expect(xlsxSheetRows(sheet, shared)).toEqual([
      ["Name", "Feedback"],
      ["Sara", "", "Too many steps & fees"],
    ]);
  });
});

describe("a sheet of figures", () => {
  const funnel = [
    ["Step", "Users", "Left", "Owner email"],
    ["Basket", "6,100", "12%", "a@b.co"],
    ["Payment", "4,200", "41%", "a@b.co"],
  ];

  it("reads each row with its columns' names, never a private column", () => {
    expect(tableText(funnel)).toBe("Step: Basket · Users: 6,100 · Left: 12%\nStep: Payment · Users: 4,200 · Left: 41%");
  });

  it("says how many rows it left unread", () => {
    expect(tableText([["A"], ["1"], ["2"], ["3"]], 2)).toBe("A: 1\nA: 2\n(1 more rows not read)");
  });

  it("reads figures as a table whatever a column is called, and people's answers as who said what", () => {
    expect(isFigures(funnel)).toBe(true);
    const figures = [
      ["Week", "Problem count", "Note"],
      ["1", "120", "12%"],
      ["2", "98", "9%"],
    ];
    expect(isFigures(figures)).toBe(true);
    expect(sheetText(figures)).toBe("Week: 1 · Problem count: 120 · Note: 12%\nWeek: 2 · Problem count: 98 · Note: 9%");
    expect(sheetText([["Name", "Why did you cancel?"], ["Mona", "Fees were higher than the shop"]])).toBe("Mona: Fees were higher than the shop");
    // No column of people's words, and not mostly numbers: still a table.
    expect(sheetText(funnel)).toBe(tableText(funnel));
  });
});
