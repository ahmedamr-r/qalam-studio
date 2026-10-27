import type { Decision } from "@/decisions/model";
import type { Doc } from "@/doc/schema";
import type { DumpRole } from "@/discovery/dump";
import { findQuote } from "@/discovery/quotes";
import type { QuoteKind, SourceKind, SourceRecord } from "@/discovery/sources";
import type { AssumptionCategory, OstCard, OstEvidence, OstMetric, OstTest } from "@/discovery/types";
import type { Project } from "@/projects/model";
import { OrgStore } from "../../server/org/store";

/**
 * The retrieval eval's sample organization: Basket, a grocery delivery app for parents, and a
 * business product that stocks office pantries. Eight sources (interviews, a ticket count, the
 * founder's brain dump), three boards and five decisions, written through the store like the app
 * writes them. Every quote is found word for word in its source, as the app requires.
 */

const AT = new Date(2026, 9, 6, 10).getTime();
const day = (n: number) => AT + n * 86_400_000;

interface QuoteIn {
  id: string;
  text: string;
  kind?: QuoteKind;
  role?: DumpRole;
}

interface SourceIn {
  id: string;
  title: string;
  kind: SourceKind;
  product: string;
  speaker?: string;
  day: number;
  text: string;
  quotes: QuoteIn[];
  needs?: { id: string; title: string; quotes: string[] }[];
}

