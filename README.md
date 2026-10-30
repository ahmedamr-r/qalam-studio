# Qalam Studio

An open-source, Arabic-first second brain for product makers. Qalam keeps what your organization knows (its products and goals, what customers said, the needs behind it, what you decided and why) as readable files on your computer. Qalam AI runs on your own Claude Code and helps you find the real problems and act on them. The design studio Qalam started as (a Figma-like canvas, design systems and prototypes) is still part of it.

In Qalam the model proposes and code decides:
- **Quotes and numbers:** a customer's quote is kept only if code finds it word for word in the source, and a number only where the source has it.
- **Topic pages:** every line cites what it rests on. What the team believes stays under **We believe** until customers or a test show it.
- **Asking:** when you ask your organization a question, code finds each quote in the answer where Qalam AI says it is, and marks the claims it can't back.
- **Screens:** they're built from your design system's components, so off-system values can't come back. Code measures and lints each one for contrast, target size, and Arabic and RTL.

Qalam Studio is built by Ahmed Amr.

## Status

Early. Qalam runs on your own machine, as a desktop app or in the browser. There is no hosted version and no Qalam server. Expect rough edges and slow AI calls: reading a long interview or setting up an organization takes a minute or two. The design tools work, but they're on hold while the knowledge side grows. Issues and pull requests are welcome.

## Try it

### Requirements

