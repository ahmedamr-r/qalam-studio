import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { personaById } from "./personas";
import { makePlayer } from "./player";
import { Tab } from "./tab";

/**
 * The real app, walked with no model call: the routes that would call one are answered in the browser.
 * It checks what a person meets and what the window sends: nothing is picked for them, Enter leaves a
 * question unanswered, and someone with no idea is worked with rather than scanned. The driver finds
 * things by what they say, so run this after the app's copy changes.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok: boolean, what: string, got?: unknown) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}${got !== undefined ? `\n      ${JSON.stringify(got).slice(0, 300)}` : ""}`);
};

const options = [{ value: "a", label: "Yes, often", description: "" }, { value: "b", label: "Sometimes", description: "" }, { value: "c", label: "Rarely", description: "" }];
const questions = [
  { id: "problems", title: "Do first orders often have problems?", why: "", multi: false, options, recommended: ["b"], allowOther: true },
  { id: "reach", title: "How can you reach a customer?", why: "", multi: true, options: [{ value: "p", label: "Push", description: "" }, { value: "e", label: "Email", description: "" }], recommended: ["p"], allowOther: true },
  { id: "tried", title: "What have you tried?", why: "", multi: false, options: [], recommended: [], allowOther: true },
];
const pickQuestion = { id: "pick", title: "Which customers first", why: "", multi: false, options: [{ value: "n", label: "New customers", description: "" }, { value: "r", label: "Regulars", description: "" }], recommended: ["r"], allowOther: true };
/** A turn of the interview as the core answers it. */
const turnOf = (qs: unknown[]) => ({ questions: qs, lookups: [], done: false, understood: [], terms: [], choices: [] });
const done = { questions: [], lookups: [], done: true, understood: [{ text: "They want something that makes money" }], terms: [], choices: [] };
let mode: "first" | "many" | "typed" | "known" | "gated" = "first";
const typedQuestion = { id: "typed", title: "What have you tried so far?", why: "", multi: false, options: [], recommended: [], allowOther: true };
const DAY = 86_400_000;
/** Questions as the core sends them when one like each was answered before (src/memory/known.ts): their own words from weeks ago, and a teammate's pick. */
const knownQuestions = [
  { id: "nrr", title: "What is net revenue retention today?", why: "", multi: false, options: [], recommended: [], allowOther: true, known: [{ id: "m-own", text: "About 104%", how: "own", mine: true, at: Date.now() - 20 * DAY, flow: "find", match: "exact" }] },
  { ...pickQuestion, id: "first", known: [{ id: "m-pick", text: "Regulars", how: "pick", mine: false, name: "Omar", at: Date.now() - 2 * DAY, flow: "focus", match: "near" }] },
];
/** The same, answered by them yesterday (src/memory/gate.ts): not asked again. */
const gatedQuestions = [
  { ...knownQuestions[0], id: "nrr2", known: [{ ...knownQuestions[0].known[0], at: Date.now() - DAY }] },
  { ...pickQuestion, id: "first2", known: [{ id: "m-pick2", text: "Regulars", how: "pick", mine: true, at: Date.now() - DAY, flow: "focus", match: "exact" }] },
];

