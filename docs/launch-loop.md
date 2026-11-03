# Qalam Studio launch loop: the plan

Written November 3, 2026. Nothing here is built yet. Where this differs from `docs/v0.1.md`, this plan wins for the public launch; update that page as each phase lands.

**Who it's for:** people who build with Claude Code or Codex, on their own or in a small team, with an idea or a product and no time to research it properly.

**The promise:** describe what you want to build, or name a product. Qalam shows what people already complain about, ranked, with every quote checked by code. It then helps you pick who to build for and what to build first, and hands your coding agent a brief.

**What sets it apart:** local tools such as `/discovery` also check quotes, but they start from evidence you already have. Qalam starts from an idea and goes to find the complaints. That is the part to get right.

## The loop

1. **One box.** An idea, a product's name, a website or an App Store link. Code tells which, with no tokens.
2. **Read the space.** For an idea: find the closest competitors, then their complaints. For a product: its own complaints.
3. **Ranked problems.** Problem pages and faint cards appear on the canvas as they're filed, every line citing quotes found word for word. The chat says plainly when it found little.
4. **Up to 3 questions.** Drawn from what it read, always open to their own words.
5. **Who it's for.** 2 or 3 audiences backed by quotes. The person picks.
6. **A first goal.** About learning, not a business number: "5 of 10 of these people sign up". A suggested number is labelled and is nothing until they take it.
7. **Build first.** One solution for one problem, why, what to leave for later, the riskiest assumption and one test. Called "strongest signal so far", never "the best".
8. **Share or build.** A share card, a one-file report and a brief for their coding agent.

Steps 2 and 3 are where the value shows. They must work on a stranger's idea in the first session.

## Decisions this plan makes

Each one is a default to confirm before its phase starts.

| # | Decision | Why |
|---|---|---|
| 1 | Reddit is out. Qalam stops calling its JSON and says "paste the thread". | Reports citing Reddit's own posts say new API requests stopped on October 31, 2026 and public access closes in March 2027. Reading it without permission would go against its policy. Recheck the dates at launch. |
| 2 | A competitor's reviews never reach "We know". | They're real words, but not from this person's customers. Everything stays "We believe", labelled "what users say publicly". |
| 3 | Reviews of the person's own product count as what people said, only when they say the product is theirs. | They are that person's customers. It's one question at step 2, and Change it still works. |
| 4 | The loop is not behind the lab. Google Play, other engines and the MCP server are. | The loop is the product. The rest stays optional. |
| 5 | The brief, the report and the card are built by code from what's kept. | No new words from a model at the last step, so nothing unchecked reaches a public post. |
| 6 | The first run gets the one box first, with the current steps behind "Set it up properly". | A launch visitor shouldn't answer five steps before seeing a result. Name and shape get defaults they can change later. |

## What's reused and what's new

**Reused:**
- `lookForCompetitors` and `src/market/session.ts` for looking things up and picking up after a reload.
- `captureSource` with `scope: {}`, `rankNeeds`, topic pages, and `fetchGuarded`.
- `isDiscussion`, `isWall` and `withoutHandles`.
- `findQuestionsCall` and `sanitizeFindQuestions`, and the brain dump's `aim` for the answers.
- Draft solutions, `settleNumber` and `writeCard`.
- CanvasKit's PNG export in `src/engine/renderer.ts`.

**New:** `src/scan/` (pure), `server/org/scan.ts`, a `scan` job in `src/space/chat.ts` with its parts in `src/ui/space/chat/`, and `eval/loop/`. In code it's `scan`. People see "What people complain about".

## Phases

Each phase is one local commit once it's verified. Never push without asking. Check each with `pnpm typecheck`, `pnpm test`, and in the browser on `studio-test` for anything people see.

### 0. Starting point

- Main has about 40 uncommitted files from the connectors work. Land or set those aside first, then branch `launch-loop` in its own worktree.
- Say one thing everywhere: the README's first lines and `package.json`'s description now, and GitHub's description, which still says "AI design studio", with Ahmed's OK since it's public.

**Done when:** checks pass on the branch, and all three say the same thing.

### 1. Reading complaints, by code