export const SOURCES: SourceIn[] = [
  {
    id: "sara",
    title: "Sara interview",
    kind: "interview",
    product: "grocery",
    speaker: "Sara",
    day: 0,
    text: `Interviewer: Walk me through your last weekly shop.
Sara: Every Sunday night I sit down and rebuild my basket from scratch. It's the same thirty things every week, milk, nappies, bananas, the yoghurt my son likes, and I still have to search for each one.
Interviewer: How long does that take?
Sara: Twenty minutes, sometimes more if the kids are up. I tried to find my last order to copy it but it's buried three screens deep under Account.
Interviewer: What happens when something is out of stock?
Sara: They swap it without asking. Last week I got full-fat milk instead of the lactose-free one and my son can't drink it. I'd rather they just leave it out.
Interviewer: And the delivery itself?
Sara: The window says 6 to 10. I can't plan bath time around a four-hour window. Most weeks the courier calls me from downstairs and I'm in the middle of something.
Interviewer: Anything you'd change first?
Sara: Let me press one button to get last week's basket, then I'll take things off. That alone would save my Sunday night.`,
    quotes: [
      { id: "sara-1", kind: "pain", text: "Every Sunday night I sit down and rebuild my basket from scratch." },
      { id: "sara-2", kind: "behavior", text: "It's the same thirty things every week" },
      { id: "sara-3", kind: "pain", text: "I tried to find my last order to copy it but it's buried three screens deep under Account." },
      { id: "sara-4", kind: "pain", text: "They swap it without asking." },
      { id: "sara-5", kind: "pain", text: "I got full-fat milk instead of the lactose-free one and my son can't drink it." },
      { id: "sara-6", kind: "desire", text: "I'd rather they just leave it out." },
      { id: "sara-7", kind: "pain", text: "I can't plan bath time around a four-hour window." },
      { id: "sara-8", kind: "idea", text: "Let me press one button to get last week's basket, then I'll take things off." },
    ],
    needs: [
      { id: "n1", title: "Reordering the usual basket takes too long", quotes: ["sara-1", "sara-2", "sara-3", "sara-8"] },
      { id: "n2", title: "Substitutions break trust", quotes: ["sara-4", "sara-5", "sara-6"] },
      { id: "n3", title: "Delivery windows are too wide", quotes: ["sara-7"] },
    ],
  },
  {
    id: "layla",
    title: "Layla interview",
    kind: "interview",
    product: "grocery",
    speaker: "Layla",
    day: 1,
    text: `Interviewer: You ordered once in March. What happened after?
Layla: Honestly the first order was fine, but the delivery fee was 15 dirhams on a 90 dirham order and that felt like a lot. I didn't see it until the last screen.
Interviewer: Did you think about ordering again?
Layla: I meant to. Then I forgot the app existed. Nothing reminded me, and when I needed eggs I just walked to the shop downstairs.
Interviewer: What would have brought you back?
Layla: If the second order was free to deliver I'd have tried it again. And maybe a nudge on Thursday, that's when the fridge is empty.
Interviewer: How did the first order go otherwise?
Layla: Two of the avocados were rock hard. I didn't know how to complain so I didn't.`,
    quotes: [
      { id: "layla-1", kind: "pain", text: "the delivery fee was 15 dirhams on a 90 dirham order and that felt like a lot" },
      { id: "layla-2", kind: "pain", text: "I didn't see it until the last screen." },
      { id: "layla-3", kind: "behavior", text: "Then I forgot the app existed." },
      { id: "layla-4", kind: "behavior", text: "when I needed eggs I just walked to the shop downstairs" },
      { id: "layla-5", kind: "desire", text: "If the second order was free to deliver I'd have tried it again." },
      { id: "layla-6", kind: "idea", text: "maybe a nudge on Thursday, that's when the fridge is empty" },
      { id: "layla-7", kind: "pain", text: "Two of the avocados were rock hard. I didn't know how to complain so I didn't." },
    ],
    needs: [
      { id: "n1", title: "Surprise fees put new customers off", quotes: ["layla-1", "layla-2"] },
      { id: "n2", title: "New customers forget to come back", quotes: ["layla-3", "layla-4", "layla-6"] },
    ],
  },
  {
    id: "ahmed",
    title: "Ahmed interview",
    kind: "interview",
    product: "grocery",
    speaker: "Ahmed",
    day: 2,
    text: `Interviewer: When do you usually order?
Ahmed: After the kids are asleep, so around nine at night. By then every evening slot for tomorrow is gone.
Interviewer: What do you do then?
Ahmed: I book the next free one, which is usually a morning slot when I'm at work, so my wife has to stay in. Or I give up and go to the supermarket on Friday.
Interviewer: Would you pay to keep a slot?
Ahmed: For the 7 to 9 slot, yes, a few dirhams. My time is worth more than that.
Interviewer: How do you know when the order will come?
Ahmed: I don't. The app says "on the way" for an hour. I'd love to see where the driver is, like with taxis.
Interviewer: Anything else?
Ahmed: Reordering is fine for me, I use my favourites list. It's the slots that kill it.`,
    quotes: [
      { id: "ahmed-1", kind: "pain", text: "By then every evening slot for tomorrow is gone." },
      { id: "ahmed-2", kind: "behavior", text: "I book the next free one, which is usually a morning slot when I'm at work, so my wife has to stay in." },
      { id: "ahmed-3", kind: "behavior", text: "Or I give up and go to the supermarket on Friday." },
      { id: "ahmed-4", kind: "desire", text: "For the 7 to 9 slot, yes, a few dirhams." },
      { id: "ahmed-5", kind: "pain", text: `The app says "on the way" for an hour.` },
      { id: "ahmed-6", kind: "idea", text: "I'd love to see where the driver is, like with taxis." },
      { id: "ahmed-7", kind: "behavior", text: "Reordering is fine for me, I use my favourites list." },
    ],
    needs: [
      { id: "n1", title: "Evening slots sell out", quotes: ["ahmed-1", "ahmed-2", "ahmed-3", "ahmed-4"] },
      { id: "n2", title: "No idea when the order arrives", quotes: ["ahmed-5", "ahmed-6"] },
    ],
  },
  {
    id: "nadia",
    title: "Nadia interview",
    kind: "interview",
    product: "grocery",
    speaker: "Nadia",
    day: 3,
    text: `Interviewer: Tell me about the last time an order disappointed you.
Nadia: They replaced my organic chicken with a regular one and charged me the same. I only noticed when I was cooking.
Interviewer: Would you want them to call you?
Nadia: A call is too much, I'm usually in a meeting. A message where I can say yes or no would be perfect.
Interviewer: Are there things you'd never want swapped?
Nadia: Baby formula, never. Bread, I don't care. I'd set that up once if I could.
Interviewer: How do you feel about the fresh produce?
Nadia: Mostly good. The herbs wilt fast, but that's normal.`,
    quotes: [
      { id: "nadia-1", kind: "pain", text: "They replaced my organic chicken with a regular one and charged me the same." },
      { id: "nadia-2", kind: "desire", text: "A message where I can say yes or no would be perfect." },
      { id: "nadia-3", kind: "need", text: "Baby formula, never. Bread, I don't care." },
      { id: "nadia-4", kind: "idea", text: "I'd set that up once if I could." },
      { id: "nadia-5", kind: "behavior", text: "The herbs wilt fast, but that's normal." },
    ],
    needs: [
      { id: "n1", title: "Swaps happen without consent", quotes: ["nadia-1", "nadia-2"] },
      { id: "n2", title: "Rules for what can be swapped", quotes: ["nadia-3", "nadia-4"] },
    ],
  },
  {
    id: "tickets",
    title: "Support tickets, week of Oct 6",
    kind: "paste",
    product: "grocery",
    day: 4,
    text: `Omar's count of last week's tickets (412 in total):
- Late or missed delivery: 131 tickets. Most are evening slots that slipped past 10pm.
- Wrong substitution: 97 tickets. Dairy and baby products lead.
- Missing items: 64 tickets.
- Payment and refunds: 52 tickets. Refunds take 5 to 7 days to show on cards.
- App problems: 38 tickets, mostly people who can't find past orders.
- Other: 30 tickets.
Customers who wrote twice about lateness ordered 40% less the next month.`,
    quotes: [
      { id: "tix-1", kind: "pain", text: "Late or missed delivery: 131 tickets. Most are evening slots that slipped past 10pm." },
      { id: "tix-2", kind: "pain", text: "Wrong substitution: 97 tickets. Dairy and baby products lead." },
      { id: "tix-3", kind: "pain", text: "Refunds take 5 to 7 days to show on cards." },
      { id: "tix-4", kind: "pain", text: "App problems: 38 tickets, mostly people who can't find past orders." },
      { id: "tix-5", kind: "behavior", text: "Customers who wrote twice about lateness ordered 40% less the next month." },
    ],
  },
  {
    id: "dump",
    title: "Founder notes after the investor call",
    kind: "dump",
    product: "grocery",
    day: 5,
    text: `After the investor call: they want 2M dirhams a month in orders by end of Q2, we're around 1.4M. What matters to me is people coming back every week; we're at 1.3 reorders per customer. Only 38% of first-time customers place a second order within 14 days, I'd love that at 50%. Omar thinks half the tickets are about late deliveries. I'm not sure arrival time matters that much, our ETAs are right most of the time. Maybe a staples subscription box would fix running out of milk.`,
    quotes: [
      { id: "dump-1", role: "goal", text: "they want 2M dirhams a month in orders by end of Q2" },
      { id: "dump-2", role: "metric", text: "we're at 1.3 reorders per customer" },
      { id: "dump-3", role: "metric", text: "Only 38% of first-time customers place a second order within 14 days" },
      { id: "dump-4", role: "evidence", text: "Omar thinks half the tickets are about late deliveries." },
      { id: "dump-5", role: "assumption", text: "I'm not sure arrival time matters that much, our ETAs are right most of the time." },
      { id: "dump-6", role: "idea", text: "Maybe a staples subscription box would fix running out of milk." },
    ],
  },
  {
    id: "karim",
    title: "Karim interview",
    kind: "interview",
    product: "business",
    speaker: "Karim",
    day: 6,
    text: `Interviewer: How do you stock the pantry today?
Karim: Every Monday I walk around with a notepad, count what's left, and place one big order. It takes me most of the morning.
Interviewer: What goes wrong?
Karim: We run out of oat milk by Wednesday and people complain on Slack. Coffee pods too.
Interviewer: How do you pay?
Karim: Finance wants one invoice a month, not forty receipts. Right now I forward every receipt by email and it's a mess.
Interviewer: Would a schedule help?
Karim: If the basics arrived every Monday and I only added extras, I'd get my morning back.`,
    quotes: [
      { id: "karim-1", kind: "behavior", text: "Every Monday I walk around with a notepad, count what's left, and place one big order." },
      { id: "karim-2", kind: "pain", text: "It takes me most of the morning." },
      { id: "karim-3", kind: "pain", text: "We run out of oat milk by Wednesday and people complain on Slack." },
      { id: "karim-4", kind: "need", text: "Finance wants one invoice a month, not forty receipts." },
      { id: "karim-5", kind: "desire", text: "If the basics arrived every Monday and I only added extras, I'd get my morning back." },
    ],
  },
  {
    id: "mona",
    title: "Mona interview",
    kind: "interview",
    product: "business",
    speaker: "Mona",
    day: 7,
    text: `Interviewer: What do you order for the clinic?
Mona: Water, tea, biscuits for the waiting room, and cleaning supplies. The same list every two weeks.
Interviewer: How do you reorder?
Mona: I copy last month's order from my email into the app line by line. I wish it remembered.
Interviewer: Any delivery issues?
Mona: Deliveries must come before 9am, before patients arrive. Twice the driver came at noon and blocked the entrance.`,
    quotes: [
      { id: "mona-1", kind: "behavior", text: "The same list every two weeks." },
      { id: "mona-2", kind: "pain", text: "I copy last month's order from my email into the app line by line." },
      { id: "mona-3", kind: "desire", text: "I wish it remembered." },
      { id: "mona-4", kind: "need", text: "Deliveries must come before 9am, before patients arrive." },
      { id: "mona-5", kind: "pain", text: "Twice the driver came at noon and blocked the entrance." },
    ],
  },
];

