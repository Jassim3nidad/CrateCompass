# AI providers

A model is used for **language, never for facts**. It explains evidence the
providers supplied, turns a listener's words into reviewable criteria, and
answers questions from retrieved records. It never decides what is true.

---

## The interface

Provider-neutral, in `lib/ai/provider.ts`:

| Operation | Purpose |
| --- | --- |
| `parseMood` | Free text → structured discovery criteria |
| `explainArtistMatch` | Supplied evidence → a reading of that evidence |
| `answerDiscographyQuestion` | Retrieved releases + a question → a cited answer |
| `generatePlaylistTitle` | Approved inputs → a title |
| `generatePlaylistDescription` | Approved inputs → a description |

Four adapters implement it — OpenAI, Anthropic, Gemini, OpenRouter — plus a
fixture adapter for tests. All pass the same contract suite. Product logic never
names a model; model identifiers are environment configuration.

```
AI_PROVIDER=gemini        # openai | anthropic | gemini | openrouter
GEMINI_API_KEY=
GEMINI_MODEL=
```

Only the selected provider's credentials are required, so switching provider is
configuration rather than a deployment change.

---

## The boundary

**No Spotify content ever reaches a model.** Every call passes `buildAiInput`
(`lib/ai/gateway.ts`), which applies four checks in order:

1. **Strict schema parse.** Unknown keys are rejected. A field not in the schema
   cannot travel, whatever it contains. This is the primary control.
2. **Provenance allowlist.** Any `provenance` value must be one of
   `musicbrainz`, `listenbrainz`, `user`, `application`. Spotify is not on the
   list, so Spotify-derived data is caught even carrying no telltale string.
3. **Recursive content scan.** Forbidden keys, `spotify:*:` URIs,
   Spotify-controlled hosts (`spotify.com`, `scdn.co`, `spotifycdn.com`) and
   credential-shaped strings, at any depth.
4. **Caps.** 12 levels deep, 60,000 serialised characters.

`buildAiInput` **returns the parsed clone**, and callers must send what it
returns. Sending the original object would bypass the schema strip that makes
check 1 meaningful.

Three further layers sit outside the gateway: branded types that make Spotify
values non-assignable to AI inputs, ESLint rules keeping the module trees
disjoint in both directions, and a compliance test that reads the source tree
and asserts all of it.

**Spotify data is never used to train, fine-tune, evaluate, or profile a model.**

---

## Structured output, and why the prompt is not the control

Every operation returns a Zod-validated schema. Invalid output is a failure, not
something to coerce.

More importantly, the guarantees are enforced **after** the model answers rather
than requested politely in a prompt:

- **Explanations.** Every entry the model lists in `groundedIn` must correspond
  to a supplied evidence statement, and any suggested starting point must be one
  of the supplied release identifiers. Fail either check and the whole output is
  discarded in favour of a deterministic template that restates provider facts.
- **Discography answers.** Every citation must name a release that was actually
  supplied. A fabricated identifier discards the answer.
- **"Not enough context" is a first-class success**, not an error. It is the
  honest answer the product promises instead of a plausible sentence.

What post-answer checking **cannot** catch, stated plainly because it motivates
the input neutralisation: an injected string steering the model into refusing a
legitimate question, or into describing a genuinely-supplied release wrongly
while citing it correctly. Post-answer checking sees the citation, not the
sentence.

## Prompt injection

Release titles are community-edited and reach the model as context. See
[`musicbrainz.md`](musicbrainz.md) for the neutralisation applied on the
discography path.

> **Open gap:** the explanation path interpolates provider-supplied artist
> names, evidence statements and release titles without that neutralisation.
> Recorded as SEC-05.

## Usage limits

Enforced in Postgres by `claim_ai_usage`, which **fails closed**:

- 20 requests per user per day
- 4 per user per minute (per-operation overrides exist)

A slot is claimed *before* the request. One pass through the mood flow spends
three. Tests must use a fresh account per test or they trip a limit that is
working correctly.

A usage-limit refusal deliberately **does not** fall back. Falling back would
hand the listener a result and hide the fact they hit their allowance, making
the limit invisible and unactionable.

## Failure behaviour

Recoverable provider failures fall back to deterministic templates that restate
provider facts and say plainly that the relationship is reported rather than
characterising music nobody supplied evidence about. Timeouts and bounded
retries on every call. Provider errors never leak a raw body to the browser.

Token usage is logged for cost visibility. The logger redacts any key matching
`/token/i`, with a narrow allowlist exempting a fixed set of usage-count keys
and only when the value is numeric — a number cannot be a bearer token, so the
exemption cannot leak a credential.

## Cost

Gemini Flash-class models on the free tier, with the per-user limits above, keep
a five-user pilot at negligible cost. Verify current pricing before widening;
the abstraction means switching provider is a variable change.

## Testing

The fixture adapter still calls `buildAiInput`, so the boundary gateway runs
exactly as in production. Fixtures are gated on `APP_ENV=test` **and**
`PROVIDER_FIXTURES=1` together, and the schema refuses to validate that flag
outside a test environment — a deployment carrying it fails to boot rather than
serving invented artists.