No tokens to fetch. All of this lives in `src/scan/sources.ts` (pure) and `server/org/pages.ts`.

- **Finding an app:** `findApp(name, country)` through Apple's search API (`itunes.apple.com/search`, no key). A competitor's name is matched by code, then shown for the person to confirm. Apps have a country, so MENA products look in the right store.
- **App Store reviews:** read up to 10 pages of 50. Checked on one app on November 3: page 11 answers 400. Today's `postAddress` reads page 1 only.
- **Which reviews:** one read call fits about 20,000 characters (`CHUNK`, with at most 40 quotes), so `pickReviews` keeps 1 to 3 star reviews first, then 4 stars, the most voted (`im:voteSum`) and then newest within each, and no 5 stars. It says how many were read and how many were kept. The kept text stays exact, as quotes need.
- **Hacker News:** comment search through Algolia's API, by role ("Hacker News commenter"), `author` never kept, HTML removed with `htmlText`, and each comment's link kept as its origin. A model writes up to 3 searches (as `searchesCall` does); code runs them.
- **Other pages:** the research step as now, only pages `isDiscussion` accepts. Whether G2, Capterra or Trustpilot let code read them is untested; the eval in phase 2 shows it.
- **Reddit:** remove `postAddress`'s thread path and `redditText`, and skip Reddit links before fetching. Keep `why.reddit` by checking the link's host, so a Reddit link found still says to paste the thread. Fix the "until Qalam has a Reddit sign-in" line in `AGENTS.md`. Don't get around this with an anti-bot scraper such as Scrapling: Reddit's User Agreement bans scraping without written consent, and in July 2026 a court let Reddit's anti-circumvention claims proceed against a scraping tool and its user.

**Done when:** pure tests pass on saved answers, including no reviews, one review, a refused page and a handle in the words, and a live read of 3 real apps and 3 searches gives text with no usernames.

### 2. The scan, and the go or no-go check

This is the core. Don't build phases 3 to 5 until it passes.

- **The run:** `POST /api/org/:org/scan` answers at once and goes on in the core, as market lookups do. Progress is in `chats/scan/session.json`, so the chat follows it, a reload picks it up and Stop works.
- **What it reads:** at most 3 apps, 3 searches and 5 web pages. Each goes through `captureSource` as a `post` with `scope: {}`. Own-product reviews (decision 3) need a way past `s.kind === "post"` in `src/hub/pieces.ts`.
- **Labels:** `needLine` says "Nothing outside the team yet" for a problem that only has public words. It must say what's behind it ("14 quotes from people online · 3 sources") wherever it's shown: `ProblemsList`, `GoalPage`, `EvidenceStrip`. `strengthOf` stays as it is.
- **Thrown-out counts:** `sanitizeExtract` and `sanitizeFiling` report nothing about what they drop. Add counts by reason (`left`), kept on the session.
- **Thin results:** code decides, not the model. Under 3 problems or 10 kept quotes: "I found little", what it tried, and ways forward: paste threads, add a document, name a competitor.
- **`eval/loop/`:** 10 real inputs: 3 apps, 4 ideas with app competitors, 3 ideas with only web competitors. Like `eval:tiers`, it prints a plan and an estimate, and spends tokens only with `--yes`. It records time, tokens, problems, quotes kept and thrown out, and thin results reported.

**Go or no-go, read by a person:**
- Each kept quote is found on a fresh fetch of its page, and no username appears.
- 7 of the 10 give at least 3 problems that are specific to that product or idea.
- The 3 web-only ideas either work or say honestly that they found little.
- Side by side with plain Claude on the same idea, Qalam is clearly better on at least 7 of 10.
- A scan takes under 5 minutes, or the chat keeps showing real progress until it's done.

**If it fails, stop and rethink the loop.** A better share card won't fix weak results.

**Result, November 3, 2026 (`.qalam-dev/eval-loop/final/`, not in Git). What code measures passed; the comparison with plain Claude is for Ahmed to mark:**
- 588 quotes kept; 578 of the 578 re-checked were found on a fresh read, and 10 were on a page that couldn't be read again. 1 quote thrown out as not found, and no filed lines.
- 9 of 10 gave at least 3 problems. The tenth, a changelog tool, found nothing and said so.
- 73 to 269 seconds and 41,000 to 153,000 tokens per scan, averaging 150 seconds and 84,000.
- Three real runs before this one changed the design: read marketing copy as complaints, read gig-work reviews for a meal planner, and kept quotes from off-topic threads. The reader now hears what the person is looking into, and Qalam AI picks which apps are really used for the need.