- **A Mac**, for the desktop app. It's where Qalam is built and tested; the browser mode runs wherever Node does.
- **Node.js 24 or newer** (`nvm use` picks it from `.nvmrc`). Its built-in SQLite has the full-text search the knowledge index uses. On Node 22 everything else works, and search says it needs Node 24.
- **pnpm.** Run `corepack enable`, or `npm install -g pnpm`.
- **Claude Code, installed and signed in with your own Claude account.** Follow the [Claude Code quickstart](https://code.claude.com/docs/en/quickstart). Qalam AI runs Claude Code in the background for each request, so usage counts against your Claude plan. If you'd rather use an API key, see [Use an Anthropic API key instead](#use-an-anthropic-api-key-instead).
- **An internet connection** for the AI calls, which go to Anthropic.

### Steps

```bash
git clone https://github.com/ahmedamr-r/qalam-studio.git
cd qalam-studio
pnpm install
pnpm desktop
```

Qalam opens as a desktop app on your own Claude Code, with nothing to configure. If it says Claude Code isn't signed in, run `claude auth login` in a terminal and press **Check again**.

### In the browser instead

To work on Qalam itself, run it in the browser with hot reload. Copy the settings file:

```bash
cp .env.example .env.local
```

Open `.env.local` and remove the `#` in front of `AI_BACKEND=cli`:

```bash
AI_BACKEND=cli
# Only if the `claude` command isn't on your PATH:
# CLAUDE_CLI_PATH=/full/path/to/claude
```

Then start it:

```bash
pnpm dev
```

Open the address it prints, http://127.0.0.1:3101, in Chrome or Edge (the canvas draws with WebGL). For the desktop window with hot reload, run `pnpm desktop:dev` instead of `pnpm dev`.

### The Mac app

A signed Mac app for Apple silicon will be on [GitHub Releases](https://github.com/ahmedamr-r/qalam-studio/releases), and in Homebrew (`brew install --cask ahmedamr-r/tap/qalam-studio`), once the first release is out. Until then, run Qalam from source as above.
- **Updates:** it looks for a newer version when it starts and every six hours, and installs it when you quit. **Qalam Studio ▸ Check for Updates…** looks right away.
- **Finding Claude Code:** opened from the Dock or Finder, it reads your login shell's PATH, so it finds Claude Code wherever your terminal does.
- **Building it yourself:** run `pnpm dist:mac`. [docs/releasing.md](docs/releasing.md) explains signing and releases.

### First steps

Qalam opens your organization's home. The first time, that's an organization called Personal, in `~/Qalam/Personal`.

- **Tell Qalam AI about it.** The home offers to start from a brain dump: what the company does, its products, who they're for and the goals you're moving. Qalam AI asks about what's unclear, then proposes the About and a page for each product, for you to accept line by line. You can also fill them in by hand.
- **Make another organization** from the menu at the top. Each one is a folder in `~/Qalam`, and any folder can be opened as one.
- **Start a board** with **New board**: from six questions, from your research, from a brain dump, or blank.
- **Add what you know:** interviews, tickets, notes and pages, from the **+** beside the Ask bar, or by dropping files in the organization's `inbox/` folder.
- **Ask** what the organization knows, at the top of its home.

Screens and design systems are under **Design**. In a Screens project, **File ▸ Load demo screens** puts example screens on the canvas.

### Coming from an earlier version

Projects you made before Qalam saved to disk are still in the browser you made them in, at that address. Open Qalam there, for example with `pnpm dev --port 3000` and then http://localhost:3000, and the home offers to move them into your organization. The browser keeps its copy.

### Use an Anthropic API key instead

Leave `AI_BACKEND` unset and add your key to `.env.local`:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

Usage is billed to the Console account that owns the key. Set a monthly spend limit there. Web search also has to be allowed for your organization in the Claude Console.

### Without any AI

If neither Claude Code nor a key is set up, everything you do by hand still works: boards, topic pages, decisions, search, the canvas, tokens, the linter and prototypes. Reading your own material and asking the organization need Qalam AI. Discovery and most design tools can replay recorded samples instead, labelled as samples.

### Settings

All settings are optional and go in `.env.local`. `.env.example` lists them with comments.

- **Where organizations live.** `QALAM_HOME` moves `~/Qalam` somewhere else.
- **Models.** Every step uses `claude-opus-5-5` unless you override it. Set these to models your account can use:
  - `CLAUDE_MODEL`: the default for critique, audit, Detective, restyle, translation, the repair pass and research.
  - `GENERATE_MODEL`: screen generation. Plan, Tune, Prototype, Discovery and the brand interview also use it unless you set `PLAN_MODEL`, `TUNE_MODEL`, `PROTOTYPE_MODEL`, `DISCOVERY_MODEL` or `INTERVIEW_MODEL`.
  - `DS_EXTRACT_MODEL`: design-system extraction and its fidelity rebuild. `DS_SCAN_MODEL` and `COMPONENT_MODEL` use it unless you set them.
  - `RESTYLE_MODEL`, `REPAIR_MODEL`, `TRANSLATE_MODEL`, `RESEARCH_MODEL`: these default to `CLAUDE_MODEL`.
- **Research before answering.** Generate, Tune and Critique can look things up first.
  - Web search is on by default; turn it off with `WEB_SEARCH=off`.
  - `TAVILY_API_KEY` adds Tavily.
  - `MCP_SERVERS` adds remote MCP servers, as JSON.
  - With `AI_BACKEND=cli`, `CLI_MCP_SERVERS=name1,name2` reuses MCP servers you already connected in Claude Code.
- **Rate limit.** The server allows 20 AI requests per 10 minutes by default. Raise it with `RATE_LIMIT_PER_10_MIN`.

## What you can do

### Your organization

- **The home** starts with the Ask bar and what needs a look. Then come what the organization (or the product in view) is, every board's goals, and four tabs: **Boards**, **Topics**, **Sources** and **Decisions**. Products are chips at the top; a board or a source is for one product or for the whole organization.
- **Goals, and what serves them:** each outcome on a board says which stated goal it serves. The home's **Goals** shows every goal the organization and its products state, the one that leads first, with the outcomes working on it and how their numbers are doing; a goal nothing works on offers **Start a board**. **Needs a look** says when a goal has no board working on it, or when a board's outcome serves none of the goals you've stated.
- **What the organization and each product are:** who it's for, its goals (the one that leads first, each with how it's measured, by when and who owns it), its strategy, what customers use instead, its constraints, its context and its segments. Qalam AI reads them with every call, and they're Markdown files you can edit anywhere.
- **Start from a brain dump about the company.** A new organization opens on a page that asks what the company does, its products, who they're for and the goals you're moving, written as it comes. It can also read the company's website.
  - Qalam AI says what it took from it, pushes back where it won't hold up, and asks up to three rounds of questions.
  - Then it proposes the organization's About and a page for each product (who it's for, its context, goals and segments), line by line, each with the words it rests on.
  - Code keeps a line only where those words back it: what it quotes, and every number in it, are in what you wrote, and a new product only appears under a name you used.
  - Nothing is written until you accept a line. Each goal you accept can then start a board, its outcome resting on your words, and what you wrote goes on the topic pages as what the team believes.
