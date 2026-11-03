# Qalam Studio launch loop: the plan

Written November 3, 2026. Nothing here is built yet. Where this differs from `docs/v0.1.md`, this plan wins for the public launch; update that page as each phase lands.

**Who it's for:** people who build with Claude Code or Codex, on their own or in a small team, with an idea or a product and no time to research it properly.

**The promise:** describe what you want to build, or name a product. Qalam reads what people already complain about, what others offer and charge, and what's been published, and ranks the problems, every quote linked to where it was said. It then helps you pick who to build for and what to build first, and hands your coding agent a brief.

**What sets it apart:** local tools such as `/discovery` also check quotes, but they start from evidence you already have. Qalam starts from an idea and goes to find the complaints. That is the part to get right.

## The loop

1. **One box.** An idea, a product's name, a website or an App Store link. Code tells which, with no tokens.
2. **Read the space.** For an idea: find the closest competitors, then their complaints. For a product: its own complaints. For both: what others offer and charge, and what's been published (market reports, studies, articles), always shown as read elsewhere.
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
- Thrown-out counts are almost always 0, so "code threw out M" won't carry a share card, and screens don't say how it works anyway.
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
- **Audiences:** one call (`audiencesCall`, kind `scan-audience`, decide tier). `sanitizeAudiences` keeps at most 3, each citing at least 2 quotes it was sent, with its name mostly in those quotes' or their answers' words (`nameRests`; `wordsHold` was too strict: it turned down "Batch cookers" over "cook", and every audience on the first real scan). Reviews often don't say who wrote them, so with none kept: "These reviews don't say who wrote them", and it asks. The one picked becomes a segment page.
- **First goal:** worded by code from the audience and an action they choose (sign up, pay, come back). The numbers are suggested and labelled, using `settleNumber`'s rule, and only count once taken.
- **Build first:** Draft solutions on the top problem for that audience, then one call (`firstPickCall`) picks one draft, gives its reason and lists what waits. `sanitizeFirstPick` keeps only ids it was sent, and words and numbers found in what was sent. Any other draft is one click away.
- **The words:** "Strongest signal so far". Show what would prove it wrong (its riskiest assumption) beside it.

**Done when:** tests cover each sanitize rule with a made-up quote, name and number, and 3 of the eval's inputs reach a pick that a person agrees follows from its quotes.

**Built November 3.** The whole loop ran in the browser on the real meal-planner scan: questions, audiences, a first goal, a first pick, and goal, problem, solution and test on the canvas, still there after a reload. Whether the pick follows from its quotes on 3 inputs is still for a person to mark.

**Research went wider while building this,** on Ahmed's word: not only people's quotes. A scan also reads what's been published (reports, studies, articles: up to 4 pages, as read elsewhere) and what others offer and charge (each one's `/pricing` and app page, read by code, kept in `hub/market.md`). People's words alone decide who it's for, what comes first and whether it found little.

