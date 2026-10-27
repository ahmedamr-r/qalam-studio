# Qalam Studio

An open-source, Arabic-first AI design studio: a Figma-like canvas where Qalam AI designs inside your design system, with RTL and accessibility built in.

In Qalam the model proposes and code decides. Screens are composed from a component catalog bound to your tokens, so off-system values can't come back. Code then measures each screen and runs a linter (contrast, target size, Arabic and RTL), and anything that fails goes back to the model once for a repair. Design systems can be extracted from screenshots: code re-measures colours, sizes and corners from the pixels. It doesn't trust the model's estimates. Discovery boards turn research into an Opportunity Solution Tree, and a customer quote is kept only if code finds it word for word in the source. Screens become clickable prototypes that move like iOS, Android or the web, and compile to a React file.

Qalam Studio is built by Ahmed Amr.

## Status

Early. Qalam runs locally on your own machine; there is no hosted version. Expect rough edges, missing Figma features and slow AI calls: a large extraction can take several minutes. Issues and pull requests are welcome.

## Try it

### Requirements

- **Node.js 22.12 or newer.** Vite 8 and the test runner need it.
- **pnpm.** Run `corepack enable`, or `npm install -g pnpm`.
- **Claude Code, installed and signed in with your own Claude account.** Follow the [Claude Code quickstart](https://code.claude.com/docs/en/quickstart). Qalam AI runs Claude Code in the background for each request, so usage counts against your Claude plan. If you'd rather use an API key, see [Use an Anthropic API key instead](#use-an-anthropic-api-key-instead).
- **Chrome or Edge** (recommended). The canvas draws with WebGL.
- **An internet connection** for the AI calls, which go to Anthropic. The canvas engine (CanvasKit) ships with Qalam.

### Steps

```bash
git clone https://github.com/ahmedamr-r/qalam-studio.git
cd qalam-studio
pnpm install
cp .env.example .env.local
```

Open `.env.local` and remove the `#` in front of `AI_BACKEND=cli`:

```bash
AI_BACKEND=cli
# Only if the `claude` command isn't on your PATH:
# CLAUDE_CLI_PATH=/full/path/to/claude
```

Then start the studio:

```bash
pnpm dev
```

Open the address it prints, http://127.0.0.1:3101. If Qalam AI says Claude Code isn't signed in, run `claude auth login` in a terminal and try again.

To open Qalam as a desktop app instead of in the browser:

```bash
pnpm desktop
```

The desktop app runs Qalam AI on your own Claude Code, so you don't need `.env.local` for it.

On the home page, start a **Design system**, **Screens** or **Discovery** project. In a Screens project, **File ▸ Load demo screens** puts example screens on the canvas so you can try the tools right away.

### Use an Anthropic API key instead

Leave `AI_BACKEND` unset and add your key to `.env.local`:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

Usage is billed to the Console account that owns the key. Set a monthly spend limit there. Web search also has to be allowed for your organization in the Claude Console.

### Without any AI

If neither Claude Code nor a key is set up, the canvas, tokens, linter and prototypes still work. Most AI tools then replay recorded samples, which are labelled as samples.

### Settings

All settings are optional and go in `.env.local`. `.env.example` lists them with comments.

- **Models.** Every step uses `claude-opus-5-5` unless you override it. Set these to models your account can use:
  - `CLAUDE_MODEL`: the default for critique, audit, Detective, restyle, translation, the repair pass and research.
  - `GENERATE_MODEL`: screen generation. Plan, Tune, Prototype, Discovery and the brand interview also use it unless you set `PLAN_MODEL`, `TUNE_MODEL`, `PROTOTYPE_MODEL`, `DISCOVERY_MODEL` or `INTERVIEW_MODEL`.
  - `DS_EXTRACT_MODEL`: design-system extraction and its fidelity rebuild. `DS_SCAN_MODEL` and `COMPONENT_MODEL` use it unless you set them.
  - `RESTYLE_MODEL`, `REPAIR_MODEL`, `TRANSLATE_MODEL`, `RESEARCH_MODEL`: these default to `CLAUDE_MODEL`.
- **Research before answering.** Generate, Tune and Critique can look things up first. Web search is on by default; turn it off with `WEB_SEARCH=off`. `TAVILY_API_KEY` adds Tavily. `MCP_SERVERS` adds remote MCP servers as JSON. With `AI_BACKEND=cli`, `CLI_MCP_SERVERS=name1,name2` reuses MCP servers you already connected in Claude Code.
- **Rate limit.** The server allows 20 AI requests per 10 minutes by default. Raise it with `RATE_LIMIT_PER_10_MIN`.

## What you can do

### Canvas and editing

- Frames, groups, rectangles, ellipses, lines, arrows, polygons, stars, vectors, text, icons and images.
- Move, resize, rotate, flip and nest layers, with snapping, distance labels and equal-spacing guides. Hold ⌥ to measure.
- Pen, pencil and vector edit mode. Boolean union, subtract, intersect and exclude, plus flatten, outline stroke and masks.
- Rulers, layout grids, pixel grid, outline mode and per-corner radii (including elliptical corners).
- Figma's keyboard shortcuts come from one command registry. Search every command with **⌘K**. The shortcuts panel (**⌃⇧?**) lists the Figma shortcuts Qalam doesn't have yet, and why.
- **Pages**, as in Figma. A read-only **Components page** draws every component of the active design system in its own tokens and updates when a token changes.
- **Auto layout** (⇧A), laid out by Yoga (flexbox).
- Export PNGs, or export the whole document as JSON.

### Design systems

- **From a brief:** a Design system project interviews you about the brand. It reads back what it heard, proposes three directions and lets you refine one on real screens. Then you shape the components, the product's most complex one first, and save your tokens.
- **From screenshots:** drop up to three screenshots of a product and choose **Extract design system**. You choose the depth: tokens only, or tokens plus docs and component styles. Code measures colours, heights, corner radii and margins from the pixels, keeps the scales in order, checks text contrast, and lists every change it made. Then the first screenshot is rebuilt from catalog components with the new system and shown beside it, so you can compare the two.
- **Add component:** turn a screenshot of one component into a library component.
- **Token Detective:** paste CSS or a token export, or upload a screenshot. Qalam AI separates intent from coincidence: one hex used for a button, a toast and a price becomes three tokens.
- W3C DTCG tokens: colour, type, radius, spacing, borders, shadows, gradients and component recipes. Every property shows its token or an *Off-system* badge.
- Export as DTCG JSON, CSS variables or `design.md`.

### Generate

- Describe a screen. Qalam AI composes it from the catalog and your system's components, for phone, web page, dashboard or desktop app, in English, Arabic or both.
- **Plan first** (on by default): before drawing, Qalam AI says what it understood and asks a few questions about your product, each with a recommended answer. Skip them to use its picks.
- One screen by default. Ask for alternatives ("show me 3 options") and you get up to five.
- **Self-check:** every screen is validated and measured, and issues go back to the model once with the exact path. The repaired version replaces the original only if it has fewer issues.
- When nothing in the catalog fits, Qalam AI draws a **Graphic** in your system's colours and type, or defines a new component you can add to the library.
- **No design system:** Qalam AI picks a named look, code builds its tokens, and you can save the look as a system later.

### Review and tune

- **Critique:** select screens and click the **Critique** pill. Qalam AI reviews them against Nielsen's heuristics, hierarchy, content, accessibility and Arabic/RTL, using a render, the layer outline and the linter's findings. It then asks one question at a time (goal, audience, primary action) until it can say whether the design meets the goal. **Fix all** revises the screens in one undo step.
- **Audit:** a linter checks off-token values, WCAG 1.4.3, 1.4.4, 1.4.11 and 2.5.8, and RTL problems: unmirrored icons, Arabic set left-to-right, letter-spacing that breaks Arabic joining, and currency order. Many findings have one-click fixes.
- **Tune system:** tell Qalam AI what to change ("denser lists", "softer corners"). It proposes token and guidance changes. You pick which to apply, screens on the system follow at once, and you can undo them.
- **Direction:** flip a screen between LTR and RTL in place, or keep the original and add a mirrored copy. The copy is translated, and code checks each translation against its component's length limit.

### Prototypes

- Link screens on tap, press, hover or after a delay. Add states, entrance animations and sheets, dialogs, toasts and menus that open over a screen.
- **Present** (⌥⌘↵) compiles the screens to one React + Motion TSX file with no model call, plays it, and lets you copy or download it.
- Motion follows the platform: iOS springs and swipe-back, Android's Material curves, web cross-fades. Reduce Motion is respected.
- **Recipes** add common behaviour from what a scan of the screen finds: an options sheet behind a **+**, a basket bar with a live total, sticky section chips, a header that compacts on scroll, a confirm dialog.
- In a prototype session, Qalam AI proposes what to make work on the screen. Each step is built and kept only if the prototype still passes its checks.

### Discovery boards

- Map an outcome, the customer opportunities under it, and solutions and tests, as an Opportunity Solution Tree.
- Start from six questions about your product, from your research, from a recorded sample, or from a blank board.
- **Sources:** PDF, Word, Markdown, text, CSV, VTT/SRT transcripts, web pages (including public Google Docs), pasted text and items from connected tools. Qalam AI picks out what customers said. Code keeps a quote only if it finds it word for word in the source.
- An opportunity that Qalam AI drafted with no evidence behind it is marked **Assumed** until someone attaches a quote, an answer or a note.
- **Design this** carries a solution, the quotes behind it and its riskiest assumptions into a Screens project, where Qalam AI plans the screens with that context.

### Knowledge hub

- Answers, screen goals and critique verdicts are saved with the document, so the next critique asks only what it doesn't know yet.
- **Why this design?** traces each design back to what Qalam AI relied on: your answers, the system's rules and its research. A map and a timeline show the same knowledge.
- Edit a fact, tell Qalam AI to forget it, or pin it so it always applies.

### Chats and agents

- Every AI request is a turn in a chat, and later turns see earlier ones ("make the second one denser").
- Several requests can run at once. Each agent shows as a named cursor on the canvas, and you can follow it. Layers an agent is working on are locked until it finishes.

## Privacy

- **Your work stays in your browser.** Projects, documents, chats, images, Discovery sources and the knowledge hub are stored in your browser's IndexedDB. Design systems and preferences are stored in localStorage. Nothing is uploaded to a Qalam server, because there isn't one: Qalam's own server runs on your machine and only answers this computer.
- **What goes to the AI.** When you use an AI tool, the local server sends Anthropic what that request needs. That can include your prompt, earlier turns in the chat, the design system (including its source screenshots), screenshots you add, renders and layer outlines of the screens you selected, and the text of documents and pages you add to a Discovery board. With `AI_BACKEND=cli` it goes through Claude Code under your Claude account. With an API key it goes to the Anthropic API under your key.
- **Claude Code's access.** Qalam runs Claude Code with its tools turned off, from a temporary folder, without your settings or memory. It can't read or change your files. The research step allows only web search, web fetch and the MCP servers you configured.
- **Other services.** Research queries go to the services you turn on: Anthropic's web search, Tavily, or your MCP servers. Your machine fetches the web pages you add to a Discovery board and any Google Fonts a design system names.
- **Nothing is sent to the author.** Qalam has no analytics, telemetry or tracking.

## How it works

For contributors. The design rule throughout: **the AI chooses, code computes.** The model picks components, words and directions. Code measures, validates, repairs, and decides what lands on the canvas.

**Stack**

- React 19, built with Vite. A small local server (Hono) answers `/api/*`; its routes in `server/routes` are the only place model calls happen. In development it runs inside the Vite dev server, so the UI and the API share one address.
- CanvasKit (Skia over WebGL) for the canvas. Text goes through Skia's paragraph engine (HarfBuzz shaping, ICU bidi), so mixed Arabic and Latin lay out correctly.
- Yoga for auto layout and generated screens. zustand + immer for document state with transactional undo.
- Claude through `@anthropic-ai/sdk` with structured outputs, or through the local Claude Code CLI (`src/ai/cli.ts`). Both stream the same NDJSON to the browser.

**Key folders**

```
server/             the local server: routes (generate, plan, critique, extract-ds, tune-system, prototype, discovery, …), request guard
src/engine/         CanvasKit renderer, controller (tools, handles, snapping), vector tools, text, rulers
src/doc/            document model, store with undo/redo, ops, pages, auto layout, RTL mirroring, prototype data
src/design-system/  tokens (DTCG), component catalog and builders, pixel measurement, spec checks, extraction
src/ai/             prompts, JSON schemas, the API and CLI backends, research connectors, recorded samples
src/discovery/      Opportunity Solution Tree model, sources, quote matching, evidence, "Design this" handoff
src/proto/          routes, recipes, expressions, the headless runner that checks prototypes
src/codegen/        prototype compiler: screens → one React + Motion TSX file (no model call)
src/lint/           deterministic lint rules and fixes (the source of truth; the AI only explains)
src/knowledge/      the knowledge hub's facts, decision traces and graph
src/commands/       command registry, keyboard dispatcher, Figma shortcut catalog
src/projects/       projects and their storage (IndexedDB)
src/ui/             panels, toolbar, AI chat, prototype mode, Discovery and interview screens
```

**Commands**

```bash
pnpm dev         # start the studio (UI and server) on 127.0.0.1:3101
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest
pnpm build       # build the UI into dist/
pnpm start       # serve dist/ and the server from one process (after a build)
pnpm desktop     # build and open the desktop app (Electron)
pnpm desktop:dev # the desktop window on the dev server, with hot reload
```

Rules and checks must work across products, not just one app: name things by role, trigger on measurable conditions, and test on several kinds of product (see `src/proto/fixtures/`).

[AGENTS.md](AGENTS.md) has the notes for coding agents: where the UI, the server and the shared modules live, and what must never reach the browser.

## Roadmap

- One-command install: publish to npm so `npx qalam-studio` opens the desktop app, then a signed macOS app on GitHub Releases.
- Interview recordings on Discovery boards: drop in audio or video and get an Arabic or English transcript to quote from. Today, transcripts come in as VTT or SRT.
- More ways to bring in an existing design system, beyond screenshots, briefs and pasted tokens.
- More of Figma's editing features. The shortcuts panel lists what's missing.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The "Qalam" name and logo are not covered by the code license; see [TRADEMARKS.md](TRADEMARKS.md).
