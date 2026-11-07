import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PlanQuestion } from "@/ai/plan";
import { OrgStore } from "../../server/org/store";
import type { Player } from "./player";
import { seedOrg } from "./seed";
import type { Persona } from "./types";

/**
 * The real app, driven over raw Chrome DevTools: the flows whose logic lives in the window (a brain
 * dump, Help me find one, a card's questions first). It reads what a person reads and presses what they
 * press, so it also finds what a person would get stuck on: a stretch with no question, no sign of work
 * and nothing to press is a dead end, and it's recorded rather than waited out.
 */

const CHROME = path.join(os.homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DEAD_MS = 60_000;
const LIMIT_MS = 12 * 60_000;

interface Seen {
  step: { label: string; title: string; review: boolean; radios: { label: string; on: boolean; rec: boolean }[]; checks: { label: string; on: boolean }[]; text: boolean; other: boolean; skip: boolean; next: string } | null;
  buttons: string[];
  busy: boolean;
  alert: string;
  /** What we settled is showing: its verb (Propose, Place it on the canvas, Draft them…), the button before "Something's off". */
  settle: string | null;
  /** A lookup put to them after two turns of only looking: Look it up, or Ask me instead. */
  offer: boolean;
}

/** The question's own card: what's typed goes in its boxes, never in another panel's (a card's Notes or Evidence). */
const QUESTION_CARD = `(() => { const live = [...document.querySelectorAll('span[aria-live="polite"]')].find((s) => /Step \\d+ of \\d+|Review/.test(s.textContent)); return live && live.closest('.q-rise'); })()`;

/** Focuses a box inside the question's card: true when there was one. */
const focusInCard = (selector: string) => `(() => {
  const card = ${QUESTION_CARD};
  const box = card && [...card.querySelectorAll(${JSON.stringify(selector)})].filter((x) => x.getBoundingClientRect().width > 0).at(-1);
  if (!box) return false;
  box.focus();
  return document.activeElement === box;
})()`;

/** The last What we settled card showing, if any. */
const SETTLED_CARD = `[...document.querySelectorAll('.q-sheet')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && /What we settled/.test(el.innerText); }).at(-1)`;

const SEE = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const buttons = [...document.querySelectorAll('button')].filter(vis).map((b) => (b.innerText || '').trim().replace(/\\s+/g, ' ')).filter(Boolean);
  const live = [...document.querySelectorAll('span[aria-live="polite"]')].find((s) => /Step \\d+ of \\d+|Review/.test(s.textContent));
  let step = null;
  if (live) {
    let card = live;
    while (card && !card.querySelector('button') ) card = card.parentElement;
    card = live.closest('.q-rise') || card;
    const review = /Review/.test(live.textContent);
    const title = card.querySelector('p[dir="auto"]')?.textContent?.trim() ?? '';
    const radios = [...card.querySelectorAll('button[role="radio"]')].map((b) => ({ label: (b.querySelector('.text-body')?.textContent ?? b.innerText).trim(), on: b.getAttribute('aria-checked') === 'true', rec: /Recommended/.test(b.innerText) }));
    const checks = [...card.querySelectorAll('[role="checkbox"]')].map((b) => ({ label: (b.closest('label')?.innerText ?? '').trim().split('\\n')[0], on: b.getAttribute('aria-checked') === 'true' }));
    const own = [...card.querySelectorAll('button')].map((b) => b.innerText.trim().split('\\n')[0]);
    step = { label: live.textContent, title, review, radios: radios.filter((r) => r.label !== 'Something else…'), checks, text: !!card.querySelector('textarea'), other: radios.some((r) => r.label === 'Something else…'), skip: own.includes('Skip'), next: own.at(-1) ?? 'Next' };
  }
  const alert = [...document.querySelectorAll('[role="alert"]')].filter(vis).map((a) => a.innerText.trim()).join(' | ');
  const settled = ${SETTLED_CARD};
  const own = settled ? [...settled.querySelectorAll('button')].filter((b) => vis(b) && !b.disabled).map((b) => b.innerText.trim()) : [];
  const at = own.indexOf("Something's off");
  const settle = at > 0 ? own[at - 1] : null;
  const offer = buttons.includes('Look it up') && buttons.includes('Ask me instead');
  return JSON.stringify({ step, buttons, busy: buttons.some((b) => b === 'Stop' || b.startsWith('Stop ')) || !!document.querySelector('[aria-busy="true"]'), alert, settle, offer });
})()`;

export class Tab {
  server?: ChildProcess;
  chrome?: ChildProcess;
  ws?: WebSocket;
  private n = 0;
  private wait = new Map<number, (d: any) => void>();
  private profile?: string;
  private answers = new Map<string, string>();
  /** The discovery route's answers, whole. */
  raw: string[] = [];
  /** What the window sent, for the two-way check. */
  bodies: { path: string; body: unknown; at: number }[] = [];
  errors: string[] = [];
  deadEnds: { at: string; seen: string }[] = [];
  /** Cards that wouldn't take "I don't know", and what had to be picked to get past them. */
  forced: { flow: string; question: string; alert: string; took: string }[] = [];
  log: string[] = [];
  base = "";
  org = "";

  constructor(private p: Persona, private player: Player, private home: string, private port: number, private cwd: string) {}

  private say(line: string) {
    this.log.push(line);
    console.log(`    ${line.slice(0, 150)}`);
  }

  /** An organization ready to open, with no first run in the way. */
  async prepare() {
    await mkdir(this.home, { recursive: true });
    const dir = path.join(this.home, this.p.org.name);
    // As long as a real one (newOrgId): the window's routes know them by their shape.
    this.org = `stress${this.p.id}`;
    const store = await OrgStore.create(dir, { id: this.org, name: this.p.org.name, createdAt: Date.now(), shape: this.p.org.shape === "solo" ? "solo" : "team" } as never);
    if (this.p.org.about || this.p.org.audience) await store.putAbout({ context: this.p.org.about ?? "", audience: this.p.org.audience ?? "", segments: [] });
    await seedOrg(store, this.p);
    await store.finishFirstRun();
    store.dispose();
    // As a real first run leaves it: Claude Code chosen, the welcome done.
    await mkdir(path.join(this.home, ".qalam"), { recursive: true });
    await writeFile(path.join(this.home, ".qalam", "settings.json"), JSON.stringify({ engine: "cli", welcomedAt: Date.now() }));
  }

  async start() {
    this.server = spawn("npx", ["vite", "--port", String(this.port), "--strictPort"], { cwd: this.cwd, env: { ...process.env, QALAM_HOME: this.home, QALAM_NO_MODELS: process.env.QALAM_NO_MODELS ?? "1", RATE_LIMIT_PER_10_MIN: "1000" }, stdio: ["ignore", "pipe", "pipe"], detached: true });
    this.base = `http://${this.p.id}.localhost:${this.port}`;
    for (let i = 0; i < 120; i++) {
      await sleep(500);
      const up = await fetch(`http://127.0.0.1:${this.port}/api/health`, { headers: { host: `${this.p.id}.localhost:${this.port}` } }).then((r) => r.status, () => 0);
      if (up && up < 500) break;
      if (i === 119) throw new Error("The dev server didn't come up.");
    }
    const debug = 9400 + Math.floor(Math.random() * 400);
    this.profile = mkdtempSync(path.join(os.tmpdir(), "qalam-tab-"));
    this.chrome = spawn(CHROME, [`--remote-debugging-port=${debug}`, "--remote-allow-origins=*", `--user-data-dir=${this.profile}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-first-run", "about:blank"], { stdio: "ignore" });
    let tab: { webSocketDebuggerUrl: string } | undefined;
    for (let i = 0; i < 60 && !tab; i++) {
      tab = await fetch(`http://127.0.0.1:${debug}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json() as Promise<{ webSocketDebuggerUrl: string }>, () => undefined);
      if (!tab) await sleep(250);
    }
    if (!tab) throw new Error("Chrome didn't come up.");
    this.ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((r) => (this.ws!.onopen = r));
    this.ws.onmessage = (m) => {
      const d = JSON.parse(String(m.data));
      if (d.id && this.wait.has(d.id)) {
        this.wait.get(d.id)!(d);
        this.wait.delete(d.id);
      }
      if (d.method === "Fetch.requestPaused") this.onPaused?.(d);
      if (d.method === "Runtime.exceptionThrown") this.errors.push(String(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text).slice(0, 300));
      // A model's raw answer, as the window receives it, to see what code kept of it.
      if (d.method === "Network.responseReceived" && /\/api\/discovery/.test(d.params.response.url)) this.answers.set(d.params.requestId, "");
      if (d.method === "Network.loadingFinished" && this.answers.has(d.params.requestId)) {
        void this.send("Network.getResponseBody", { requestId: d.params.requestId }).then((r) => this.raw.push(String(r?.body ?? "")));
      }
      if (d.method === "Network.requestWillBeSent") {
        const { url, postData, hasPostData } = d.params.request;
        const at = /\/api\/org\/[^/]+\/(plan\/\w+|scan|briefs|goals\/[^/]+\/focus)|\/api\/(discovery)/.exec(url);
        const keep = (text: string) => {
          try {
            this.bodies.push({ path: at![1] ?? at![2], body: JSON.parse(text), at: Date.now() });
          } catch {
            // Not JSON: nothing to compare.
          }
        };
        if (at && postData) keep(postData);
        // A long body doesn't come along with the event, and has to be asked for.
        else if (at && hasPostData) void this.send("Network.getRequestPostData", { requestId: d.params.requestId }).then((r) => r?.postData && keep(r.postData));
      }
    };
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Network.enable");
    await this.send("DOM.enable");
    await this.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await this.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  }

  /** One call to the browser. A reply that never comes (it happens, rarely) gives nothing after a while, so a walk or a paid run can't hang on it. */
  private send(method: string, params: Record<string, unknown> = {}, ms = 60_000): Promise<any> {
    return new Promise((r) => {
      const id = ++this.n;
      const timer = setTimeout(() => {
        if (!this.wait.delete(id)) return;
        console.log(`    (the browser didn't answer ${method} in ${ms / 1000}s)`);
        r(undefined);
      }, ms);
      this.wait.set(id, (d) => {
        clearTimeout(timer);
        r(d.result);
      });
      this.ws!.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Answers these routes in the browser, so the window can be checked with no model call: each gets its
   * JSON as the stream's result, and what was sent is kept in `stubbed`.
   */
  stubbed: { path: string; body: unknown }[] = [];
  async stub(routes: Record<string, (body: any) => unknown>) {
    // Only the server's routes: a module's own address (/src/scan/…) must load as it is.
    const api = (r: string) => (r.startsWith("/api/") ? r : `/api/*${r}`);
    await this.send("Fetch.enable", { patterns: Object.keys(routes).map((r) => ({ urlPattern: `*${api(r)}*`, requestStage: "Request" })) });
    // A route may answer later (a promise): a slow lookup, while the round shows.
    this.onPaused = async (d) => {
      const url: string = d.params.request.url;
      const route = url.includes("/api/") ? Object.keys(routes).find((r) => url.includes(r)) : undefined;
      const body = d.params.request.postData ? JSON.parse(d.params.request.postData) : null;
      if (route) this.stubbed.push({ path: route, body });
      const data = route ? await routes[route](body) : null;
      // Only a plan's steps stream; the rest answer in plain JSON.
      const plain = !route?.startsWith("/plan/");
      const text = plain ? JSON.stringify(data) : `${JSON.stringify({ type: "result", data })}\n`;
      void this.send("Fetch.fulfillRequest", { requestId: d.params.requestId, responseCode: 200, responseHeaders: [{ name: "content-type", value: plain ? "application/json" : "application/x-ndjson" }], body: Buffer.from(text).toString("base64") });
    };
  }
  private onPaused?: (d: any) => void;

  async js<T = unknown>(expression: string): Promise<T> {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r?.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 300));
    return r?.result?.value as T;
  }

  see = async (): Promise<Seen> => JSON.parse(await this.js<string>(SEE));

  async go(pathAndQuery: string) {
    await this.send("Page.navigate", { url: `${this.base}${pathAndQuery}` });
    for (let i = 0; i < 120; i++) {
      await sleep(500);
      const ready = await this.js<boolean>(`document.readyState === 'complete' && !!document.querySelector('textarea, button')`).catch(() => false);
      if (ready) break;
    }
    await sleep(2500);
  }

  canvas = (query = "") => this.go(`/o/${this.org}${query}`);

  async press(key: string) {
    await this.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: key === "Enter" ? 13 : 0, text: key === "Enter" ? "\r" : undefined });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: key === "Enter" ? 13 : 0 });
  }

  /** Clicks a visible button by what it says: exactly, else what it starts with. */
  async click(label: string): Promise<boolean> {
    const l = JSON.stringify(label);
    return this.js<boolean>(`(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const all = [...document.querySelectorAll('button')].filter((b) => vis(b) && !b.disabled);
      const said = (b) => (b.innerText || '').trim().replace(/\\s+/g, ' ');
      const b = all.find((x) => said(x) === ${l}) || all.find((x) => said(x).startsWith(${l}));
      if (!b) return false;
      b.click();
      return true;
    })()`);
  }

  /** Types into a box of the question's own card (`selector`): false, and nothing typed, when it has none. */
  async typeInCard(selector: string, text: string): Promise<boolean> {
    if (!(await this.js<boolean>(focusInCard(selector)))) return false;
    await this.send("Input.insertText", { text });
    return true;
  }

  /** Presses What we settled's verb, inside its own card: the same words elsewhere (a card's next steps) mustn't answer for it. */
  async goOnSettled(): Promise<boolean> {
    return this.js<boolean>(`(() => {
      const card = ${SETTLED_CARD};
      if (!card) return false;
      const all = [...card.querySelectorAll('button')].filter((b) => !b.disabled);
      const at = all.findIndex((b) => b.innerText.trim() === "Something's off");
      if (at < 1) return false;
      all[at - 1].click();
      return true;
    })()`);
  }

  /** Types where the caret is. */
  type = (text: string) => this.send("Input.insertText", { text });

  /** Clicks inside the question's own card: a tour's Next or another panel's Skip must not answer for it. */
  async inCard(label: string): Promise<boolean> {
    const l = JSON.stringify(label);
    return this.js<boolean>(`(() => {
      const live = [...document.querySelectorAll('span[aria-live="polite"]')].find((s) => /Step \\d+ of \\d+|Review/.test(s.textContent));
      const card = live && live.closest('.q-rise');
      if (!card) return false;
      const said = (b) => (b.closest('label')?.innerText || b.innerText || '').trim().split('\\n')[0];
      const all = [...card.querySelectorAll('button')].filter((b) => !b.disabled);
      const b = all.find((x) => said(x) === ${l}) || all.find((x) => said(x).startsWith(${l}));
      if (!b) return false;
      b.click();
      return true;
    })()`);
  }

  /** Types into the chat's box and sends. */
  async chat(text: string) {
    const ok = await this.js<boolean>(`(() => {
      const t = [...document.querySelectorAll('textarea')].filter((x) => x.getBoundingClientRect().width > 0)[0];
      if (!t) return false;
      t.focus();
      return true;
    })()`);
    if (!ok) throw new Error("No box to type in.");
    await this.send("Input.insertText", { text });
    await sleep(200);
    await this.press("Enter");
    this.say(`said: ${text}`);
  }

  async attach(files: string[]) {
    const { root } = await this.send("DOM.getDocument", { depth: 1 });
    const { nodeId } = await this.send("DOM.querySelector", { nodeId: root.nodeId, selector: 'input[type="file"]' });
    if (!nodeId) throw new Error("Nowhere to add a file.");
    await this.send("DOM.setFileInputFiles", { nodeId, files });
    await sleep(3000);
  }

  /** Answers what's on screen, one step, as the player would. */
  private async answerStep(s: NonNullable<Seen["step"]>, round: number, flow: string) {
    if (s.review) {
      await this.inCard(s.next);
      return;
    }
    const options = [...s.radios.map((r) => r.label), ...s.checks.map((c) => c.label)];
    const rec = s.radios.filter((r) => r.rec).map((r) => r.label);
    const q: PlanQuestion = { id: "q", title: s.title, why: "", multi: s.checks.length > 0, options: options.map((label, i) => ({ value: `o${i}`, label, description: "" })), recommended: options.flatMap((l, i) => (rec.includes(l) ? [`o${i}`] : [])), allowOther: s.other };
    const got = (await this.player.fill([q], { flow, round })).q ?? "";
    const line = this.player.ledger.at(-1)!;
    this.say(`Q: ${s.title} [${options.join(" | ")}] → ${line.how}: ${got}`);
    if (line.how === "enter" || (line.how === "skip" && !s.skip)) {
      await this.inCard(s.next);
      return;
    }
    if (line.how === "skip") {
      await this.inCard("Skip");
      return;
    }
    if (s.radios.length) {
      const hit = s.radios.find((r) => r.label === got);
      if (hit) {
        await this.inCard(hit.label);
        await sleep(150);
        await this.inCard(s.next);
        return;
      }
      if (s.other) {
        await this.inCard("Something else…");
        await sleep(250);
        if (!(await this.typeInCard('input[aria-label="Your answer"]', got))) this.say(`  (no box in the card to type "${got}" into)`);
        await sleep(150);
        await this.inCard(s.next);
        return;
      }
      // Nothing fits and it takes no words of its own: what's shown stands.
      await this.inCard(s.next);
      return;
    }
    if (s.checks.length) {
      const hits = s.checks.filter((c) => got.includes(c.label));
      for (const c of s.checks) if (c.on !== hits.includes(c)) await this.inCard(c.label);
      if (!hits.length && got) {
        // Their own words, where the card takes them.
        const typed = await this.typeInCard('input[placeholder="Add your own"]', got);
        if (typed) {
          await sleep(100);
          await this.press("Enter");
        }
      }
      await sleep(150);
      await this.inCard(s.next);
      return;
    }
    if (s.text) {
      if (!(await this.typeInCard("textarea", got))) this.say(`  (no box in the card to type "${got}" into)`);
      await sleep(150);
      await this.inCard(s.next);
      return;
    }
    await this.inCard(s.next);
  }

  /**
   * Answers whatever it asks until one of these buttons shows. Long quiet is a dead end only when
   * nothing says it's working; a stuck run ends rather than hangs.
   */
  async until(labels: string[], flow: string): Promise<string | null> {
    const began = Date.now();
    let quiet = Date.now();
    let round = 0;
    let last = "";
    let refused = 0;
    let settledAt = 0;
    while (Date.now() - began < LIMIT_MS) {
      const s = await this.see();
      const hit = labels.find((l) => s.buttons.some((b) => b === l || b.startsWith(l)));
      if (hit) return hit;
      // What we settled: they read it and go on, as someone with nothing to correct does. Once, while it's on its way.
      if (s.settle && Date.now() - settledAt > 20_000) {
        settledAt = Date.now();
        this.say(`What we settled → ${s.settle}`);
        await this.goOnSettled();
        await sleep(1500);
        quiet = Date.now();
        continue;
      }
      // An opening whose every question they answered lately (src/memory/gate.ts): what they said still holds, so they go on.
      if (!s.step && s.buttons.includes("Go on with these")) {
        this.say("Answered before → Go on with these");
        await this.click("Go on with these");
        await sleep(1500);
        quiet = Date.now();
        continue;
      }
      // A lookup put to them: they say look it up, as the bench's in-process person does.
      if (s.offer) {
        this.say("A lookup put to them → Look it up");
        await this.click("Look it up");
        await sleep(1500);
        quiet = Date.now();
        continue;
      }
      const id = s.step ? `${s.step.label}|${s.step.title}|${s.step.review}` : "";
      if (s.step && id !== last) {
        last = id;
        refused = 0;
        if (/Step 1 of/.test(s.step.label)) round++;
        await this.answerStep(s.step, round - 1, flow);
        await sleep(600);
        quiet = Date.now();
        continue;
      }
      if (s.step && s.alert) {
        // The card won't go on with what they said. A person who doesn't know has to pick a guess to get past it: it's kept as a finding.
        refused++;
        const first = s.step.radios[0]?.label ?? s.step.checks[0]?.label;
        this.forced.push({ flow, question: s.step.title, alert: s.alert, took: refused === 1 ? (first ?? "") : "" });
        this.say(`refused: "${s.step.title}": ${s.alert}. ${refused === 1 && first ? `Picking "${first}" to get past it.` : "Stuck."}`);
        if (refused === 1 && first) {
          await this.inCard(first);
          this.player.ledger.push({ flow, round: Math.max(0, round - 1), question: s.step.title, options: [...s.step.radios.map((r) => r.label), ...s.step.checks.map((c) => c.label)], facts: [], unknowns: [], how: "enter", answer: first, active: false });
          await sleep(200);
          await this.inCard(s.step.next);
          await sleep(800);
          continue;
        }
        this.deadEnds.push({ at: flow, seen: `The card won't go on: ${s.alert} (${s.step.title})` });
        return null;
      }
      // A question that stays as it was with nothing working (a review it won't send on) is a dead end too.
      if (s.busy) quiet = Date.now();
      if (Date.now() - quiet > DEAD_MS) {
        const seen = `No question, no sign of work, none of [${labels.join(", ")}]. Showing: ${s.buttons.slice(0, 18).join(" | ")}${s.alert ? ` · ${s.alert}` : ""}`;
        this.deadEnds.push({ at: flow, seen });
        this.say(`DEAD END in ${flow}: ${seen}`);
        return null;
      }
      await sleep(1000);
    }
    this.deadEnds.push({ at: flow, seen: "Still going after the limit." });
    return null;
  }

  /** What's on the canvas: every card with where it hangs, from the app's own document. */
  async cards(): Promise<{ id: string; kind: string; title: string; description: string; parent: string | null; assumptions: string[]; test: string }[]> {
    return JSON.parse(await this.js<string>(`(async () => {
      const urls = performance.getEntriesByType('resource').map((e) => e.name);
      const m = await import(urls.find((u) => /\\/src\\/doc\\/store\\.ts/.test(u)));
      const d = m.studio().doc;
      const out = Object.keys(d.nodes).filter((k) => d.nodes[k].meta?.ost).map((k) => { const c = d.nodes[k].meta.ost; return { id: k, kind: c.kind, title: c.title, description: c.description ?? '', parent: d.nodes[k].parentId, assumptions: (c.assumptions ?? []).map((a) => a.text), test: c.test ? [c.test.method, c.test.suggested?.criterion].filter(Boolean).join(' · ') : '' }; });
      return JSON.stringify(out);
    })()`));
  }

  /** What the chat says, top to bottom, as a person reads it. */
  thread = () => this.js<string>(`(() => { const b = [...document.querySelectorAll('[class*="q-glass"], aside')].sort((a, c) => c.innerText.length - a.innerText.length)[0]; return (b || document.body).innerText; })()`);

  async api<T>(p: string): Promise<T | null> {
    return fetch(`http://127.0.0.1:${this.port}/api/org/${this.org}${p}`, { headers: { host: `${this.p.id}.localhost:${this.port}` } }).then((r) => (r.ok ? (r.json() as Promise<T>) : null), () => null);
  }

  async shot(file: string) {
    const r = await this.send("Page.captureScreenshot", { format: "png" }, 20_000);
    if (r?.data) await writeFile(file, Buffer.from(r.data, "base64"));
  }

  async stop() {
    try {
      this.ws?.close();
    } catch {}
    try {
      this.chrome?.kill("SIGKILL");
    } catch {}
    if (this.server?.pid) {
      try {
        process.kill(-this.server.pid, "SIGKILL");
      } catch {}
    }
    // Chrome may still be writing as it goes: a scratch folder left behind harms nothing.
    await sleep(500);
    if (this.profile) {
      try {
        rmSync(this.profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
      } catch {}
    }
  }
}