**Known weak spots to carry forward:**
- Thrown-out counts are almost always 0, so "code threw out M" won't carry a share card. Say what was checked instead.
- G2, Capterra and Product Hunt refuse to be read (403), as do many forums. Plain Claude's search can name these pages but Qalam can't quote them, so a person can paste them.
- Hacker News searches still bring in loosely related threads, and names that are common words mislead ("Beamer" found LaTeX threads).
- Scanning two unrelated products in one project mixes them: a page titled about Duolingo's ads took MyFitnessPal's reviews about ads. One project per idea or product works; decide in phase 4 whether to say so, or to start a new project.
- Checked in the browser on a fresh home: the box, a scan from the first run and from the chat, an App Store link, Stop, Try again, a reload and "This is my product". Not yet checked on the installed Mac app, in light mode, or at phone width.

### 3. One box

Built on November 3, 2026. Decided while building: "This is my product" comes after the scan rather than as a question before it, so nothing stops the flow; an idea's problems are written in the idea's language, quoting people in theirs; the thread names only what was read, so a named competitor with no reviews doesn't show.

- **`scanInput` (pure, `src/scan/input.ts`):** App Store link, other web address, short name or idea text. A wrong guess costs one click to correct.
- **`routeOf`:** add a `scan` mode, and treat an App Store link as a scan. Keep today's routes for everything else, and test them with `src/space/route.ts`'s existing cases.
- **The thread:** a `scan` job in `src/space/chat.ts` with parts in `src/ui/space/chat/parts.tsx`: what it's reading, what it found, then the ranked problems. The problems panel opens when filing is done (`?panel=problems`).
- **The canvas:** problems arrive as faint cards under "No goal yet", the same way pages are drawn today. Check this at the first card and at 15 cards.
- **First run:** after the engine step, the one box. It makes the organization (shape `solo`, name from their words, changeable), then hands over to the canvas with `?scan=1` and `handWords`. "Set it up properly" keeps today's steps.
- **Empty canvas:** the box leads, above Write it and Help me find one.

**Done when:** on `studio-fresh`, a new person gets from the app opening to ranked problems with one sentence typed, and a reload midway picks up where it was.

### 4. Who, goal, what first

- **Questions:** `findQuestionsCall` with the scan's lines as what it may draw from; `sanitizeFindQuestions` as it stands. Answers run through the brain dump's `aim` so they stay their own source. Skipping is always allowed.
- **Audiences:** one call (`audiencesCall`, kind `scan-audience`, decide tier). `sanitizeAudiences` keeps at most 3, each citing at least 2 quotes it was sent, with its name's words in those quotes or in their answers (`wordsHold`). Reviews often don't say who wrote them, so with none kept: "These reviews don't say who wrote them", and it asks. The one picked becomes a segment page.
- **First goal:** worded by code from the audience and an action they choose (sign up, pay, come back). The numbers are suggested and labelled, using `settleNumber`'s rule, and only count once taken.
- **Build first:** Draft solutions on the top problem for that audience, then one call (`firstPickCall`) picks one draft, gives its reason and lists what waits. `sanitizeFirstPick` keeps only ids it was sent, and words and numbers found in what was sent. Any other draft is one click away.
- **The words:** "Strongest signal so far". Show what would prove it wrong (its riskiest assumption) beside it.

**Done when:** tests cover each sanitize rule with a made-up quote, name and number, and 3 of the eval's inputs reach a pick that a person agrees follows from its quotes.

### 5. Share and build

All built by code from what's kept (decision 5).