- **Add anywhere.** Add interviews, tickets, notes or pages to the organization from its home (the **+** beside the Ask bar). Or drop files in its `inbox/` folder from Finder while Qalam is running, whatever page it shows.
  - Qalam AI picks out what customers said, files it into the topic pages, and proposes where it fits on your boards.
  - Each board finds its proposals waiting, and you accept or discard them there as with any other.
  - A file Qalam can't read moves to `inbox/not-read`, with a note saying why. Nothing is deleted.
- **People.** Say who said what: on a source, map each speaker to a person (or say all of it is from one person, or one segment) and when it was said. People are files in `people/`, each with the segments they're in. Qalam then counts the people behind a need, not the quotes, and tells segments apart; the home's **People** tab shows who you hear from and when you last did.
- **Ask the organization** in plain words, at the top of its home.
  - **How it looks:** with Claude Code, Qalam AI looks through the organization's folder on its own, using its search (words, meaning and links), its topic pages, sources, boards and decisions. It only reads, and only that folder; nothing runs code and nothing goes to the web. With an API key it answers from one call, with what search finds for the question.
  - **What you get back:** each claim comes with the exact words that show it, found word for word by code where Qalam AI says they are, with a link there. What it can't back is marked as such, and what nobody knows yet can go on a topic page as an open question.
