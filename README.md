# Qalam Studio

Describe what you want to build, or name a product. Qalam Studio reads what people complain about, ranks the problems, works out who to build for and what to build first, and writes the brief for your coding agent. It runs on your own Claude Code or Codex, on your own computer.

Every quote links to where it was said, and there's no Qalam account or server.

Qalam Studio is built by Ahmed Amr.

## Try it

```bash
npx qalam-studio
```

You need Node 22.12 or newer. The first run downloads the desktop shell, about 390 MB and a minute and a half. Then Qalam looks for Claude Code or Codex on your computer, signed in with your own account, and asks one thing: what you want to build, or which product to look at.

Nothing set up yet, or no idea at hand? **Try it with a sample** opens a made-up project with its problems ranked. It needs no engine and spends no tokens.

There's also a [Mac app](#the-mac-app), and you can run it [from source](#from-source).

## What you get

1. **Say what you're working on.** A product at a company, by its name, website or App Store link, or your own idea, in your words.
2. **It reads the space.** What people already complain about, in App Store reviews, on Hacker News and on forums, then what others offer and charge and what's been published. While it reads, it asks a few questions so it looks in the right place. It takes about 5 minutes, and keeps going if you close the window.
3. **Problems, ranked.** One page per problem, each line linked to the quotes behind it, best backed first, and each on the canvas. It says plainly when it found little, rather than padding it out.
4. **Who to build for, and what first.** Two or three audiences backed by what people said, for you to pick from. A first goal about learning, such as "5 of 10 of these people sign up". Then one thing to build for one problem, why that one, what to leave for later, the riskiest assumption and one test. It's called the strongest signal so far, because that's all it is.
5. **A brief for your coding agent.** Features with what "done" means for each, what backs them, and what has to be true for them to work, as Markdown to copy or a file to hand over. Any goal, problem or solution on the canvas can get one.
6. **Something to share.** A picture of what it found and a one-file report, each shown to you before anything goes anywhere.

What people say in public is a strong signal, not proof, so it stays under **We believe** until your own customers say it too.

### With what you already have

Bring anything to the chat beside the canvas, in a project of its own or one you already scanned:

- **Any document** (pasted, or as PDF, Word, Markdown, CSV or XLSX files) is read for what it states: people said, measured, studied, read elsewhere, or your own thinking. It's filed into the problem pages, and you can correct what it decided.
- **Your own thinking** is a brain dump. Qalam AI says what it took from it, pushes back where it won't hold up, asks a few rounds of questions, and proposes cards for the canvas.
- **A goal or a problem in your words** is worded as a proper statement for you to use, edit, or replace with your own.
- **A question** is answered from everything there, with each quote checked.

On the canvas, **Draft solutions** on a problem proposes two to four, each with its riskiest assumptions and one test. **Find the problem to focus on** on a goal looks on the web for what usually keeps goals like it from moving, asks you about it, and proposes the problems to work on first. Notion and analytics tools (PostHog, Amplitude, Mixpanel) can be connected in Connections, and a question that one could answer offers it.

Arabic and English both work, and there's a mic in every box.

## What it can't do yet

- **Reddit isn't read.** Reports say its public access is closing, and reading it without permission would go against its policy. Paste a thread into the chat and it's read like anything else.
- **Many sites turn readers away.** A scan says how many it couldn't read. Most of what's read comes from Hacker News, forums and articles.
- **App Store reviews come and go.** Apple's public feed often comes back empty for an app, so a scan may have none even for a big one. A competitor's reviews are also left out when they say nothing about your problem.
- **A run isn't small.** From the box to the brief, one used about 160,000 tokens on Claude Code and about 320,000 on Codex, against your own plan. On ChatGPT's Free plan it's told to slow down along the way, and waits.
- **It hasn't been run by many people yet.** Expect rough edges. Issues and pull requests are welcome.

## How it keeps the AI honest

In Qalam the model proposes, and code decides what's kept.
- **Words:** a point is kept only where code finds it word for word in the source.
- **Numbers:** a number is kept only where the source has it, and a measured point must have one.
- **What you know:** "We know" takes what people said, what you measured or studied, and what a test showed. Someone else's report and the team's own thinking stay under **We believe**.
- **The web:** what Qalam AI reads on the web is kept only where its words are on the page it names. It's never counted as your own evidence.
- **Who said it:** a quote says where it came from, never who. Usernames aren't kept.
- **Who it's for and what comes first:** these rest only on what people said. What's read elsewhere (prices, reports, articles) shows beside them, labelled, and decides neither.
- **Your words:** Qalam AI never rewrites a line you wrote. It says what speaks against it instead.
- **Answers:** when you ask your organization a question, code finds each quote in the answer where Qalam AI says it is, and marks the claims it can't back.