const briefLabels = ["Write a brief", "Word the message", "Steps to run"];

async function readBrief(tab: Tab): Promise<string> {
  const list = await tab.api<{ briefs: { id: string; title: string }[] }>("/briefs");
  const b = list?.briefs.at(-1);
  if (!b) return "";
  const got = await tab.api<{ body?: string; markdown?: string; brief?: { body?: string } }>(`/briefs/${encodeURIComponent(b.id)}`);
  return got?.body ?? got?.markdown ?? got?.brief?.body ?? "";
}

/** Waits until a brief is on file, answering what it asks on the way. */
async function untilBrief(tab: Tab, flow: string): Promise<string> {
  const began = Date.now();
  while (Date.now() - began < 5 * 60_000) {
    const s = await tab.see();
    if (s.step) await tab.until(["Copy", "Open it", "Its brief"], flow);
    const body = await readBrief(tab);
    if (body) return body;
    await sleep(2000);
  }
  return "";
}

export interface TabResult {
  cards: Awaited<ReturnType<Tab["cards"]>>;
  thread: string;
  brief: string;
  deadEnds: Tab["deadEnds"];
  forced: Tab["forced"];
  errors: string[];
  bodies: Tab["bodies"];
  log: string[];
}

async function finish(tab: Tab, out: string): Promise<TabResult> {
  const cards = await tab.cards().catch(() => []);
  const thread = await tab.thread().catch(() => "");
  const brief = await readBrief(tab);
  await tab.shot(path.join(out, "end.png")).catch(() => {});
  await writeFile(path.join(out, "discovery-answers.json"), JSON.stringify(tab.raw, null, 1)).catch(() => {});
  return { cards, thread, brief, deadEnds: tab.deadEnds, forced: tab.forced, errors: tab.errors, bodies: tab.bodies, log: tab.log };
}

