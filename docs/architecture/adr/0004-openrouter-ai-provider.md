# ADR 0004 — OpenRouter as the default AI provider

Status: Accepted 2026-08-04  
Date: 2026-08-04  
Phase: 5 amendment  
Amends: the Phase 5 decision to default to Anthropic / `claude-opus-5`

## Context

Phase 5 shipped with Anthropic as the default provider. That decision assumed
funded Anthropic or OpenAI accounts. Both require prepaid credit, which the
project does not currently have — a hard blocker, not a preference.

OpenRouter is pay-as-you-go from a small balance and exposes an
OpenAI-compatible API, so it removes the blocker without changing the product.

## Decision

**Use OpenRouter as the default AI provider, on `google/gemini-3.1-flash-lite`.**
The Anthropic and OpenAI adapters remain in place and switching back is an
environment change.

### Why not the free tier

The initial request named `qwen/qwen3.7-flash` on the basis that OpenRouter is
free. Two findings, both verified against OpenRouter's live catalogue on
2026-08-04:

1. **`qwen/qwen3.7-flash` does not support structured outputs.** It is absent
   from `?supported_parameters=structured_outputs`, while `qwen3.7-plus`,
   `qwen3.7-max`, `qwen3.8-max` and `qwen3.6-flash` are present.
2. **No free model supports structured outputs.** Filtering that same list for
   zero prompt *and* completion pricing returns nothing.

Every AI call in this codebase is schema-constrained and Zod-validated. A model
without structured-output support would have to be prompted for JSON and hoped
at, which is precisely what the compliance plan's structured-output requirement
exists to prevent. So "free" and "correct" are mutually exclusive here, and
correctness wins.

### Why this model

Measured cost at the configured limits (20 calls/user/day, 5-user pilot) is
around **$0.003/day** — a live smoke test used 45 input and 60 output tokens for
a representative mood parse. `nex-agi/nex-n2-mini` is ten times cheaper again,
but two of the five operations are grounded question-answering where
fabrication is the central risk, and an unknown-quality model is a poor trade
for a saving already measured in fractions of a cent.

`OPENROUTER_MODEL` is environment-configurable, so this is reversible without a
code change.

## Consequences — added subprocessors

This is the part that outlives the cost question.

OpenRouter is a **router**. A request now reaches at least two parties that the
Anthropic and OpenAI adapters do not involve:

| Party | Role |
| --- | --- |
| OpenRouter | Receives and forwards every prompt |
| The upstream model host | Runs the model (Google, for the configured default) |

What travels, and whether it matters:

| Input | Sensitivity | Assessment |
| --- | --- | --- |
| MusicBrainz facts | Open data | No concern |
| ListenBrainz evidence | CC0 (ADR 0003) | No concern |
| **User-authored mood text and questions** | **Personal data** | **The exposure** |

`parseMood`, `generatePlaylistTitle`, `generatePlaylistDescription` and
`answerDiscographyQuestion` all carry the user's own words.

**Open item for the Phase 10 legal review, not resolved here:**

- The privacy notice does not currently name OpenRouter or the upstream model
  host as processors of user-authored text. It must before any pilot user who
  is not the developer uses the product.
- The roadmap already lists international processing as a Phase 10 review item.
  Routing user text through a router to a third-party model host is exactly that
  case, and the upstream host varies with `OPENROUTER_MODEL`.

This ADR records the exposure; it does not clear it.

## Also unchanged

The Spotify-to-AI prohibition is untouched. Spotify data could not reach
OpenRouter any more than it could reach Anthropic — the gateway's strict input
schemas make Spotify-sourced evidence unrepresentable, and the contract suite
proves zero outbound calls for rejected input against all three adapters.

## Implementation note

The adapter uses the already-vendored `openai` client pointed at
`https://openrouter.ai/api/v1` rather than `@openrouter/sdk`. OpenRouter
documents that path, it reuses the structured-output code the other adapters
already exercise, and it avoids a second SDK surface for no gain.