| Three real scans | Quotes only | Wider |
|---|---|---|
| Time | 147–164 s | 163–281 s |
| Tokens | 66k–104k | 141k–201k |
| Points kept | 57–71 | 66–124 |
| Quotes found again on a fresh read | all | all that could be re-read (511 of 511, 4 on a page that wouldn't open again) |

What it added: Duolingo's own numbers and a market size, 56% of US small businesses with unpaid invoices beside freelancers' complaints, a study of night workers' diets, and real prices (Babbel at $17.95 a month, Shift Fuel Pro at $2.99).

**Weak spots seen:**
- A vendor's "statistics" roundup and press releases can pass as published research. They say where they came from, and the reader can see whose page it is, but nothing rates them.
- A page of what's published can start a problem page of its own ("4 read elsewhere"). It ranks last and says so, and it can't reach who it's for or what comes first.
- A price is paired with its product only as far as a page names both; code can't check the pairing.
- The App Store's page and many `/pricing` pages don't always show a price, so some competitors have none.

### 4b. Questions while it reads

A scan takes a few minutes, and most of that is the last step: reading pages and sorting them into problems. So the wait is when someone can still turn it. Nothing waits on them: it goes on unanswered, and a late answer only reaches what hasn't been read yet.

| When | Question | What it changes |
|---|---|---|
| As it starts | How it took them: "You want a meal planner built around night shifts. Right?" | What the searches and the reader hear, from their correction or their yes |
| As it starts (an idea) | "Who do you picture using this first?" | The same, plus who it's for later on |
| As it starts | "Anything you've seen yourself that I should look for?" | The same, and it's kept as their own words |
| Once it's found them | What it found people using, each one with a way to take it off | Its reviews aren't read into anything, and it isn't proposed again |

- **Their words say where to look first, never what to find** (`focusWith`). Otherwise "nurses" gets only what agrees with them. What points elsewhere or speaks against it stays.
- **Not asked twice:** "Work out what to build first" asks only what's left, and their answers join its own.
- **Say it back:** one short call from their words alone, since there's nothing read yet. Its kinds of people are choices a person decides, never claims, and without numbers. With no engine, or nothing back in time, code asks the same questions in the open.

**Done when:** tests show an answer reaching the reader and a competitor taken off never read into anything, and a real scan answered mid-way comes out different from the same scan left alone.

**Built November 3.** "A tool that helps wedding photographers get paid on time", in the browser, the same idea twice. The questions came up about 10 seconds in. Answered ("Solo wedding photographers", "Couples who pay a deposit then ghost the final invoice after the wedding", one app taken off) by 0:38, before it had finished finding competitors:

| | Answered | Left alone |
|---|---|---|
| Ranked first | "Couples don't pay the balance once the wedding is over" (43 quotes) | "My client paid, but the money is held or arrives weeks late" |
| That same problem | | "Once couples have the final product, they stop paying", filed ninth |
| Kept that they never mentioned | Money held by payment platforms, fees, tools that fail to send invoices | |
| Problems, points | 8, 152 | 10, 207 |

Its searches turned too ("wedding photographer forum client won't pay final balance after wedding"), the app taken off was never read, and "Work out what to build first" then asked new questions that built on the answers ("Which fix would you try first for the post-wedding ghosting?").

**Weak spot:** the left-alone scan took 6 minutes, nearly all of it filing 207 points. Worth capping what's read before launch.

### 5. Share and build

All built by code from what's kept (decision 5).

- **Brief (`src/scan/brief.ts`, `hub/briefs/<id>.md`):** the problem, its quotes with links, the audience, the goal, what to build first, what waits, the riskiest assumption, the test, who to talk to and what to ask (the page's Open questions), and a short note to the coding agent. Copy it or open the file. Qalam doesn't start the agent itself.
- **For the coding agent to act on** (from a PRD skill Ahmed shared, November 3): the first build as a few features, each with acceptance criteria someone can check, the data it keeps, and what it connects to, each linked to the quotes behind it. Written by one call and marked as suggestions, since none of it is what anyone said. Just before writing, it asks only what the brief still lacks: the platform, what exists already, must-haves, accounts or payments. Left out from that skill: stack and scalability advice nothing could check (the agent chooses), and announcing which tool it's using.
  - **On any card, as a tile (Ahmed, November 3):** "Write a brief" is a next step on a goal, a problem and a solution, not only at the end of a scan. It lands as a tile under its card, wired down from it, and clicking it opens the right panel with the Markdown set as a document. One brief a card, in `hub/briefs/`. Checked in the browser on all three kinds, and across a reload.
  - **Built November 3:** on the wedding-photographer idea it wrote 3 features in under 40 seconds, each with criteria someone can check, and it kept to what was said ("The form works without signing up or logging in", after "Neither" for accounts and payments). All 20 distinct linked quotes were found again on a fresh read of their pages.
- **Report (`src/scan/report.ts`):** one HTML file with no network calls, in light and dark.
- **Card:** CanvasKit, using the PNG export in `src/engine/renderer.ts`, so Arabic shapes correctly. 1200×675: the problem, up to 3 short quotes with where each came from, and how much was read ("84 quotes from 7 places"). Copy or save it. Check that clipboard images work at `qalam://app`.
- **What goes public:** short excerpts with links back, roles and never usernames, and nothing the person hasn't seen first. Posting stays theirs.

**Built November 3:** the card was drawn in English, Arabic and mixed text and with a very long title, and leaves a quote that doesn't fit off whole. The report fetches nothing. Not checked yet: copying an image in the installed app at `qalam://app` (the preview pane refused, and it said so, with Save image beside it), and light mode by eye.

**Done when:** the card renders in English, Arabic and mixed text, with long titles; opening the report in a browser with the network off works; and following 5 quotes back from a brief finds each one.

### 6. Installing

- **npm:** remove `private`. Its `engines` of Node 24 is what development needs, not the launcher, so relax it for `bin/`. `prepack` already builds.
- **Check before publishing:** `electron` and `jszip` are the only dependencies, while `scripts/stage-app.mjs` adds `node-llama-cpp` only for the Mac app. Find out what `npx` loses (meaning search?) and either add it or make sure the app says so. The voice and screenshot helpers are built for this Mac; check they're skipped cleanly elsewhere.
- **Test:** `npm pack`, install the file in a clean macOS user, run it, reach ranked problems.
- **Publishing to npm and a new release** are Ahmed's to approve when the time comes. The Mac app stays signed ad hoc.

**Done when:** a clean user gets from `npx qalam-studio` to ranked problems.

**Built November 3.** Tried from a packed tarball, with empty npm and Electron caches, a bare environment and throwaway folders. Not a separate macOS user, so Claude Code's sign-in was this Mac's, and not from the npm registry, since nothing is published yet.

| | Result |
|---|---|
| Package | 20 MB to download, 50 MB unpacked, no source maps (17 MB of them left out) |
| Installed with what it pulls in | 395 MB, of which Electron is 258 MB |
| `npx` to a window, nothing cached | about 90 seconds (87 and 95), 102 on an Intel Node |
| One sentence to ranked problems, questions left unanswered | 293 seconds: 9 problems from 95 quotes, from 2 Hacker News threads and 4 forum pages |

- **Node:** Electron 45 needs Node 22.12 or newer just to fetch itself, so `engines` says that, not the 18 this plan guessed. On anything older the launcher now says what to do instead of a stack trace.
- **What `npx` loses:** nothing on a native Node. npm installs `node-llama-cpp` as an optional dependency, so search by meaning works. On an Intel Node on an Apple silicon Mac (common after migrating from an older Mac) its install refuses to run and npm drops it: search goes by words, and Connections now says so.
- **The Mac helpers** are arm64, and `scripts/check-pack.mjs` stops a pack that lacks them, since the build itself goes on without them. An Intel Mac or another system runs without them: a helper that can't start is logged and its features are off.
- **Also seen working in the installed app:** search by meaning on a native Node, the "Not on this install" row on an Intel Node (once there's anything to index), and Copy image, a 1200×675 PNG on the clipboard.
- **What it turned up:** Apple's review feed had been answering for few apps (see below), so a scan could end with no reviews and not say why; a page now goes through each spelling of the address. And "Read it as a product's name" was offered for a whole sentence, which reads nonsense as a name; it's offered up to 5 words now.
- **Not tried:** an Intel Mac, Windows through `npx`, and the installed Mac app from this branch.
- **The name** `qalam-studio` is free on npm as of November 3.

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
- Screens say what you get, not how it works. How it's kept honest belongs in the README, never in the flow (Ahmed, November 3).
- Research isn't only quotes. People's words decide who it's for and what comes first; what competitors offer and charge and what's been published sit beside them, always saying where they came from, and can't make up for people's words when a scan found little (Ahmed, November 3).
- Every fetch goes through `fetchGuarded`, and a page already read in a scan isn't fetched again.

## Risks

- **Weak results:** the largest risk. If a scan reads like plain Claude's answer, nothing else matters. Phase 2's check is there for this.
- **Thin coverage:** App Store reviews need an app, and many ideas only have web competitors. Hacker News and paste help, but this may stay the loop's weak spot.
- **Depending on outside sources:** Apple's feed and Algolia's API could change or close. A source that fails says so; the scan goes on with the rest. Terms read November 3 (a reading, not legal advice; see below).
- **Cost and time:** a scan may use up to about 10 extract calls plus filing. The eval measures this. If it's too much for a plan's limits, read fewer sources before anything else.
- **Attention before readiness:** the launch only happens once. Don't post until phase 8 is met.

## What the sources' terms say

Read November 3, 2026. A reading, not legal advice: worth a lawyer's look if this ever earns money.

- **Apple's website terms** bar any "page-scrape", "robot" or other automatic program reading the site, except through means "purposely made available". So:
  - App Store web pages are never read by code (`isApplePage`, in `readPage`). The price step had started doing this and was changed: it reads each product's own `/pricing` page, finding the site through `sellerUrl` in Apple's search API.
  - The **search API** is documented, at about 20 calls a minute. A scan makes a handful.
  - The **review feed** is a public JSON feed with no documentation and no promise. It's plausibly "purposely made available", but that's not certain, and Apple could close it. It's also unreliable: each spelling of its address is cached apart and any can be empty for hours. Across 12 apps on November 3, the one address Qalam used had reviews for 2, and seven spellings together for 10. A scan that ends with no reviews is often this, not the app.
- **Republishing reviews:** the same terms bar republishing content "for publication or distribution or for any commercial enterprise" without consent, and Apple tells developers reviews go in marketing only with the reviewer's permission. Reading reviews on one's own computer is one thing; a share card or report with App Store quotes, posted publicly, is closer to that line. Open: whether the card should prefer other sources' quotes.
- **Hacker News:** Y Combinator's terms bar scraping and commercial use "unless otherwise expressly authorized", but HN publishes its data through an official API and links Algolia's search API, documented at 10,000 requests an hour per IP. Fine as a free tool run by each person. Read this again before charging for anything.
- **Reddit:** not read at all (phase 1).

## Not in this launch

Google Play (behind the lab first, after checking its terms), Reddit, Design this, other engines, goal extras, feeds, more connectors, teams, Windows.

## Start here

Phases 0 to 6 and 4b are built, on the branch `launch-loop`, not pushed (November 3). Next: phase 7, trying it without an engine. Still for a person to mark: whether scans beat plain Claude (`.qalam-dev/eval-loop/final/`), and whether a pick follows from its quotes on 3 inputs.
