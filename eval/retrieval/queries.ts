import { textGoalId } from "@/goals/migrate";
import { cardRef, decisionRef, goalRef } from "@/hub/pieces";
import { factHash } from "@/knowledge/refs";
import { quoteRef } from "./basket";

/**
 * The retrieval eval's questions about the Basket sample, each with the pieces that answer it:
 * 2 for a piece that answers it, 1 for one that helps. They mix the ways people ask: in the
 * source's own words, in other words, about a decision, a goal or an assumption, from a card in
 * hand, and within one product.
 */

export interface EvalQuery {
  id: string;
  q: string;
  /** What the question is testing. */
  kind: "words" | "meaning" | "decision" | "goal" | "assumption" | "card" | "scope";
  anchor?: string;
  product?: string | null;
  relevant: Record<string, 1 | 2>;
}

const quote = (...ids: string[]) => ids.map(quoteRef);
const card = (board: string, id: string) => cardRef(board, id);
const need = (source: string, id: string) => `hub:need:${source}:${id}`;
const assumption = (board: string, id: string) => `hub:assumption:${board}:${id}`;
const context = (product: string, sub: string, text: string) => `hub:context:${product}:${sub}:${factHash(text)}`;
/** A goal in goals.md, as the sample's words made it (the organization's when no product). */
const goal = (text: string, product?: string) => goalRef(textGoalId(product ? `${product}:${text}` : text));
const grade = (g: 1 | 2, refs: string[]) => Object.fromEntries(refs.map((r) => [r, g])) as Record<string, 1 | 2>;

