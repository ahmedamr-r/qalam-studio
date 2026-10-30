# Engines

Qalam AI runs on the engine picked in **Connections ▸ Qalam AI**. Every engine answers the same structured calls, and Qalam's checks keep only what holds, whichever model wrote it. The model proposes, and code verifies.

## The engines

| Engine | How it's reached | Who pays | Web search | Checked |
|---|---|---|---|---|
| Claude Code | The person's own `claude`, signed in with their Claude plan | Their Claude plan | Claude Code's own, plus their MCP servers | Live |
| Codex | The person's own `codex exec`, signed in with ChatGPT (on the PATH or inside ChatGPT.app) | Their ChatGPT plan | Codex's own | Live (Codex 0.155, October 2026) |
| Anthropic API key | The Claude API, key in the Keychain | The key | Claude's server tools | Live |
| OpenAI API key | Chat Completions (strict JSON schema); research through the Responses API | The key | `web_search` | From the docs |
| Gemini API key | Gemini's OpenAI-compatible endpoint; research through its own API | The key | Google Search grounding | From the docs |
| OpenRouter key | Its chat API, only providers that take the schema | The key (OpenRouter reports the cost) | Its web plugin | From the docs |
| Ollama, LM Studio | Their OpenAI-compatible server, at an address on this computer only | Nothing | Through Tavily, with a Tavily key | Against a stand-in server |

"From the docs" means the request and the answer were written from the provider's documentation and tested against stubbed answers, not yet against a real key. Check one with a real key before saying it works.

## Rules each engine keeps

- **Signed in through its own flow.** Qalam runs the person's own unmodified `claude` and `codex`, and asks them who's signed in (`claude auth status`, `codex login status`). It never reads their credentials.
- **The plan pays when it's a plan.** Codex runs without `OPENAI_*` or `CODEX_API_KEY` in its environment, and Claude Code without `ANTHROPIC_*`, so a key in the shell can't take over from the sign-in.
- **Gemini by key only.** Google doesn't allow other tools to use Gemini CLI's sign-in, so Qalam doesn't offer it.
- **Keys in the Keychain.** A key goes in on stdin, is kept only once a live test passes, and only its last four characters come back out.
- **Nothing of the person's setup leaks into a call.** Claude Code runs without its settings, CLAUDE.md or MCP config. Codex runs from an empty folder, ephemeral, with its shell, apps, plugins, skills, AGENTS.md and web search off, and with the call's instructions in place of its own.

## Picking models for another engine

Claude's models are chosen by job (`src/ai/models.ts`). For any other engine, the person picks the model that decides and, if they want, a smaller one that reads, from the engine's own list. Codex uses its own choice until one is picked.

Before recommending a model for a tier, compare it with Claude on the Basket sample:

```bash
pnpm eval:tiers --engine codex --baseline cli
```

Without `--yes` it only prints the plan and the estimate. With `--yes` it runs Claude's Opus beside the engine's model (`--model` names one) on the read calls and on drafting solutions. A model holds a tier when it keeps at least 90% of what Claude keeps on every call of that tier.

## Sign in with ChatGPT

OpenAI lets a limited set of partner apps offer "Sign in with ChatGPT", so people use their ChatGPT plan inside the app without a CLI. That would let someone with ChatGPT and no Codex use Qalam AI.

**To do (not code):** complete OpenAI's interest form, linked from its help article on [Sign in with ChatGPT](https://help.openai.com/en/articles/20001410). The form asks how many people use the app, how it charges for AI features, and whether it already uses OpenAI's API. Nothing is built for it until OpenAI accepts the app and its terms are read.

## Before launch

- Read Anthropic's current page on running Claude Code from other tools again.
- Read OpenAI's terms for using a ChatGPT plan through Codex in other tools, and Sign in with ChatGPT's if accepted.
- Check the OpenAI, Gemini and OpenRouter paths once each with a real key.