- **Brief (`src/scan/brief.ts`, `hub/briefs/<id>.md`):** the problem, its quotes with links, the audience, the goal, what to build first, what waits, the riskiest assumption, the test, who to talk to and what to ask (the page's Open questions), and a short note to the coding agent. Copy it or open the file. Qalam doesn't start the agent itself.
- **Report (`src/scan/report.ts`):** one HTML file with no network calls, in light and dark.
- **Card:** CanvasKit, using the PNG export in `src/engine/renderer.ts`, so Arabic shapes correctly. 1200×675: the problem, up to 3 short quotes with where each came from, and "Code checked N quotes and threw out M". Copy or save it. Check that clipboard images work at `qalam://app`.
- **What goes public:** short excerpts with links back, roles and never usernames, and nothing the person hasn't seen first. Posting stays theirs.

**Done when:** the card renders in English, Arabic and mixed text, with long titles and a zero thrown-out count; opening the report in a browser with the network off works; and following 5 quotes back from a brief finds each one.

### 6. Installing

- **npm:** remove `private`. Its `engines` of Node 24 is what development needs, not the launcher, so relax it for `bin/`. `prepack` already builds.
- **Check before publishing:** `electron` and `jszip` are the only dependencies, while `scripts/stage-app.mjs` adds `node-llama-cpp` only for the Mac app. Find out what `npx` loses (meaning search?) and either add it or make sure the app says so. The voice and screenshot helpers are built for this Mac; check they're skipped cleanly elsewhere.
- **Test:** `npm pack`, install the file in a clean macOS user, run it, reach ranked problems.
- **Publishing to npm and a new release** are Ahmed's to approve when the time comes. The Mac app stays signed ad hoc.

**Done when:** a clean user gets from `npx qalam-studio` to ranked problems.

### 7. Trying it without an engine

- **Sample:** "Try it with a sample" from `eval/retrieval/basket.ts`, no tokens, as `docs/v0.1.md` has asked for.
- **Claude Code plugin:** after launch, unless everything else is finished early. A plugin with a skill and an MCP server (`qalam-studio mcp`) that serves `orgTools` from `server/ask.ts` beyond one call, behind the lab. It lets the coding agent ask why.

**Done when:** the sample opens with ranked problems in under a minute, with no engine configured.

### 8. Before going public

Run in this order:

1. `docs/v0.1.md`'s checklist, updated for this loop: clean account with Claude Code, then Codex, and every quote on 3 pages followed back.
2. **Watch 3 to 5 people** run it on their own idea or product, in a call. Move on when 3 reach ranked problems on their own, and at least one says it showed them something they hadn't seen. Fix what they trip on first.
3. Update `AGENTS.md`, `README.md` and `docs/v0.1.md` with what was built, including what the app fetches from the web.
4. A 60 to 90 second video of one real run, ending on the card.
5. **The post:** native video, the link in the first reply, and "Reply with your idea or any app". Batch replies, and watch plan limits (`GET /api/engine/limits`).

Posting and picking demo subjects stay with Ahmed.

## Rules for all of it

- The model proposes and code verifies: quotes found word for word, numbers only where the source has them, ids only from what was sent. A suggested goal number is the one labelled exception, as today.
- Never keep a username. Quote people by role.
- A person's word stands. Audiences, goals and picks are theirs to change, and Qalam AI never rewrites their lines.
- Public words stay labelled as public, everywhere they're shown.
- Say when there's little. A confident answer on thin data is the worst outcome.
- Every fetch goes through `fetchGuarded`, and a page already read in a scan isn't fetched again.

## Risks

- **Weak results:** the largest risk. If a scan reads like plain Claude's answer, nothing else matters. Phase 2's check is there for this.
- **Thin coverage:** App Store reviews need an app, and many ideas only have web competitors. Hacker News and paste help, but this may stay the loop's weak spot.
- **Depending on outside sources:** Apple's feed and Algolia's API could change or close, and their terms haven't been read yet. Read them before phase 6. A source that fails says so; the scan goes on with the rest.
- **Cost and time:** a scan may use up to about 10 extract calls plus filing. The eval measures this. If it's too much for a plan's limits, read fewer sources before anything else.
- **Attention before readiness:** the launch only happens once. Don't post until phase 8 is met.

## Not in this launch

Google Play (behind the lab first, after checking its terms), Reddit, Design this, other engines, goal extras, feeds, more connectors, teams, Windows.

## Start here

Phases 0 to 2, then stop and read the eval together. Everything after that depends on what it shows.
