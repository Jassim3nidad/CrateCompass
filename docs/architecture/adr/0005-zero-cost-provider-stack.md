# ADR 0005 — Zero-cost provider stack

Status: Accepted 2026-08-04  
Date: 2026-08-04  
Amends: [ADR 0004](0004-openrouter-ai-provider.md)

## Context

The project has a hard budget of **$0.00** — no billing card, no prepaid
credits, not even fractions of a cent. ADR 0004 chose OpenRouter on the basis
that it was pay-as-you-go from a small balance, which is cheap but not free.

Two components were audited against the constraint.

## Component audit

| Component | Cost | Resolution |
| --- | --- | --- |
| Next.js, React, Tailwind, Zod | Open source | ✅ |
| Supabase | Free tier, no card | ✅ |
| Vercel | Hobby tier, no card | ✅ |
| MusicBrainz | Open data | ✅ |
| ListenBrainz | CC0 | ✅ |
| AI provider | Anthropic, OpenAI and OpenRouter all require funds | **Changed** |
| Spotify | Requires the app owner to hold Premium | **Already held** |

### Spotify

Spotify's Development Mode requires the app owner to have an active Premium
subscription. There is no free path around this — it is stated plainly in
Spotify's own documentation. The owner already holds Premium, so this is a
pre-existing cost rather than one the project introduces, and **no feature is
lost**. Had that not been the case, the fallback was to disable Spotify
entirely: Phase 3 built it as an optional connected account, `/settings/connections`
already renders a `not-configured` state, and discovery, discography and
library all function without it. Only playlist export depends on it.

## Decision

**Use Google AI Studio (Gemini) as the default AI provider, on
`gemini-3.5-flash-lite`.**

Verified against Google's documentation on 2026-08-04:

- The free tier requires **no billing account** — "no billing setup necessary".
- It exposes an OpenAI-compatible endpoint at
  `https://generativelanguage.googleapis.com/v1beta/openai/` that accepts
  `response_format` with a JSON schema.
- Free-tier models include `gemini-3.5-flash-lite`, `gemini-2.5-flash-lite`
  and `gemini-3.6-flash`.

Because the endpoint is OpenAI-compatible, the adapter reuses the already-tested
`openai` client and `zodResponseFormat` path. The schema-constrained design
survives intact — unlike OpenRouter's free tier, where **no** zero-priced model
supports structured outputs (ADR 0004).

The Anthropic, OpenAI and OpenRouter adapters all remain in place. Switching is
an environment change.

## The trade, which is not money

Google's pricing documentation states that free-tier content **is used to
improve Google's products**, while paid-tier content is not.

`parseMood`, `answerDiscographyQuestion`, `generatePlaylistTitle` and
`generatePlaylistDescription` all carry the user's own words. On this provider
that text becomes training data.

This is a **larger disclosure obligation than the OpenRouter routing concern
recorded in ADR 0004**, and it is a privacy question rather than a cost one:

- The privacy notice must state that user-authored text is sent to Google and
  used to improve Google's products, before any pilot user other than the
  developer uses the product.
- Free-tier rate limits (per minute and per day) are real. The adapter maps a
  429 to a recoverable failure so the deterministic fallbacks engage rather
  than the request failing hard — a free tier is expected to run out.

This ADR records the exposure; it does not clear it. It remains a Phase 10
legal-review item.

### Disclosure implemented in Phase 6

The first surface that accepts free text from a listener — the discovery
explanation panel — now states the exposure beside the field itself, because
someone deciding what to type needs it at that moment rather than in a policy
page they have not opened. The wording is provider-specific and computed
server-side (`lib/ai/disclosure.ts`, exercised by
`tests/unit/ai-disclosure.test.ts`).

This does not discharge the obligation. A privacy notice covering every AI
surface is still required before any pilot user other than the developer uses
the product, and Phase 7 adds a second free-text surface that must carry the
same disclosure.

## Unchanged

The Spotify-to-AI prohibition is untouched. The gateway's strict input schemas
make Spotify-sourced evidence unrepresentable regardless of which provider is
selected, and the contract suite proves zero outbound calls for rejected input
against **all four** adapters.

## Operational note

Supabase free-tier projects pause after a period of inactivity. For a student
project with intermittent use this will show up as connection failures after a
quiet week; the project is resumed from the Supabase dashboard.