interface CardIn {
  id: string;
  kind: OstCard["kind"];
  title: string;
  stage: OstCard["stage"];
  description?: string;
  /** Quote ids; "!" before one: it speaks against the card. */
  evidence?: string[];
  metric?: OstMetric;
  test?: OstTest;
  assumptions?: { id: string; category: AssumptionCategory; text: string; importance?: 1 | 2 | 3 }[];
  children?: CardIn[];
}

interface BoardIn {
  id: string;
  name: string;
  product: string;
  tree: CardIn;
}

export const BOARDS: BoardIn[] = [
  {
    id: "reorders",
    name: "Weekly reorders",
    product: "grocery",
    tree: {
      id: "o1",
      kind: "outcome",
      title: "More customers reorder every week",
      stage: "active",
      metric: { name: "Reorders per customer", unit: "orders", direction: "increase", baseline: 1.2, current: 1.3, target: 1.5, timeframe: "by March" },
      children: [
        {
          id: "n1",
          kind: "opportunity",
          title: "Rebuilding my usual basket takes too long",
          stage: "target",
          evidence: ["sara-1", "sara-2", "tix-4"],
          children: [
            {
              id: "s1",
              kind: "solution",
              title: "Order again shelf on the home screen",
              stage: "testing",
              evidence: ["sara-8"],
              assumptions: [{ id: "a1", category: "desirability", text: "Parents want last week's basket, not a fresh start", importance: 3 }],
              children: [{ id: "t1", kind: "test", title: "Prototype test with 5 parents", stage: "running", test: { assumptionIds: ["a1"], method: "5-user prototype test", criterion: "4 of 5 find the shelf unprompted" } }],
            },
            { id: "s2", kind: "solution", title: "Saved baskets to reorder in one tap", stage: "dropped" },
          ],
        },
        {
          id: "n2",
          kind: "opportunity",
          title: "I forget to reorder until I've run out",
          stage: "exploring",
          evidence: ["layla-3", "layla-4"],
          children: [{ id: "s3", kind: "solution", title: "Thursday reminder when the fridge is empty", stage: "idea", evidence: ["layla-6"] }],
        },
        {
          id: "n3",
          kind: "opportunity",
          title: "Substitutions break my trust",
          stage: "exploring",
          evidence: ["sara-4", "sara-5", "nadia-1", "tix-2"],
          children: [
            {
              id: "s4",
              kind: "solution",
              title: "Substitution rules you set once",
              stage: "idea",
              evidence: ["nadia-4"],
              assumptions: [{ id: "a2", category: "usability", text: "Parents set rules before their first bad swap", importance: 2 }],
            },
            { id: "s5", kind: "solution", title: "Approve swaps by message", stage: "idea", evidence: ["nadia-2"] },
          ],
        },
      ],
    },
  },
  {
    id: "delivery",
    name: "Delivery experience",
    product: "grocery",
    tree: {
      id: "o2",
      kind: "outcome",
      title: "Deliveries arrive when promised",
      stage: "active",
      metric: { name: "On-time deliveries", unit: "%", direction: "increase", baseline: 71, current: 71, target: 90 },
      children: [
        {
          id: "n4",
          kind: "opportunity",
          title: "Evening slots are full when I need them",
          stage: "target",
          evidence: ["ahmed-1", "ahmed-2", "tix-1"],
          children: [
            {
              id: "s6",
              kind: "solution",
              title: "Priority evening slots for a fee",
              stage: "idea",
              evidence: ["ahmed-4"],
              assumptions: [{ id: "a3", category: "viability", text: "Parents pay 5 dirhams to keep an evening slot", importance: 3 }],
            },
          ],
        },
        {
          id: "n5",
          kind: "opportunity",
          title: "I'm never sure when my order will arrive",
          stage: "exploring",
          evidence: ["ahmed-5", "sara-7", "!dump-5"],
          children: [{ id: "s7", kind: "solution", title: "Live courier tracking", stage: "idea", evidence: ["ahmed-6"] }],
        },
      ],
    },
  },
  {
    id: "pantry",
    name: "Office pantry",
    product: "business",
    tree: {
      id: "o3",
      kind: "outcome",
      title: "Offices reorder on a schedule",
      stage: "active",
      children: [
        {
          id: "n6",
          kind: "opportunity",
          title: "Counting the pantry takes a morning",
          stage: "target",
          evidence: ["karim-1", "karim-2"],
          children: [{ id: "s9", kind: "solution", title: "Scheduled Monday basics", stage: "idea", evidence: ["karim-5"] }],
        },
        { id: "n7", kind: "opportunity", title: "Finance needs one monthly invoice", stage: "parked", evidence: ["karim-4"] },
        { id: "n8", kind: "opportunity", title: "Reordering means copying old orders by hand", stage: "exploring", evidence: ["mona-2", "mona-3"] },
        { id: "n9", kind: "opportunity", title: "Deliveries must arrive before opening hours", stage: "exploring", evidence: ["mona-4", "mona-5"] },
      ],
    },
  },
];