export const QUERIES: EvalQuery[] = [
  // In the source's words
  { id: "sara-swaps", kind: "words", q: "What did Sara say about substitutions?", relevant: { ...grade(2, quote("sara-4", "sara-5", "sara-6")), [need("sara", "n2")]: 1 } },
  { id: "late-tickets", kind: "words", q: "How many tickets were about late deliveries?", relevant: { ...grade(2, quote("tix-1")), ...grade(1, quote("dump-4", "tix-5")) } },
  { id: "refunds", kind: "words", q: "refunds take too long", relevant: grade(2, quote("tix-3")) },
  { id: "oat-milk", kind: "words", q: "oat milk running out at the office", product: "business", relevant: grade(2, quote("karim-3")) },
  { id: "invoice", kind: "words", q: "one invoice a month", product: "business", relevant: { ...grade(2, [...quote("karim-4"), card("pantry", "n7")]), [decisionRef("d5")]: 1 } },
  { id: "thursday", kind: "words", q: "Thursday reminder", relevant: grade(2, [...quote("layla-6"), card("reorders", "s3")]) },
  { id: "karim-slack", kind: "words", q: "What did Karim say about Slack?", relevant: grade(2, quote("karim-3")) },
  { id: "nadia-chicken", kind: "words", q: "Nadia chicken", relevant: grade(2, quote("nadia-1")) },

  // In other words
  { id: "second-order", kind: "meaning", q: "Why don't new customers come back after their first order?", product: "grocery", relevant: { ...grade(2, [...quote("layla-1", "layla-3", "layla-5", "dump-3"), need("layla", "n2")]), ...grade(1, [...quote("layla-4"), card("reorders", "n2"), need("layla", "n1")]) } },
  { id: "hidden-costs", kind: "meaning", q: "Customers are annoyed by hidden costs at checkout", relevant: { ...grade(2, [...quote("layla-1", "layla-2"), need("layla", "n1")]) } },
  { id: "ask-first", kind: "meaning", q: "People want to be asked before an item is replaced", relevant: { ...grade(2, [...quote("nadia-2"), card("reorders", "s5"), need("nadia", "n1")]), ...grade(1, quote("sara-6", "sara-4")) } },
  { id: "plan-evening", kind: "meaning", q: "Parents can't plan their evening around the delivery", relevant: { ...grade(2, [...quote("sara-7"), need("sara", "n3")]), ...grade(1, [...quote("ahmed-2", "ahmed-5"), card("delivery", "n5")]) } },
  { id: "pay-for-slot", kind: "meaning", q: "Would customers pay extra for a better delivery time?", relevant: grade(2, [...quote("ahmed-4"), card("delivery", "s6"), assumption("delivery", "a3")]) },
  { id: "find-past-order", kind: "meaning", q: "It's hard to find a previous order in the app", relevant: { ...grade(2, quote("sara-3", "tix-4")), ...grade(1, quote("mona-2")) } },
  { id: "rebuild-list", kind: "meaning", q: "Building the shopping list again every week takes too long", relevant: { ...grade(2, [...quote("sara-1"), card("reorders", "n1"), need("sara", "n1")]), ...grade(1, [...quote("sara-2", "mona-2", "karim-1"), card("pantry", "n8")]) } },
  { id: "fresh-quality", kind: "meaning", q: "Quality problems with fresh food", relevant: { ...grade(2, quote("layla-7")), ...grade(1, quote("nadia-5")) } },
  { id: "where-driver", kind: "meaning", q: "Customers don't know where the driver is", relevant: { ...grade(2, [...quote("ahmed-5", "ahmed-6"), card("delivery", "s7"), need("ahmed", "n2")]), [card("delivery", "n5")]: 1 } },
  { id: "never-swap", kind: "meaning", q: "Things customers never want swapped", relevant: { ...grade(2, [...quote("nadia-3"), need("nadia", "n2")]), ...grade(1, [...quote("nadia-4"), card("reorders", "s4")]) } },
  { id: "go-elsewhere", kind: "meaning", q: "Shopping at the supermarket instead of using the app", relevant: grade(2, quote("ahmed-3", "layla-4")) },
  { id: "clinic-delivery", kind: "meaning", q: "What do clinics need from deliveries?", product: "business", relevant: grade(2, [...quote("mona-4", "mona-5"), card("pantry", "n9")]) },

  // Decisions
  { id: "why-drop-saved", kind: "decision", q: "Why did we drop saved baskets?", relevant: { [decisionRef("d1")]: 2, [card("reorders", "s2")]: 1 } },
  { id: "why-evening-target", kind: "decision", q: "Why are evening slots the target?", relevant: { [decisionRef("d3")]: 2, ...grade(1, [card("delivery", "n4"), ...quote("tix-1")]) } },
  { id: "why-raise-target", kind: "decision", q: "Why did we raise the reorder target?", relevant: { [decisionRef("d4")]: 2, ...grade(1, [...quote("dump-1"), card("reorders", "o1")]) } },
  { id: "invoice-decision", kind: "decision", q: "What did we decide about invoices?", product: "business", relevant: { [decisionRef("d5")]: 2, [card("pantry", "n7")]: 1 } },

  // Goals, numbers, who it's for
  { id: "reorder-goal", kind: "goal", q: "What is the goal for weekly reorders?", product: "grocery", relevant: { ...grade(2, [card("reorders", "o1"), goal("More customers reorder every week", "grocery")]), ...grade(1, [...quote("dump-2"), decisionRef("d4")]) } },
  { id: "who-for", kind: "goal", q: "Who is the grocery app for?", relevant: { [context("grocery", "audience", "Parents with young kids in Dubai who do a big weekly shop")]: 2, [context("grocery", "segments", "Weekly planners; Top-up shoppers; New customers")]: 1 } },
  { id: "investor-target", kind: "goal", q: "What's the investors' target?", relevant: { ...grade(2, [...quote("dump-1"), goal("2M dirhams a month in orders by end of Q2")]), [decisionRef("d4")]: 1 } },
  { id: "second-order-rate", kind: "goal", q: "How many first-time customers order again?", relevant: { ...grade(2, quote("dump-3")), [goal("More first-time customers order a second time", "grocery")]: 1 } },

  // Assumptions and tests
  { id: "rules-assumption", kind: "assumption", q: "What are we assuming about substitution rules?", relevant: { [assumption("reorders", "a2")]: 2, [card("reorders", "s4")]: 1 } },
  { id: "shelf-test", kind: "assumption", q: "How are we testing the order again shelf?", relevant: { [card("reorders", "t1")]: 2, ...grade(1, [card("reorders", "s1"), assumption("reorders", "a1")]) } },
  { id: "arrival-doubt", kind: "assumption", q: "Doubts about whether arrival time matters", relevant: { ...grade(2, quote("dump-5")), [card("delivery", "n5")]: 1 } },

  // From a card in hand
  { id: "card-swaps", kind: "card", q: "evidence that substitutions break trust", anchor: card("reorders", "n3"), product: "grocery", relevant: { ...grade(2, quote("sara-4", "sara-5", "nadia-1", "tix-2")), ...grade(1, [...quote("nadia-2", "sara-6"), need("sara", "n2"), need("nadia", "n1")]) } },
  { id: "card-evening", kind: "card", q: "evening slots", anchor: card("delivery", "n4"), product: "grocery", relevant: { ...grade(2, quote("ahmed-1", "ahmed-2", "tix-1")), ...grade(1, [...quote("ahmed-4"), card("delivery", "s6"), decisionRef("d3"), need("ahmed", "n1")]) } },
  { id: "card-tracking", kind: "card", q: "what supports live tracking", anchor: card("delivery", "s7"), product: "grocery", relevant: { ...grade(2, quote("ahmed-6")), ...grade(1, [...quote("ahmed-5"), card("delivery", "n5")]) } },
  { id: "card-forget", kind: "card", q: "forgetting to reorder", anchor: card("reorders", "n2"), product: "grocery", relevant: { ...grade(2, quote("layla-3", "layla-4")), ...grade(1, [...quote("layla-6"), card("reorders", "s3"), need("layla", "n2")]) } },
  { id: "card-pantry", kind: "card", q: "counting the pantry", anchor: card("pantry", "n6"), product: "business", relevant: { ...grade(2, quote("karim-1", "karim-2")), ...grade(1, [...quote("karim-5"), card("pantry", "s9")]) } },

  // Within one product
  { id: "scope-same-items", kind: "scope", q: "ordering the same items every week", product: "grocery", relevant: { ...grade(2, quote("sara-2", "sara-1", "sara-8")), ...grade(1, [card("reorders", "n1"), need("sara", "n1")]) } },
  { id: "scope-copy-orders", kind: "scope", q: "copying old orders", product: "business", relevant: { ...grade(2, [...quote("mona-2"), card("pantry", "n8")]), [quoteRef("mona-3")]: 1 } },
];