/** The chat's plan route, as a person reaches it by asking. Accepts what it proposes and briefs where it says to start. */
export async function tabPlan(tab: Tab, said: string, out: string): Promise<TabResult> {
  await tab.canvas();
  await tab.chat(said);
  const hit = await tab.until(["Accept all", "Work it out as a plan"], "plan");
  if (hit === "Work it out as a plan") {
    await tab.click(hit);
    await tab.until(["Accept all"], "plan");
  }
  if (await tab.click("Accept all")) await sleep(4000);
  const cards = await tab.cards();
  const sol = cards.find((c) => c.kind === "solution");
  if (sol) {
    await tab.canvas(`?card=${encodeURIComponent(sol.id)}`);
    const b = await tab.until(briefLabels, "brief");
    if (b) {
      await tab.click(b);
      await untilBrief(tab, "brief");
    }
  }
  return finish(tab, out);
}

/** A1: the goal typed, added, and worked on with its own next steps: the road the app lays for someone who knows their goal. */
export async function tabFocus(tab: Tab, p: Persona, out: string): Promise<TabResult> {
  await tab.canvas();
  await tab.chat(p.opener);
  const chip = await tab.until(["Add as a goal"], "add");
  if (chip) await tab.click(chip);
  const worded = await tab.until(["Use it", "Keep my words", "Find the problem to focus on"], "add");
  if (worded && worded !== "Find the problem to focus on") await tab.click("Use it");
  await sleep(4000);
  return afterGoal(tab, out);
}