## Install

### With npx

`npx qalam-studio`, as above. It's the same desktop app, and it's been tried on Apple silicon Macs. Intel Macs, Windows and Linux haven't been tried this way yet, and voice and reading words on screenshots are the Mac's. An Intel build of Node on an Apple silicon Mac works, but search goes by words only, and Connections says so. It doesn't update itself: `npx qalam-studio@latest` gets the newest, and your projects stay in `~/Qalam`.

### The Mac app

For Apple silicon (M1 or later), macOS 13 or later.

1. Download the `.dmg` (`Qalam-Studio-<version>-arm64.dmg`) from the [latest release](https://github.com/ahmedamr-r/qalam-studio/releases/latest).
2. Open it and drag **Qalam Studio** into **Applications**.
3. Open it. It isn't notarized by Apple yet, so macOS stops it the first time: allow it once with **Open Anyway** in **System Settings ▸ Privacy & Security**. [docs/install-mac.md](docs/install-mac.md) walks you through it.

You also need one of these, signed in with your own account:
- **[Claude Code](https://code.claude.com/docs/en/quickstart)** (Qalam AI's calls count against your Claude plan);
- **Codex**, signed in with ChatGPT (calls count against your ChatGPT plan);
- an **Anthropic API key**, entered in Connections.

Qalam stays in the menu bar when you close its window, so the inbox keeps working. It looks for a newer version when it starts, and since it isn't notarized it can't install one itself: it says a version is out and opens its page.

### From source

On a Mac, or anywhere Node runs (in the browser).

- **Node.js 24 or newer** (`nvm use` picks it from `.nvmrc`). Its built-in SQLite has the full-text search the index uses.
- **pnpm:** run `corepack enable`, or `npm install -g pnpm`.

```bash
git clone https://github.com/ahmedamr-r/qalam-studio.git
cd qalam-studio
pnpm install
pnpm desktop
```

`pnpm desktop` builds and opens the desktop app. To work on Qalam itself, run `pnpm dev` and open http://127.0.0.1:3101 in Chrome or Edge (the canvas draws with WebGL), or `pnpm desktop:dev` for the desktop window with hot reload. The first time, Qalam finds Claude Code or Codex for you.

Settings are optional and go in `.env.local` (`.env.example` lists them):
- `QALAM_HOME` moves `~/Qalam`, where organizations live.
- `ANTHROPIC_API_KEY` uses an API key, billed to the Console account that owns it.
- `QALAM_MODEL_DECIDE`, `QALAM_MODEL_READ` and `QALAM_MODEL_FETCH` set the model for each kind of call: one that proposes or judges, one that reads, one that fetches. Without them, the mix chosen in Connections applies.
- `WEB_SEARCH=off` turns web search off. The first run then asks you in words instead.

## Where your work lives

- **On your computer, as files.** Each organization is a folder in `~/Qalam`, and any folder can be opened as one.
  - What the organization and each product are: `about.md` and `products/`.
  - The goals: one tree in `goals.md`.
  - One page per problem: `hub/topics/`.
  - What's known about the market: `hub/market.md`.
  - What customers said and your own notes: `sources/`, their text as Markdown.
  - Decisions: a log per month in `decisions/`.
- **Ready for Git.** Its `.gitignore` leaves out `.qalam/` (this computer's state, and a search index that can always be rebuilt) and `chats/`.
- **Search runs on your computer:** words (SQLite FTS5), meaning (a small embedding model, about 37 MB), and the links between pieces.
- **What goes to the AI:** each request sends what it needs (the words you added, the pages and cards it bears on, what's known about the company). It goes through your Claude Code or Codex, or to the Anthropic API with a key. Qalam runs Claude Code from an empty folder with its tools off. Ask gets read-only tools inside the organization's folder.
- **Nothing is sent to the author.** No analytics, telemetry or tracking.

## What it fetches from the web

A scan is your computer reading public pages, one person at a time. Code reads them, not a model, and it says who it is (`QalamStudio/1.0`). Private addresses are refused, each page has a size and a time limit, and a page that turns readers away is left alone.

- **Your engine's own web search** finds competitors, threads and articles.
- **Apple:** its search API, and the public review feed for an app's reviews. App Store web pages are never read.
- **Hacker News:** through Algolia's search API.
- **Pages the search found:** forums, Q&A and review sites, articles and reports, and each product's own pricing page.
- **Hugging Face:** the embedding model, once.
- **GitHub:** the Mac app asks for a newer version when it starts and every six hours. `QALAM_NO_UPDATES=1` turns that off.

Connected tools (Notion, analytics) are read only when you ask.

These sources' terms were read in November 2026, for a free tool each person runs for themselves: [docs/launch-loop.md](docs/launch-loop.md#what-the-sources-terms-say). It's a reading, not legal advice, and worth doing again if your use differs.

## What's hidden for now

Qalam can do much more than the loop above, but someone new sees only the loop. The rest is behind one switch (`src/lab.ts`). Nothing is deleted, and a project made with everything on still opens.
- **Design:** the design studio Qalam started as, with a Figma-like canvas, design systems built from a brief or screenshots, generated screens, critique, and prototypes compiled to React.
- **Teams:** the Decisions page and the "why?" prompt. Decisions are still recorded quietly.
- **Connections:** customer voice and build tools (Intercom, Slack, Linear, Jira, Figma), feeds wired to goals and cards, and product code from GitHub.
- **Goals:** a goal's jobs and gaps, Break it down, What others aim for, and its funnel.
- **Reading more:** Look online on a single problem's page, what people see (screens and flows read from your screenshots), charts and scans inside PDFs, and Review now.
- **More engines:** OpenAI, Gemini and OpenRouter keys, Ollama and LM Studio.
- **Smaller pieces:** quick capture from the menu bar, Draft its tests, and the first run's extra steps.

To turn it all on, set `"labs": true` in `~/Qalam/.qalam/settings.json`. To bring back some of it, use a list such as `"labs": ["feeds", "voice"]`. `QALAM_LAB=1` (or `QALAM_LAB=feeds,voice`) does the same for one run. [docs/v0.1.md](docs/v0.1.md) says what's hidden and why.

## For contributors

**Stack**
- **UI and server:** React 19 with Vite, and a small local server (Hono) whose routes are the only place model calls happen.
- **Desktop app:** Electron. It serves the UI at `qalam://app` and runs the server as a background process reached over a message port, so no network port is opened.
- **Storage:** the organization's files are the source of truth; the search index is built from them.
- **Canvas:** CanvasKit (Skia over WebGL), with HarfBuzz shaping and ICU bidi, so mixed Arabic and Latin lay out correctly.
- **AI:** Claude Code or Codex in the background, or a key, all streaming the same NDJSON.

**Key folders**

```
server/          the local server: routes, the request guard, capture, Ask
server/org/      an organization's folder: files, versions, the watcher, its routes and lookups
server/index/    the search index (FTS5 words, vectors, links)
electron/        the desktop app: the window, qalam://app, the menu bar, updates
src/scan/        reading a space: what people complain about, who it's for, what comes first, the share card
src/sample/      the made-up project behind Try it with a sample
src/space/       the canvas: composed from every goal's tree, saved back to its boards, the chat's jobs
src/goals/       the goal tree (goals.md), problems behind a goal, finding the one to focus on
src/hub/         the knowledge as pieces and links, topic pages, the checks behind Needs a look
src/market/      what's known about the company, its competitors and its domain
src/discovery/   cards, sources, quote matching, evidence, brain dumps, next steps
src/ai/          prompts, schemas and the engines
src/ui/          the pages: organizations, the canvas and its chat, the first run, Connections
```

**Commands**

```bash
pnpm dev            # the studio (UI and server) on 127.0.0.1:3101
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest
pnpm desktop        # build and open the desktop app
pnpm dist:mac:adhoc # package the Mac app into release/dist, signed ad hoc as releases are for now
```

[AGENTS.md](AGENTS.md) has the notes for coding agents. [docs/releasing.md](docs/releasing.md) explains signing and releases, and [docs/engines.md](docs/engines.md) covers each engine.

## Roadmap

- **Watching people use it:** then turning hidden features back on one at a time, starting with what they ask for.
- **A notarized Mac app**, which installs its own updates and comes with a Homebrew cask.
- **Claude Code plugin:** lets your coding agent ask why a brief says what it says.
- **Charts and tables in PDFs:** numbers inside a chart's picture aren't read by default, and a PDF table's cells lose their columns. A lab switch (`pictures`, Mac only) reads printed numbers in charts, image tables and scans, each checked against what this Mac reads off the page.
- **Interview recordings:** drop in audio or video and get an Arabic or English transcript to quote from.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The "Qalam" name and logo are not covered by the code license; see [TRADEMARKS.md](TRADEMARKS.md).