const decision = (id: string, board: string, card: string | null, kind: Decision["kind"], what: string, why: string, d: number): Decision => {
  const b = BOARDS.find((x) => x.id === board)!;
  return { id, at: day(d), kind, board, boardName: b.name, product: b.product, card, cardTitle: "", what, by: "you", big: true, why };
};

export const DECISIONS: Decision[] = [
  decision("d1", "reorders", "s2", "stage", "Dropped the solution “Saved baskets to reorder in one tap”", "Parents wanted last week's basket, not a list to maintain; folded into the order again shelf", 8),
  decision("d2", "reorders", "n1", "target", "Made “Rebuilding my usual basket takes too long” the target", "It came up in every weekly-planner interview and in 38 tickets about past orders", 8),
  decision("d3", "delivery", "n4", "target", "Made “Evening slots are full when I need them” the target, instead of “I'm never sure when my order will arrive”", "131 late-delivery tickets are mostly evening slots", 9),
  decision("d4", "reorders", "o1", "metric", "Changed the target of “More customers reorder every week” from 1.4 orders to 1.5 orders", "Investors asked for 2M a month by Q2", 9),
  decision("d5", "pantry", "n7", "stage", "Parked “Finance needs one monthly invoice”", "Finance tooling is next quarter; offices still order without it", 10),
];