- **Needs a look.** The home starts with what needs your attention, newest first, marking what's new since your last visit. Code checks your boards, decisions and topic pages as they change, at no AI cost:
  - something customers said against what the team believes;
  - a target need resting on thin evidence (one voice, stale words, or only the team's belief);
  - a need customers keep raising that no board has;
  - the same need on two boards (link them);
  - a parked or dropped card that new evidence backs;
  - a test that's run too long, a solution built on a risky assumption nothing tests, or an outcome whose number nobody updates;
  - a solution shipped a month ago whose outcome's number hasn't moved the right way since (or has no reading since), and an outcome that reached its target;
  - a goal no board works on, and an outcome that serves none of the goals you've stated.

  **Review now** asks Qalam AI to read everything for what counting can't find, such as a target the evidence speaks against, or a decision whose reason no longer holds. Each finding must rest on what it read. A card that needs a look is marked on its board, and its panel says why. A notice you dismiss doesn't come back.

### Discovery boards

- **The tree:** map an outcome, the customer opportunities under it, and solutions and tests, as an Opportunity Solution Tree.
- **Starting:** start from six questions about your product, from your research, from a brain dump, from a recorded sample, or blank.
- **Brain dump:** paste your own thinking as it comes (goals, needs, ideas, numbers, what you've heard), from the start sheet or **Brain dump…** (**⌘K**).
  - Qalam AI says what it took from it, and pushes back where it won't hold up: a feature written as a need, a claim with no source.
  - It asks up to three rounds of questions, then proposes where each piece goes: new cards, evidence, edits and merges, each to accept or discard.
  - Your words back the cards as the team's thinking, never as a customer's.
- **Sources:** PDF, Word, Markdown, text, CSV, VTT and SRT transcripts, web pages (including public Google Docs), pasted text, and items from connected tools.
  - Qalam AI picks out what customers said. Code keeps a quote only if it finds it word for word in the source.
  - In an interview's transcript, only the participants are quoted, never the interviewer.
- **Assumed:** an opportunity that Qalam AI drafted with no evidence behind it is marked **Assumed** until someone attaches a quote, an answer or a note.
- **How strong it is:** each need and solution says how strong what it rests on is (nothing yet, the team's belief, thin, some or strong), counted by code from how many people said it, in how many segments and sources, how recently, and what speaks against it, with what would make it stronger. A target resting on thin evidence shows in **Needs a look**.
- **Boards build on what the organization knows.** Drafting a tree, picking out quotes, mapping them and placing a brain dump each send Qalam AI the pieces of the organization's knowledge that bear on the work, within a token budget.
  - A new board's needs can rest on what customers said in sources added to other boards. A quote from elsewhere brings its source onto the board when you accept it.
  - Qalam AI says which pieces shaped each answer. Code keeps only pieces it was sent, and the board keeps that trace.
- **Numbers, read by code:** an outcome's number keeps its readings over time: type the number in as it moves, or import a CSV from your analytics tool, and code finds the dates and the numbers and says what it read. A sparkline shows the trend, with a tick where a solution under it shipped. A CSV of tickets, survey answers or reviews is read as a table: code counts how many rows a need shows up in ("in 12 of 340 rows"), and a customer column makes one customer's rows one voice.
- **Decision memory:** what you decide on a board is recorded as you go, by code and without the AI: a new target, a dropped solution, a parked opportunity, a merge, a deleted branch, a move, an outcome's new number.
  - Each entry keeps what the card rested on that day: its quotes, what spoke against it, its tests.
  - A big decision asks for a one-line why, which you can skip and add later.
  - Undo marks the entry undone instead of deleting it.
  - A card's **History** and the organization's **Decisions** tab show them, and each month is a Markdown file in `decisions/`.
- **Design this:** carries a solution, the quotes behind it and its riskiest assumptions into a Screens project, where Qalam AI plans the screens with that context.

### Topic pages and search

- **Topic pages:** one living page for each customer need, kind of customer and product, saying where you stand:
  - **We know:** what customers said or did, and what a test showed.
  - **We believe:** the team's view, not shown yet.
  - **Against**, and **Open questions**.

  How the pages stay honest:
  - **Filing:** Qalam AI files what customers say into them each time a board reads a source or places a brain dump, and from the organization's **Topics** tab.
  - **Checking:** every line cites the pieces it rests on. Code keeps a line only when it cites pieces Qalam AI was really sent, and any words it quotes, or numbers it gives, are in them word for word. A line resting only on the team's words moves to **We believe**.
  - **Your lines:** Qalam AI never rewrites a line you wrote or edited. It says what speaks against it instead.

  Each page shows the cards on boards that rest on the same quotes, and is a Markdown file in `hub/topics/` you can edit anywhere.
- **Search across the organization.** Every quote, need, card, assumption, decision and line about a product is a small piece in a local index (`.qalam/index.sqlite`, rebuilt from the files whenever needed).
  - Search combines the words (SQLite FTS5), the meaning (a small embedding model that runs on your computer) and the links (a card's evidence, a need's quotes).
  - It puts what's for the product in hand first.

### Chats and agents

- Every AI request is a turn in a chat, and later turns see earlier ones ("make the second one denser").
- Several requests can run at once. Each agent shows as a named cursor on the canvas, and you can follow it. Layers an agent is working on are locked until it finishes.

## Design tools

The design tools work, and their projects are saved in the organization's folder like everything else. They're on hold, though: no new features for now.

### Canvas and editing

- Frames, groups, rectangles, ellipses, lines, arrows, polygons, stars, vectors, text, icons and images.
- Move, resize, rotate, flip and nest layers, with snapping, distance labels and equal-spacing guides. Hold ⌥ to measure.
- Pen, pencil and vector edit mode. Boolean union, subtract, intersect and exclude, plus flatten, outline stroke and masks.
- Rulers, layout grids, pixel grid, outline mode and per-corner radii (including elliptical corners).
- Figma's keyboard shortcuts come from one command registry. Search every command with **⌘K**. The shortcuts panel (**⌃⇧?**) lists the Figma shortcuts Qalam doesn't have yet, and why.
- **Pages**, as in Figma. A read-only **Components page** draws every component of the active design system in its own tokens, and updates when a token changes.
- **Auto layout** (⇧A), laid out by Yoga (flexbox).
- Export PNGs, or export the whole document as JSON.

### Design systems

- **From a brief:** a Design system project interviews you about the brand.
  - It reads back what it heard, proposes three directions, and lets you refine one on real screens.
  - Then you shape the components, the product's most complex one first, and save your tokens.
- **From screenshots:** drop up to three screenshots of a product and choose **Extract design system**. You choose the depth: tokens only, or tokens plus docs and component styles.
  - Code measures colours, heights, corner radii and margins from the pixels, keeps the scales in order, checks text contrast, and lists every change it made.
  - Then the first screenshot is rebuilt from catalog components with the new system and shown beside it, so you can compare the two.
- **Add component:** turn a screenshot of one component into a library component.
- **Token Detective:** paste CSS or a token export, or upload a screenshot. Qalam AI separates intent from coincidence: one hex used for a button, a toast and a price becomes three tokens.
- **Tokens:** W3C DTCG tokens for colour, type, radius, spacing, borders, shadows, gradients and component recipes. Every property shows its token, or an *Off-system* badge.
- Export as DTCG JSON, CSS variables or `design.md`.

### Generate

- **Describe a screen.** Qalam AI composes it from the catalog and your system's components, for phone, web page, dashboard or desktop app, in English, Arabic or both.
- **Plan first** (on by default): before drawing, Qalam AI says what it understood and asks a few questions about your product, each with a recommended answer. Skip them to use its picks.
- **Alternatives:** one screen by default. Ask for alternatives ("show me 3 options") and you get up to five.
- **Self-check:** every screen is validated and measured, and issues go back to the model once with the exact path. The repaired version replaces the original only if it has fewer issues.
- **Beyond the catalog:** when nothing in it fits, Qalam AI draws a **Graphic** in your system's colours and type, or defines a new component you can add to the library.
- **No design system:** Qalam AI picks a named look, code builds its tokens, and you can save the look as a system later.

### Review and tune

- **Critique:** select screens and click the **Critique** pill.
  - Qalam AI reviews them against Nielsen's heuristics, hierarchy, content, accessibility and Arabic/RTL, using a render, the layer outline and the linter's findings.
  - It then asks one question at a time (goal, audience, primary action) until it can say whether the design meets the goal.
  - **Fix all** revises the screens in one undo step.
- **Audit:** a linter checks off-token values, WCAG 1.4.3, 1.4.4, 1.4.11 and 2.5.8, and RTL problems: unmirrored icons, Arabic set left-to-right, letter-spacing that breaks Arabic joining, and currency order. Many findings have one-click fixes.
- **Tune system:** tell Qalam AI what to change ("denser lists", "softer corners"). It proposes token and guidance changes. You pick which to apply, screens on the system follow at once, and you can undo them.
- **Direction:** flip a screen between LTR and RTL in place, or keep the original and add a mirrored copy. The copy is translated, and code checks each translation against its component's length limit.

### Prototypes

- **Links:** link screens on tap, press, hover or after a delay. Add states, entrance animations, and sheets, dialogs, toasts and menus that open over a screen.
- **Present** (⌥⌘↵) compiles the screens to one React + Motion TSX file with no model call, plays it, and lets you copy or download it.
- **Motion follows the platform:** iOS springs and swipe-back, Android's Material curves, web cross-fades. Reduce Motion is respected.
- **Recipes** add common behaviour, based on what a scan of the screen finds:
  - an options sheet behind a **+**;
  - a basket bar with a live total;
  - sticky section chips;
  - a header that compacts on scroll;
  - a confirm dialog.
- **Prototype sessions:** Qalam AI proposes what to make work on the screen. Each step is built, and kept only if the prototype still passes its checks.

### Knowledge hub

- In a Screens project, answers, screen goals and critique verdicts are saved with the document, so the next critique asks only what it doesn't know yet.
- **Why this design?** traces each design back to what Qalam AI relied on: your answers, the system's rules and its research. A map and a timeline show the same knowledge.
- Edit a fact, tell Qalam AI to forget it, or pin it so it always applies.

## Privacy

- **Your work stays on your computer, as files.** Each organization is a folder in `~/Qalam` (set `QALAM_HOME` to move it), or any folder you open as one.
  - **What's in it:** projects are readable JSON (a Discovery board lists its cards at the top). A source's text is Markdown, and so is what the organization and each product are (`about.md`, `products/`). Decisions are a Markdown log per month (`decisions/`), and images are kept once, by their content.
  - **Git:** the folder is ready for it. `.gitattributes` keeps both people's entries when two people add to the same month's log. Its `.gitignore` leaves out `.qalam/` (this computer's state: when a project was last opened, thumbnails, the Knowledge hub's layout) and `chats/` (chats and AI traces).
  - **No upload:** nothing is uploaded to a Qalam server, because there isn't one. Qalam's own server runs on your machine and only answers this computer.
- **What goes to the AI.** When you use an AI tool, the local server sends Anthropic what that request needs. Depending on the tool, that can be:
  - your prompt and earlier turns in the chat;
  - the design system (including its source screenshots), screenshots you add, and renders and layer outlines of the screens you selected;
  - the text of documents and pages you add to a Discovery board;
  - the pieces of your organization's knowledge that bear on a Discovery request: quotes from its other sources, other boards' cards, decisions and their reasons, what its products are, and its topic pages' lines;
  - to keep the topic pages current, the quotes of new sources, with the pages they may change;
  - for **Review now**, the organization's topic pages, its boards' cards, and its recent decisions with their reasons;
  - material you add from the home or the inbox, sent like a board's sources, with the boards' trees for placing it;
  - for setting an organization up, what you wrote about it (or the text of the page you gave), your answers to Qalam AI's questions, and what its About and products already say;
  - for **Ask**, a guide to the organization's folder and what Qalam AI reads there while answering.

  With `AI_BACKEND=cli` (and in the desktop app) it goes through Claude Code, under your Claude account. With an API key it goes to the Anthropic API, under your key.
- **Search runs on your computer.** The first search downloads a small embedding model (bge-small-en-v1.5, about 37 MB) from Hugging Face into your cache folder (`~/Library/Caches/Qalam/models` on a Mac). After that, nothing about your knowledge leaves the machine to be searched.
- **Claude Code's access.** Qalam runs Claude Code without your settings or memory, from a temporary folder, with its tools turned off, so it can't read or change your files. There are two exceptions:
  - **Ask** gets read-only tools and Qalam's own search, confined to the organization's folder, with nothing that runs code and no web.
  - **The research step** allows only web search, web fetch and the MCP servers you configured.
- **Other services.** Research queries go to the services you turn on: Anthropic's web search, Tavily, or your MCP servers. Your machine fetches the web pages you add, and any Google Fonts a design system names. The installed Mac app asks GitHub for a newer version when it starts and every six hours; `QALAM_NO_UPDATES=1` turns that off.
- **Nothing is sent to the author.** Qalam has no analytics, telemetry or tracking.

## How it works

For contributors. The design rule throughout: **the AI chooses, code computes.** The model picks components, words and directions. Code measures, validates, repairs, and decides what's kept.

**Stack**

- **UI and server:** React 19, built with Vite. A small local server (Hono) answers `/api/*`; its routes in `server/routes` are the only place model calls happen. In development it runs inside the Vite dev server, so the UI and the API share one address.
- **Desktop app:** Electron. It serves the UI at `qalam://app` and runs the server as a background process, reached over a message port, so no network port is opened. Search's embedding model (node-llama-cpp) runs in a process of its own.
- **Storage:** an organization's files are the source of truth. The search index (`.qalam/index.sqlite`: SQLite FTS5, vectors and links) is built from them, and can always be deleted and rebuilt.
- **Canvas:** CanvasKit (Skia over WebGL). Text goes through Skia's paragraph engine (HarfBuzz shaping, ICU bidi), so mixed Arabic and Latin lay out correctly.
- **Layout and state:** Yoga for auto layout and generated screens; zustand and immer for document state, with transactional undo.
- **Claude:** through `@anthropic-ai/sdk` with structured outputs, or through the local Claude Code CLI (`src/ai/cli.ts`). Both stream the same NDJSON to the window.

**Key folders**

```
server/             the local server: routes (generate, plan, critique, discovery, topics, setup, …), request guard
server/org/         an organization's folder: readable files, versions, the folder watcher, its routes
server/index/       the search index (SQLite: FTS5 words, vectors, links), kept current with the organization's folder
server/models/      the models process: the local embedding model (node-llama-cpp), apart from the core
electron/           the desktop app's main process: the window, qalam://app, updates (electron-builder.yml packages it)
src/org/            the window's side of the organization: its files, products and About, live changes, setting it up
src/hub/            the organization's knowledge as pieces and links, search fusion, packing pieces into a token budget, topic pages, the checks behind Needs a look and Ask
src/discovery/      Opportunity Solution Tree model, sources, quote matching, evidence, brain dumps, "Design this" handoff
src/decisions/      decision memory: decisions found by comparing a board before and after, and the log's Markdown
src/ai/             prompts, JSON schemas, the API and CLI backends, research connectors, recorded samples
src/engine/         CanvasKit renderer, controller (tools, handles, snapping), vector tools, text, rulers
src/doc/            document model, store with undo/redo, ops, pages, auto layout, RTL mirroring, prototype data
src/design-system/  tokens (DTCG), component catalog and builders, pixel measurement, spec checks, extraction
src/proto/          routes, recipes, expressions, the headless runner that checks prototypes
src/codegen/        prototype compiler: screens → one React + Motion TSX file (no model call)
src/lint/           deterministic lint rules and fixes (the source of truth; the AI only explains)
src/knowledge/      the design knowledge hub's facts, decision traces and graph
src/commands/       command registry, keyboard dispatcher, Figma shortcut catalog
src/projects/       projects and saving them (to the organization's folder, through server/org)
src/ui/             the pages, panels and toolbar: the organization's home, boards, topic pages, setup, the canvas, AI chat
eval/retrieval/     a sample organization and labelled questions that measure search (pnpm eval:retrieval)
```

**Commands**

```bash
pnpm dev             # start the studio (UI and server) on 127.0.0.1:3101
pnpm typecheck       # tsc --noEmit
pnpm test            # vitest
pnpm eval:retrieval  # how well search finds what answers each question on the sample organization
pnpm build           # build the UI into dist/
pnpm start           # serve dist/ and the server from one process (after a build)
pnpm desktop         # build and open the desktop app (Electron)
pnpm desktop:dev     # the desktop window on the dev server, with hot reload
pnpm dist:mac        # package the Mac app into release/dist (.dmg and .zip; signed when a Developer ID is set up)
```

Rules and checks must work across products, not just one app: name things by role, trigger on measurable conditions, and test on several kinds of product (see `src/proto/fixtures/`).

[AGENTS.md](AGENTS.md) has the notes for coding agents: where the UI, the server and the shared modules live, and what must never reach the browser.

## Roadmap

- **First releases:** the first signed macOS release (the pipeline is ready: [docs/releasing.md](docs/releasing.md)), and the npm package, so `npx qalam-studio` opens the desktop app.
- **Interview recordings on Discovery boards:** drop in audio or video and get an Arabic or English transcript to quote from. Today, transcripts come in as VTT or SRT.
- **Every organization's inbox:** watched while Qalam runs, not only the inbox of the organization you opened.
- **The design tools, once they're off hold:** more ways to bring in an existing design system, and more of Figma's editing features (the shortcuts panel lists what's missing).

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The "Qalam" name and logo are not covered by the code license; see [TRADEMARKS.md](TRADEMARKS.md).
