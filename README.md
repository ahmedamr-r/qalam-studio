# Qalam Studio

An open-source, Arabic-first second brain for product makers. You bring what customers said, and Qalam turns it into the problems worth solving, ranked by how many customers raised them. Every line rests on words a customer said, which code finds word for word in the source.

Qalam keeps what your organization knows as readable files on your own computer: its goals, what customers said, the problems behind it, and what you decided. Qalam AI runs on your own Claude Code or Codex, so there is no Qalam account and no Qalam server.

Qalam Studio is built by Ahmed Amr.

## Status: v0.1

v0.1 is the first version for people to try. It's for a founder or PM on their own, or a team of two or three, with a pile of customer conversations and no time to read them twice. It shows one loop (below) and hides everything else Qalam can do behind a switch ([What v0.1 hides](#what-v01-hides)).

Expect rough edges and slow AI calls: looking up a company, or reading a long interview, takes a minute or two. Issues and pull requests are welcome.

## What it does

Everything happens on one canvas per organization, with Qalam AI's chat on its left, as Figma keeps its panel there.

1. **Open Qalam.** It finds Claude Code or Codex on your computer, and you name your organization (a company or team, or just you with an idea).
2. **It learns the company.** Give it your website, or a line about what you do. Qalam AI looks it up on the web, and you check each fact it found, row by row: keep it, fix it or drop it. Then your competitors: name them, or let it find them. While you work, it reads what companies like yours usually aim for and what their customers struggle with.
3. **Start.** Qalam AI offers to help you find a first goal or problem from what companies like yours face, to take one you have in mind, or to start from your customers' words.
4. **Bring anything to the chat.**
   - **What customers said** (interviews, tickets, survey answers; pasted, or as PDF, Word, Markdown, CSV or XLSX files) goes into one page per problem. Each doc's chip says whose words it holds.
   - **Your own thinking** is a brain dump. Qalam AI says what it took from it, pushes back where it won't hold up, asks a few rounds of questions, and proposes cards for the canvas.
   - **A goal or a problem in your words** is worded as a proper statement for you to use, edit, or replace with your own words.
   - **A question** is answered from everything you added, with each quote checked.
5. **Problems, ranked.** Beside the canvas, the problems are ranked by the customers behind them: sources first, then quotes, then the newest. A problem's page says what you know, what you believe, what speaks against it and what's still open.
6. **Goals.** Pick a goal on the canvas and choose **Find the problem to focus on**. Qalam AI looks on the web for what usually keeps goals like it from moving and asks you about it. Where your answers call for it, it looks again, then proposes the one to three problems to work on first. **Find its problems** links the problem pages that already bear on it.
7. **Solutions.** On a problem, **Draft solutions** proposes two to four, each with its riskiest assumptions and one test of the riskiest.

You can also drop files into the organization's `inbox/` folder from Finder while Qalam is running. And there's a mic in every box: talking is quicker than typing out what a customer said.

## How it keeps the AI honest

In Qalam the model proposes, and code decides what's kept.
- **Quotes:** a customer's quote is kept only where code finds it word for word in the source.
- **Numbers:** a number is kept only where the source has it.
- **What you only believe:** a line resting only on the team's words stays under **We believe** until customers or a test show it.
- **The web:** what Qalam AI reads on the web is kept only where its words are on the page it names. It's never counted as customer evidence.
- **Your words:** Qalam AI never rewrites a line you wrote. It says what speaks against it instead.
- **Answers:** when you ask your organization a question, code finds each quote in the answer where Qalam AI says it is, and marks the claims it can't back.

## Install

### The Mac app

For Apple silicon (M1 or later), macOS 13 or later.

1. Download `Qalam-Studio-0.1.0-arm64.dmg` from the [latest release](https://github.com/ahmedamr-r/qalam-studio/releases/latest).
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
- **Search runs on your computer:** words (SQLite FTS5), meaning (a small embedding model, about 37 MB, downloaded once from Hugging Face), and the links between pieces.
- **What goes to the AI:** each request sends what it needs (the words you added, the pages and cards it bears on, what's known about the company). It goes through your Claude Code or Codex, or to the Anthropic API with a key. Qalam runs Claude Code from an empty folder with its tools off. Ask gets read-only tools inside the organization's folder. Web lookups use your engine's own web search.
- **Nothing is sent to the author.** No analytics, telemetry or tracking. The Mac app asks GitHub for a newer version when it starts and every six hours; `QALAM_NO_UPDATES=1` turns that off.

## What v0.1 hides

Qalam can do much more than the loop above, but a first-time user sees only the loop. The rest is behind one switch (`src/lab.ts`). Nothing is deleted, and an organization made with everything on still opens.
- **Design:** the design studio Qalam started as, with a Figma-like canvas, design systems built from a brief or screenshots, generated screens, critique, and prototypes compiled to React.
- **Teams:** the Decisions page and the "why?" prompt. Decisions are still recorded quietly.
- **Connections:** connectors to Notion, Intercom, Slack, Linear, Jira, Confluence and Google Drive, plus feeds wired to goals and cards, product code from GitHub, and numbers from PostHog.
- **Goals:** a goal's jobs and gaps, Break it down, What others aim for, and its funnel.
- **Reading more:** people online (Reddit threads, App Store reviews), what people see (screens and flows read from your screenshots), and Review now.
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

- **Five first users:** watch five people use v0.1 on their own material, then turn hidden features back on one at a time, starting with what they ask for.
- **A sample project**, so someone with no material at hand sees the loop in a minute.
- **A notarized Mac app**, which installs its own updates and comes with a Homebrew cask, and an npm package for `npx qalam-studio`.
- **Interview recordings:** drop in audio or video and get an Arabic or English transcript to quote from.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The "Qalam" name and logo are not covered by the code license; see [TRADEMARKS.md](TRADEMARKS.md).