export const PRODUCTS = [
  {
    id: "grocery",
    name: "Grocery app",
    audience: "Parents with young kids in Dubai who do a big weekly shop",
    goals: ["More customers reorder every week", "More first-time customers order a second time"],
    context: "Basket delivers groceries the same day; most orders are a weekly shop placed in the evening.",
    segments: ["Weekly planners", "Top-up shoppers", "New customers"],
  },
  {
    id: "business",
    name: "Basket for Business",
    audience: "Office managers and clinic admins who stock pantries for teams of 20 to 200",
    goals: ["Offices reorder on a schedule"],
    context: "Offices pay by monthly invoice; deliveries go to reception.",
    segments: ["Startups", "Clinics"],
  },
];

// ---------------------------------------------------------------------------

/** Every quote's ref, by its id here. */
export const quoteRef = (id: string) => `hub:quote:${id}`;

function sourceRecord(s: SourceIn): SourceRecord {
  const at = day(s.day);
  return {
    v: 1,
    id: s.id,
    projectId: s.product === "business" ? "pantry" : "reorders",
    boards: [],
    product: s.product,
    kind: s.kind,
    title: s.title,
    text: s.text,
    addedAt: at,
    read: [0],
    quotes: s.quotes.map((q) => {
      const m = findQuote(s.text, q.text);
      if (!m) throw new Error(`Not in ${s.title} word for word: ${q.text}`);
      return { id: q.id, text: q.text, span: m.span, kind: q.kind ?? "need", ...(q.role ? { role: q.role } : {}), ...(s.speaker ? { speaker: s.speaker } : {}), addedBy: "ai" as const, at };
    }),
    needs: (s.needs ?? []).map((n) => ({ id: n.id, title: n.title, quoteIds: n.quotes })),
  };
}