async function afterGoal(tab: Tab, out: string): Promise<TabResult> {
  const goal = (await tab.cards()).find((c) => c.kind === "outcome");
  if (goal) {
    await tab.canvas(`?card=${encodeURIComponent(goal.id)}`);
    const focus = await tab.until(["Find the problem to focus on"], "focus");
    if (focus) {
      await tab.click(focus);
      const done = await tab.until(["Accept all", "Discard all"], "focus");
      if (done) await tab.click("Accept all");
      await sleep(5000);
    }
  }
  const problem = (await tab.cards()).find((c) => c.kind === "opportunity");
  if (problem) {
    await tab.canvas(`?card=${encodeURIComponent(problem.id)}`);
    const draft = await tab.until(["Draft solutions"], "draft");
    if (draft) {
      await tab.click(draft);
      const done = await tab.until(["Accept all"], "draft");
      if (done) await tab.click("Accept all");
      await sleep(5000);
    }
  }
  const sol = (await tab.cards()).find((c) => c.kind === "solution");
  if (sol) {
    await tab.canvas(`?card=${encodeURIComponent(sol.id)}`);
    const b = await tab.until(briefLabels, "brief");
    if (b) {
      await tab.click(b);
      await untilBrief(tab, "brief");
    }
  }
  return finish(tab, out);
}

/** B1: Help me find a goal, the road the empty canvas offers someone who doesn't have one. */
export async function tabFind(tab: Tab, out: string): Promise<TabResult> {
  await tab.canvas();
  const open = await tab.until(["Help me find a goal", "Help me find one"], "find");
  if (open) await tab.click(open);
  const done = await tab.until(["Accept all", "Accept"], "find");
  if (done) await tab.click(done);
  await sleep(4000);
  return afterGoal(tab, out);
}

/** A2: everything they have in one message, then the question they came with. */
export async function tabDocs(tab: Tab, p: Persona, fixtures: string, out: string): Promise<TabResult> {
  await tab.canvas();
  await tab.attach((p.docs ?? []).map((d) => path.join(fixtures, d)));
  await tab.chat(p.opener);
  // Taken in: wait till the problem pages it filed are there.
  const began = Date.now();
  for (;;) {
    const needs = await tab.api<{ needs: unknown[] }>("/needs");
    const s = await tab.see();
    if ((needs?.needs.length && !s.busy) || Date.now() - began > 8 * 60_000) break;
    await sleep(3000);
  }
  await sleep(3000);
  return tabPlan(tab, p.planSaid ?? p.opener, out);
}
