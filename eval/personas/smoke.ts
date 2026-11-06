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
let mode: "first" | "many" = "first";

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
    let settled = false;
    for (let i = 0; i < 60 && !(settled = await tab.click("Propose")); i++) await sleep(250);
    check(settled, "What we settled shows before anything is proposed, with Propose");
    for (let i = 0; i < 40 && !tab.stubbed.some((x) => x.path === "/plan/propose"); i++) await sleep(250);
    type Sent = { asking?: { rounds: { asked: { answer: string; how: string }[] }[] } };
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
    mode = "first";

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