function boardDoc(b: BoardIn): Doc {
  const nodes: Record<string, unknown> = {};
  const quote = new Map(SOURCES.flatMap((s) => s.quotes.map((q) => [q.id, { q, s }] as const)));
  const add = (c: CardIn, parentId: string | null, at: number) => {
    const evidence: OstEvidence[] = (c.evidence ?? []).map((raw, i) => {
      const against = raw.startsWith("!");
      const id = raw.replace(/^!/, "");
      const { q, s } = quote.get(id)!;
      // As the app attaches a quote: its words, where they sit in the source, and the piece they are.
      const span = findQuote(s.text, q.text)!.span;
      return { id: `${c.id}-e${i}`, kind: s.kind === "dump" ? "dump" : "quote", text: q.text, sourceId: s.id, sourceTitle: s.title, span, piece: quoteRef(id), ...(s.speaker ? { speaker: s.speaker } : {}), ...(against ? { stance: "against" as const } : {}), addedBy: "ai", at };
    });
    const ost: OstCard = {
      v: 1,
      kind: c.kind,
      title: c.title,
      stage: c.stage,
      createdBy: "user",
      evidence,
      ...(c.description ? { description: c.description } : {}),
      ...(c.metric ? { metric: c.metric } : {}),
      ...(c.test ? { test: c.test } : {}),
      ...(c.assumptions ? { assumptions: c.assumptions.map((a) => ({ ...a, addedBy: "user" as const, at })) } : {}),
      stageAt: at,
    };
    nodes[c.id] = { id: c.id, type: "frame", name: c.title, parentId, children: (c.children ?? []).map((x) => x.id), x: 0, y: 0, w: 240, h: 80, meta: { ost } };
    for (const child of c.children ?? []) add(child, c.id, at);
  };
  add(b.tree, null, day(8));
  return { roots: [b.tree.id], nodes } as unknown as Doc;
}

/** Write the sample organization into `dir` (made if it isn't there). */
export async function buildBasket(dir: string): Promise<OrgStore> {
  const store = await OrgStore.create(dir, { id: "basket-eval", name: "Basket", createdAt: AT });
  await store.putAbout({ audience: "Families and offices in Dubai and Abu Dhabi", goals: ["2M dirhams a month in orders by end of Q2"], context: "Basket is a grocery delivery company with a consumer app and a business service.", segments: [] });
  for (const p of PRODUCTS) await store.putProduct(p);
  for (const b of BOARDS) {
    const project: Project = { id: b.id, type: "discovery", name: b.name, createdAt: AT, updatedAt: AT, product: b.product };
    await store.putProject(project);
    await store.putDoc(b.id, boardDoc(b));
  }
  for (const s of SOURCES) await store.putSource({ ...sourceRecord(s), boards: [s.product === "business" ? "pantry" : "reorders"] });
  await store.appendDecisions(DECISIONS);
  return store;
}