async function main() {
  const base = path.resolve(".qalam-dev/stress");
  await mkdir(base, { recursive: true });
  const out = await mkdtemp(path.join(base, "smoke-"));
  const p = personaById("a1")!;
  const player = makePlayer(p, { structured: (async () => ({ data: { ids: [], pick: "", words: "" } })) as never });
  const tab = new Tab(p, player, path.join(out, "home"), 3235, process.cwd());
  await tab.prepare();
  try {
    await tab.start();
    let asks = 0;
    // What a scan answers, so the reading screens can be walked without one running.
    let reading: unknown = null;
    const sessionOf = (target: unknown) => ({ v: 1, state: "reading", at: Date.now(), target, steps: ["Starting", "Looking for what people use today"], competitors: [], read: [], skipped: { reddit: 0, before: 0, articles: 0, unreadable: 0 }, checked: { kept: 0, notFound: 0, unbacked: 0 }, problems: [], thin: false });
    const firstRead = (said: string) => (/Basket/.test(said) ? { named: true, product: "Basket", name: "Basket" } : /freelancers/i.test(said) ? { named: true, product: "", name: "Freelancer invoice chasing" } : { named: false, product: "", name: "" });
    await tab.stub({
      "/api/start/read": (b: { said: string }) => firstRead(b.said),
      "/scan/named": () => ({ named: false }),
      "/scan/ask": () => ({ questions: [] }),
      "/scan/steer": () => ({ session: reading }),
      "/scan": (b: { target?: unknown } | null) => ({ session: b?.target ? (reading = sessionOf(b.target)) : reading }),
      "/api/engine/test": () => ({ ok: true, word: "Ready", ms: 1, at: Date.now() }),
      "/plan/route": () => ({ route: "plan" }),
      // The opening look answers late: the first round shows while it runs.
      "/plan/look": () => new Promise((resolve) => setTimeout(() => resolve({ at: Date.now(), query: "", lines: [], pages: [] }), 2500)),
      // A turn of the interview, as the core keeps it: one round, then (for `many`) a round each of four, then done.
      "/plan/next": () => {
        const n = asks++;
        if (mode === "many") return n < 4 ? turnOf([{ ...pickQuestion, id: `pick${n}`, title: `${pickQuestion.title} (${n + 1})` }]) : done;
        if (mode === "typed") return n === 0 ? turnOf([typedQuestion]) : done;
        if (mode === "known") return n === 0 ? turnOf(knownQuestions) : done;
        // Once: the core drops a question asked before (the memory round's too), so a later turn never brings them again.
        if (mode === "gated") return n === 0 ? { ...turnOf(gatedQuestions), done: true } : done;
        return n === 0 ? turnOf(questions) : done;
      },
      "/plan/propose": () => ({ cards: [], start: null, doubt: "", quotes: {} }),
    });

    // Someone with no idea, from the empty canvas's box: asked to read, it works it out with them.
    await tab.canvas();
    check(!tab.errors.length, "The canvas opens with no errors", tab.errors.slice(0, 2));
    const said = "I want to build something that makes money. I know React.";
    await tab.js(`document.querySelector('#scan-box')?.focus()`);
    await tab.type(said);
    await tab.press("Enter");
    for (let i = 0; i < 40 && !(await tab.see()).step; i++) await sleep(250);
    const paths = tab.stubbed.map((s) => s.path);
    check(paths.includes("/scan/named"), "It asks whether their words name anything to read about", paths);
    check(paths.includes("/plan/look") && !tab.bodies.some((b) => b.path === "scan" && (b.body as { target?: unknown }).target), "With nothing named it works it out, and no scan starts", paths);

    // The questions: nothing picked, what's recommended marked and not chosen.
    let s = await tab.see();
    check(s.step?.title === questions[0].title, "It asks in the box", s.step?.title);
    const looking = await tab.js<boolean>(`[...document.querySelectorAll('*')].some((el) => el.children.length === 0 && /Looking on the web/.test(el.textContent || ''))`);
    check(looking, "The first round shows while the web look still runs");
    check(!s.step?.radios.some((r) => r.on), "Nothing is picked for them", s.step?.radios);
    check(s.step?.radios.find((r) => r.rec)?.label === "Sometimes", "Qalam AI's recommendation is marked, and only that one", s.step?.radios.filter((r) => r.rec).map((r) => r.label));
    await tab.shot(path.join(out, "1-question.png"));
    await tab.inCard("Next");
    await sleep(500);
    s = await tab.see();
    check(s.step?.title === questions[1].title && !s.alert, "Next on a card nobody touched goes on with nothing recorded, and nothing refuses it", { step: s.step?.title, alert: s.alert });
    check(s.step?.checks.length === 2 && !s.step.checks.some((c) => c.on), "A choice of several starts empty", s.step?.checks);
    await tab.inCard("Next");
    await sleep(500);
    s = await tab.see();
    check(s.step?.title === questions[2].title && !!s.step?.skip, "An open question can be skipped", s.step?.title);
    await tab.inCard("Skip");
    await sleep(500);
    s = await tab.see();
    check(!!s.step?.review, "It reaches the review", s.step?.label);
    await tab.shot(path.join(out, "2-review.png"));
    await tab.inCard("Send answers");
    // Nothing more to ask: What we settled, then Propose.
    let seen = await tab.see();
    for (let i = 0; i < 60 && !seen.settle; i++) {
      await sleep(250);
      seen = await tab.see();
    }
    check(seen.settle === "Propose", "The bench's driver reads What we settled and its verb, so a whole run goes on past it", seen.settle);
    let settled = false;
    for (let i = 0; i < 60 && !(settled = await tab.click("Propose")); i++) await sleep(250);
    check(settled, "What we settled shows before anything is proposed, with Propose");
    for (let i = 0; i < 40 && !tab.stubbed.some((x) => x.path === "/plan/propose"); i++) await sleep(250);
    type Sent = { asking?: { rounds: { by?: string; asked: { answer: string; how: string }[] }[] } };
    const propose = tab.stubbed.find((x) => x.path === "/plan/propose")?.body as Sent | undefined;
    const answers = propose?.asking?.rounds[0]?.asked ?? null;
    check(!!answers && answers.length === 3 && answers.every((a) => a.answer === "" && a.how === "left"), "What they left goes as nothing, never as what they said", answers);

    // No limit on rounds, and Qalam AI's picks: four rounds, each taken in one press, kept as its picks.
    tab.stubbed.length = 0;
    asks = 0;
    mode = "many";
    await tab.chat("What should we build next for our regulars?");
    let rounds = 0;
    for (let i = 0; i < 120 && rounds < 4; i++) {
      if (await tab.click("Use Qalam AI's picks")) rounds++;
      else await sleep(250);
    }
    check(rounds === 4, "A fourth round is asked, as many as it needs", rounds);
    let proposed = false;
    for (let i = 0; i < 60 && !(proposed = await tab.click("Propose")); i++) await sleep(250);
    for (let i = 0; i < 40 && !tab.stubbed.some((x) => x.path === "/plan/propose"); i++) await sleep(250);
    const picked = ((tab.stubbed.find((x) => x.path === "/plan/propose")?.body as Sent | undefined)?.asking?.rounds ?? []).flatMap((r) => r.asked);
    check(proposed && picked.length === 4 && picked.every((a) => a.how === "pick" && a.answer === "Regulars"), "Qalam AI's picks fill only what it recommends, and go as its picks, never as their words", picked);

    // What the bench's driver types goes in the question's own box, with another box on the page (as a card's Notes or Evidence would be).
    tab.stubbed.length = 0;
    asks = 0;
    mode = "typed";
    await tab.chat("What should we do about first orders?");
    for (let i = 0; i < 60 && !(await tab.see()).step?.text; i++) await sleep(250);
    await tab.js(`(() => { const t = document.createElement('textarea'); t.id = 'decoy'; t.style.cssText = 'position:fixed;right:8px;bottom:8px;width:80px;height:40px'; document.body.appendChild(t); return true; })()`);
    const typedIn = await tab.typeInCard("textarea", "We tried a reorder button in March");
    await sleep(150);
    await tab.inCard((await tab.see()).step?.next ?? "Next");
    for (let i = 0; i < 20 && !(await tab.see()).step?.review; i++) await sleep(250);
    await tab.inCard("Send answers");
    let typedProposed = false;
    for (let i = 0; i < 60 && !(typedProposed = await tab.click("Propose")); i++) await sleep(250);
    for (let i = 0; i < 40 && !tab.stubbed.some((x) => x.path === "/plan/propose"); i++) await sleep(250);
    const typed = ((tab.stubbed.find((x) => x.path === "/plan/propose")?.body as Sent | undefined)?.asking?.rounds ?? []).flatMap((r) => r.asked);
    const decoy = await tab.js<string>(`(() => { const t = document.getElementById('decoy'); const v = t?.value ?? ''; t?.remove(); return v; })()`);
    check(typedIn && typedProposed && typed.length === 1 && typed[0].answer === "We tried a reorder button in March" && typed[0].how === "own" && decoy === "", "What the bench's driver types goes in the question's own box, as their words, not another box on the page", { typed, decoy });

    // "I don't know" is an answer of its own: the button, or the words, go as that, never as their words.
    const unknownSent = async (answerIt: () => Promise<unknown>) => {
      tab.stubbed.length = 0;
      asks = 0;
      await tab.chat("What should we do about refunds?");
      for (let i = 0; i < 60 && !(await tab.see()).step?.text; i++) await sleep(250);
      await answerIt();
      await sleep(250);
      for (let i = 0; i < 20 && !(await tab.see()).step?.review; i++) await sleep(250);
      await tab.inCard("Send answers");
      for (let i = 0; i < 60 && !(await tab.click("Propose")); i++) await sleep(250);
      for (let i = 0; i < 40 && !tab.stubbed.some((x) => x.path === "/plan/propose"); i++) await sleep(250);
      return ((tab.stubbed.find((x) => x.path === "/plan/propose")?.body as Sent | undefined)?.asking?.rounds ?? []).flatMap((r) => r.asked);
    };
    const pressed = await unknownSent(() => tab.inCard("I don't know"));
    const typedUnknown = await unknownSent(async () => {
      await tab.typeInCard("textarea", "I don't know yet, I've only been here two weeks");
      await sleep(150);
      await tab.inCard((await tab.see()).step?.next ?? "Next");
    });
    check(pressed.length === 1 && pressed[0].how === "unknown" && typedUnknown.length === 1 && typedUnknown[0].how === "unknown", "\"I don't know\", pressed or typed, goes as that, never as their words", { pressed, typed: typedUnknown });

    // What was asked is remembered as it's answered: the picks and their words for the team, what they didn't know on this computer.
    type Remembered = { entries: { id: string; q: string; a: string; how: string; shared: boolean }[] };
    let mem: Remembered | null = null;
    for (let i = 0; i < 20 && !(mem = await tab.api<Remembered>("/memory"))?.entries.some((e) => e.how === "unknown"); i++) await sleep(250);
    const kinds = new Set((mem?.entries ?? []).map((e) => `${e.how}:${e.shared}`));
    check(kinds.has("pick:true") && kinds.has("own:true") && kinds.has("unknown:false"), "What was asked is remembered as it's answered: picks and their words for the team, what they didn't know on this computer", [...kinds]);
    const one = mem?.entries.find((e) => e.how === "own");
    if (one) await tab.js<boolean>(`fetch('/api/org/${tab.org}/memory/${one.id}', { method: 'DELETE' }).then((r) => r.ok)`);
    const after = await tab.api<Remembered>("/memory");
    check(!!one && !!after && !after.entries.some((e) => e.id === one.id), "Forget takes a line off what Qalam AI remembers", one?.q);

    // What was said before shows under a question like it, with Use it: their words go as theirs, a teammate's pick as Qalam AI's pick.
    tab.stubbed.length = 0;
    asks = 0;
    mode = "known";
    await tab.chat("What should we do about retention?");
    for (let i = 0; i < 60 && !(await tab.see()).step?.text; i++) await sleep(250);
    const shows = async (words: string) => tab.js<boolean>(`document.body.innerText.includes('Said before') && document.body.innerText.includes(${JSON.stringify(words)})`);
    const ownShown = await shows("You said “About 104%”");
    const usedOwn = await tab.inCard("Use it");
    await sleep(150);
    await tab.inCard((await tab.see()).step?.next ?? "Next");
    for (let i = 0; i < 20 && !(await tab.see()).step?.radios.length; i++) await sleep(250);
    const pickShown = await shows("Omar took Qalam AI's pick “Regulars”");
    const usedPick = await tab.inCard("Use it");
    await sleep(150);
    for (let i = 0; i < 20 && !(await tab.see()).step?.review; i++) {
      await tab.inCard((await tab.see()).step?.next ?? "Next");
      await sleep(250);
    }
    await tab.inCard("Send answers");
    for (let i = 0; i < 60 && !(await tab.click("Propose")); i++) await sleep(250);
    for (let i = 0; i < 40 && !tab.stubbed.some((x) => x.path === "/plan/propose"); i++) await sleep(250);
    const used = ((tab.stubbed.find((x) => x.path === "/plan/propose")?.body as Sent | undefined)?.asking?.rounds ?? []).flatMap((r) => r.asked);
    check(
      ownShown && pickShown && usedOwn && usedPick && used.length === 2 && used[0].answer === "About 104%" && used[0].how === "own" && used[1].answer === "Regulars" && used[1].how === "pick",
      "What was said before shows under the question, and Use it answers with it: their words as theirs, a pick as Qalam AI's pick",
      { ownShown, pickShown, used },
    );

    // What they answered lately isn't asked again: What we settled says what it knew, the plan hears it as it was given, and it isn't remembered anew.
    const nrrLines = async () => ((await tab.api<Remembered>("/memory"))?.entries ?? []).filter((e) => e.q === "What is net revenue retention today?").length;
    const nrrBefore = await nrrLines();
    tab.stubbed.length = 0;
    asks = 0;
    mode = "gated";
    await tab.chat("What should we do about retention this quarter?");
    let knewShown = false;
    for (let i = 0; i < 60 && !(knewShown = await tab.js<boolean>(`document.body.innerText.includes('What I already knew') && document.body.innerText.includes('About 104%')`)); i++) await sleep(250);
    const askedNone = !(await tab.see()).step;
    for (let i = 0; i < 60 && !(await tab.click("Propose")); i++) await sleep(250);
    for (let i = 0; i < 40 && !tab.stubbed.some((x) => x.path === "/plan/propose"); i++) await sleep(250);
    const gatedRounds = (tab.stubbed.find((x) => x.path === "/plan/propose")?.body as Sent | undefined)?.asking?.rounds ?? [];
    const nrrAfter = await nrrLines();
    check(
      knewShown && askedNone && gatedRounds.length === 1 && gatedRounds[0].by === "memory" && gatedRounds[0].asked.map((a) => `${a.answer}:${a.how}`).join("|") === "About 104%:own|Regulars:pick" && nrrAfter === nrrBefore,
      "What they answered lately isn't asked again: What we settled says what it knew, the plan hears it as given (a pick still a pick), and it isn't remembered anew",
      { nrrBefore, nrrAfter, knewShown, askedNone, gatedRounds },
    );
    mode = "first";

    // Help me find one: code's own question they answered yesterday comes back from the project's memory, and only the rest is asked.
    const seeded = await tab.js<boolean>(
      `fetch('/api/org/${tab.org}/memory/asked', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ flow: 'find', key: 'smoke-seed', about: { product: null }, answers: [{ qid: 'for-whom', q: 'What does the product do, and who is it for?', a: 'Groceries for new parents', how: 'own' }] }) }).then((r) => r.ok)`,
    );
    await tab.canvas("?find=goal");
    let openingKnew = false;
    for (let i = 0; i < 60 && !(openingKnew = await tab.js<boolean>(`document.body.innerText.includes("What you told me before, so I'm not asking again") && document.body.innerText.includes('Groceries for new parents')`)); i++) await sleep(250);
    const openingStep = (await tab.see()).step;
    check(seeded && openingKnew && openingStep?.title === "What is the team trying to change in the next few months?" && /of 3/.test(openingStep.label), "Help me find one doesn't ask again what they answered lately, says so, and asks the rest", { seeded, openingKnew, step: openingStep?.title, label: openingStep?.label });

    // The first run's hand-off: their words reach the chat's plan route on the canvas.
    tab.stubbed.length = 0;
    asks = 0;
    await tab.js(`sessionStorage.setItem("qalam/first-run/words", ${JSON.stringify(said)})`);
    await tab.canvas("?plan=1");
    for (let i = 0; i < 40 && !tab.stubbed.some((x) => x.path === "/plan/look"); i++) await sleep(250);
    const look = tab.stubbed.find((x) => x.path === "/plan/look")?.body as { said?: string } | undefined;
    check(look?.said === said, "The first run hands their words to the plan route", look?.said);
    check(!(await tab.js<string>(`location.search`)).includes("plan="), "The address is left clean", await tab.js(`location.search`));

    // The first run itself: the one box, then a sentence that names nothing.
    const box = `document.querySelector('textarea[aria-label="What you\\'re working on"]')`;
    const typeInBox = async (words: string) => {
      for (let i = 0; i < 60 && !(await tab.js<boolean>(`!!${box}`)); i++) await sleep(250);
      await tab.js(`${box}?.focus()`);
      await tab.type(words);
      await tab.press("Enter");
    };
    tab.stubbed.length = 0;
    asks = 0;
    await tab.go("/welcome?new=1");
    for (let i = 0; i < 60 && !(await tab.js<boolean>(`!!${box}`)); i++) await sleep(250);
    check(await tab.js<boolean>(`!!${box}`), "The first run is one box", (await tab.see()).buttons.slice(0, 6));
    await typeInBox(said);
    for (let i = 0; i < 120 && !tab.stubbed.some((x) => x.path === "/plan/look"); i++) await sleep(250);
    const route = tab.stubbed.map((x) => x.path);
    const named = tab.stubbed.find((x) => x.path === "/api/start/read")?.body as { said?: string } | undefined;
    const first = tab.stubbed.find((x) => x.path === "/plan/look")?.body as { said?: string } | undefined;
    check(named?.said === said, "It asks whether the sentence names anything, before anything is read", route);
    check(first?.said === said, "It lands on the canvas's chat, working it out with their words", first?.said);
    check(!tab.bodies.some((b) => b.path === "scan" && (b.body as { target?: unknown }).target), "No scan was started", tab.bodies.map((b) => b.path));
    const name = await tab.js<string>(`document.body.innerText.includes("My project")`);
    check(!!name, "The project is called My project, not their sentence", name);
    await tab.shot(path.join(out, "3-first-run.png"));

    // Someone who explains their idea: the project is named from it, and what's read is everything they said.
    const orgs = async () => ((await (await fetch(`http://127.0.0.1:${3235}/api/orgs`)).json()) as { orgs: { id: string; name: string }[] }).orgs;
    const before = (await orgs()).length;
    const explained = "Something to help freelancers chase the invoices their clients pay late, so they stop doing it by hand";
    tab.stubbed.length = 0;
    await tab.go("/welcome?new=1");
    await typeInBox(explained);
    for (let i = 0; i < 80 && !tab.stubbed.some((x) => x.path === "/scan" && (x.body as { target?: unknown } | null)?.target); i++) await sleep(250);
    const made = await orgs();
    check(made.length === before + 1 && made.some((o) => o.name === "Freelancer invoice chasing"), "The project is named from what they explained, not their sentence", made.map((o) => o.name));
    const scanned = tab.stubbed.filter((x) => x.path === "/scan").map((x) => x.body as { target?: { kind: string; said?: string } } | null).find((b) => b?.target);
    check(scanned?.target?.said === explained, "What's read is everything they explained", scanned?.target);
    check(!tab.stubbed.some((x) => x.path === "/scan/named"), "What the box read already isn't asked again on the canvas", tab.stubbed.map((x) => x.path));
    for (let i = 0; i < 40 && !(await tab.js<boolean>(`document.body.innerText.includes("Freelancer invoice chasing")`)); i++) await sleep(250);
    check(await tab.js<boolean>(`document.body.innerText.includes("Freelancer invoice chasing")`), "The canvas says what it's called", await tab.js(`document.body.innerText.slice(0, 200)`));
    await tab.shot(path.join(out, "4-named.png"));

    // At a company, a sentence about their product: read for its name, theirs, never refused.
    tab.stubbed.length = 0;
    await tab.go("/welcome?new=1");
    await typeInBox("Our product is Basket, our grocery app for parents who reorder every week");
    for (let i = 0; i < 80 && !tab.stubbed.some((x) => x.path === "/scan" && (x.body as { target?: unknown } | null)?.target); i++) await sleep(250);
    const company = tab.stubbed.filter((x) => x.path === "/scan").map((x) => x.body as { target?: unknown } | null).find((b) => b?.target);
    check(JSON.stringify(company?.target) === JSON.stringify({ kind: "product", name: "Basket", mine: true }), "A sentence about their product reads its name out of it, and it's theirs", company?.target);
    check(!tab.errors.length, "No errors in the window", tab.errors.slice(0, 3));
    console.log(`\n${failed ? `${failed} failed` : "All as expected"} · no model calls · ${out}`);
  } finally {
    await tab.stop();
  }
}

main().then(
  () => process.exit(failed ? 1 : 0),
  (e) => {
    console.error(e instanceof Error ? e.stack : e);
    process.exit(1);
  },
);
