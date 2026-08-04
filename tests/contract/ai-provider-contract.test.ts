import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AiBoundaryViolationError } from "@/lib/ai/gateway";
import { AiProviderError, type AiProvider } from "@/lib/ai/provider";
import { moodCriteriaSchema } from "@/lib/ai/schemas";
import { fallbackMoodCriteria } from "@/lib/ai/fallbacks";

/**
 * One contract suite, run against both adapters.
 *
 * The SDKs are stubbed at the module boundary so no network call is possible
 * and no real credential is needed. What is being tested is the adapter's own
 * behaviour: that it rejects unsafe input before calling out, surfaces
 * refusals and invalid output as typed failures, and never leaks a credential
 * into an error.
 */

const validCriteria = fallbackMoodCriteria("late night driving");

// --- Anthropic SDK stub -----------------------------------------------------

const anthropicParse = vi.fn();

class StubAnthropicApiError extends Error {}
class StubAnthropicTimeoutError extends StubAnthropicApiError {}
class StubAnthropicRateLimitError extends StubAnthropicApiError {}
class StubAnthropicAuthError extends StubAnthropicApiError {}

vi.mock("@anthropic-ai/sdk", () => {
  class StubAnthropic {
    messages = { parse: anthropicParse };
    static APIError = StubAnthropicApiError;
    static APIConnectionTimeoutError = StubAnthropicTimeoutError;
    static RateLimitError = StubAnthropicRateLimitError;
    static AuthenticationError = StubAnthropicAuthError;
  }
  return { default: StubAnthropic };
});

vi.mock("@anthropic-ai/sdk/helpers/zod", () => ({
  zodOutputFormat: (schema: unknown) => ({ type: "json_schema", schema }),
}));

// --- OpenAI SDK stub --------------------------------------------------------

const openAiParse = vi.fn();

class StubOpenAiApiError extends Error {}
class StubOpenAiTimeoutError extends StubOpenAiApiError {}
class StubOpenAiRateLimitError extends StubOpenAiApiError {}
class StubOpenAiAuthError extends StubOpenAiApiError {}

vi.mock("openai", () => {
  class StubOpenAI {
    responses = { parse: openAiParse };
    chat = { completions: { parse: openRouterParse } };
    static APIError = StubOpenAiApiError;
    static APIConnectionTimeoutError = StubOpenAiTimeoutError;
    static RateLimitError = StubOpenAiRateLimitError;
    static AuthenticationError = StubOpenAiAuthError;
  }
  return { default: StubOpenAI };
});

// --- OpenRouter stub ---------------------------------------------------------
// OpenRouter runs on the same `openai` client, pointed at a different base URL,
// so it shares the stub above via a separate chat.completions surface.

const openRouterParse = vi.fn();

vi.mock("openai/helpers/zod", () => ({
  zodTextFormat: (schema: unknown, name: string) => ({
    type: "json_schema",
    name,
    schema,
  }),
  zodResponseFormat: (schema: unknown, name: string) => ({
    type: "json_schema",
    name,
    schema,
  }),
}));

const { createAnthropicProvider, resetAnthropicClientForTesting } =
  await import("@/lib/ai/adapters/anthropic");
const { createOpenAiProvider, resetOpenAiClientForTesting } =
  await import("@/lib/ai/adapters/openai");
const { createOpenRouterProvider, resetOpenRouterClientForTesting } =
  await import("@/lib/ai/adapters/openrouter");
const { createGeminiProvider, resetGeminiClientForTesting } =
  await import("@/lib/ai/adapters/gemini");

interface Harness {
  readonly label: string;
  readonly create: () => AiProvider;
  readonly call: ReturnType<typeof vi.fn>;
  readonly succeedWith: (parsed: unknown) => void;
  readonly refuse: () => void;
  readonly returnUnparseable: () => void;
  readonly failWith: (error: Error) => void;
  readonly timeoutError: () => Error;
  readonly rateLimitError: () => Error;
}

const harnesses: readonly Harness[] = [
  {
    label: "anthropic",
    create: createAnthropicProvider,
    call: anthropicParse,
    succeedWith: (parsed) =>
      anthropicParse.mockResolvedValue({
        stop_reason: "end_turn",
        parsed_output: parsed,
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    refuse: () =>
      anthropicParse.mockResolvedValue({
        stop_reason: "refusal",
        stop_details: { category: "cyber" },
        parsed_output: null,
        usage: { input_tokens: 5, output_tokens: 0 },
      }),
    returnUnparseable: () =>
      anthropicParse.mockResolvedValue({
        stop_reason: "end_turn",
        parsed_output: null,
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    failWith: (error) => anthropicParse.mockRejectedValue(error),
    timeoutError: () => new StubAnthropicTimeoutError("timed out"),
    rateLimitError: () => new StubAnthropicRateLimitError("slow down"),
  },
  {
    label: "openai",
    create: createOpenAiProvider,
    call: openAiParse,
    succeedWith: (parsed) =>
      openAiParse.mockResolvedValue({
        status: "completed",
        output_parsed: parsed,
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    refuse: () =>
      openAiParse.mockResolvedValue({
        status: "completed",
        output_parsed: null,
        usage: { input_tokens: 5, output_tokens: 0 },
      }),
    returnUnparseable: () =>
      openAiParse.mockResolvedValue({
        status: "completed",
        output_parsed: null,
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    failWith: (error) => openAiParse.mockRejectedValue(error),
    timeoutError: () => new StubOpenAiTimeoutError("timed out"),
    rateLimitError: () => new StubOpenAiRateLimitError("slow down"),
  },
  {
    label: "openrouter",
    create: createOpenRouterProvider,
    call: openRouterParse,
    succeedWith: (parsed) =>
      openRouterParse.mockResolvedValue({
        choices: [
          { message: { parsed, refusal: null }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }),
    refuse: () =>
      openRouterParse.mockResolvedValue({
        choices: [
          {
            message: { parsed: null, refusal: "I can't help with that." },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 0 },
      }),
    returnUnparseable: () =>
      openRouterParse.mockResolvedValue({
        choices: [
          { message: { parsed: null, refusal: null }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }),
    failWith: (error) => openRouterParse.mockRejectedValue(error),
    timeoutError: () => new StubOpenAiTimeoutError("timed out"),
    rateLimitError: () => new StubOpenAiRateLimitError("slow down"),
  },
  {
    // Gemini rides the same OpenAI-compatible chat.completions surface as
    // OpenRouter, so it shares the stub — only the base URL differs in
    // production.
    label: "gemini",
    create: createGeminiProvider,
    call: openRouterParse,
    succeedWith: (parsed) =>
      openRouterParse.mockResolvedValue({
        choices: [
          { message: { parsed, refusal: null }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }),
    refuse: () =>
      openRouterParse.mockResolvedValue({
        choices: [
          {
            message: { parsed: null, refusal: "I can't help with that." },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 0 },
      }),
    returnUnparseable: () =>
      openRouterParse.mockResolvedValue({
        choices: [
          { message: { parsed: null, refusal: null }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }),
    failWith: (error) => openRouterParse.mockRejectedValue(error),
    timeoutError: () => new StubOpenAiTimeoutError("timed out"),
    rateLimitError: () => new StubOpenAiRateLimitError("slow down"),
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  resetAnthropicClientForTesting();
  resetOpenAiClientForTesting();
  resetOpenRouterClientForTesting();
  resetGeminiClientForTesting();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(harnesses.map((h) => [h.label, h] as const))(
  "%s adapter contract",
  (_label, harness) => {
    it("parses a mood into validated criteria", async () => {
      harness.succeedWith(validCriteria);

      const result = await harness
        .create()
        .parseMood({ moodText: "late night driving" });

      expect(moodCriteriaSchema.safeParse(result).success).toBe(true);
      expect(harness.call).toHaveBeenCalledTimes(1);
    });

    it("surfaces a provider refusal as a typed failure", async () => {
      harness.refuse();

      await expect(
        harness.create().parseMood({ moodText: "a rough night" }),
      ).rejects.toMatchObject({ name: "AiProviderError" });
    });

    it("treats unvalidatable output as invalid, not as empty", async () => {
      harness.returnUnparseable();

      await expect(
        harness.create().parseMood({ moodText: "hazy" }),
      ).rejects.toMatchObject({ kind: "invalid-output" });
    });

    it("maps a timeout to a fallback-eligible failure", async () => {
      harness.failWith(harness.timeoutError());

      try {
        await harness.create().parseMood({ moodText: "hazy" });
        expect.unreachable("should have thrown");
      } catch (error) {
        const failure = error as AiProviderError;
        expect(failure.kind).toBe("timeout");
        expect(failure.fallbackEligible).toBe(true);
      }
    });

    it("maps rate limiting to a typed failure", async () => {
      harness.failWith(harness.rateLimitError());

      await expect(
        harness.create().parseMood({ moodText: "hazy" }),
      ).rejects.toMatchObject({ kind: "rate-limited" });
    });

    it("never puts a credential in an error message", async () => {
      harness.failWith(new Error("boom"));

      try {
        await harness.create().parseMood({ moodText: "hazy" });
        expect.unreachable("should have thrown");
      } catch (error) {
        const message = (error as Error).message;
        expect(message).not.toContain(process.env.ANTHROPIC_API_KEY);
        expect(message).not.toContain(process.env.OPENAI_API_KEY);
      }
    });

    it("answers a discography question from supplied releases only", async () => {
      harness.succeedWith({
        sufficientContext: true,
        answer: "Dummy was released in 1994.",
        citedReleaseIds: ["rg-1"],
        unansweredReason: null,
      });

      const result = await harness.create().answerDiscographyQuestion({
        question: "When did Dummy come out?",
        artistName: "Portishead",
        releases: [
          {
            id: "rg-1",
            title: "Dummy",
            primaryType: "Album",
            firstReleaseDate: "1994-08-22",
          },
        ],
      });

      expect(result.sufficientContext).toBe(true);
    });
  },
);

describe.each(harnesses.map((h) => [h.label, h] as const))(
  "%s adapter outbound boundary",
  (_label, harness) => {
    it("makes zero provider calls when input fails the schema", async () => {
      harness.succeedWith(validCriteria);

      await expect(
        harness.create().parseMood({
          moodText: "hello",
          spotifyTrackId: "abc123",
        } as never),
      ).rejects.toBeInstanceOf(AiBoundaryViolationError);

      // The point of the test: rejection happens before any egress.
      expect(harness.call).not.toHaveBeenCalled();
    });

    it("makes zero provider calls for Spotify-sourced evidence", async () => {
      harness.succeedWith(validCriteria);

      await expect(
        harness.create().explainArtistMatch({
          seedArtistName: "Portishead",
          candidateArtistName: "Massive Attack",
          evidence: [
            { source: "spotify" as never, statement: "Same playlist." },
          ],
        }),
      ).rejects.toBeInstanceOf(AiBoundaryViolationError);

      expect(harness.call).not.toHaveBeenCalled();
    });

    it("makes zero provider calls for a Spotify URI hidden in user text", async () => {
      harness.succeedWith(validCriteria);

      await expect(
        harness.create().parseMood({
          moodText: "like spotify:track:4uLU6hMCjMI75M1A2tKUQC but slower",
        }),
      ).rejects.toBeInstanceOf(AiBoundaryViolationError);

      expect(harness.call).not.toHaveBeenCalled();
    });

    it("makes zero provider calls for oversized input", async () => {
      harness.succeedWith(validCriteria);

      await expect(
        harness.create().parseMood({ moodText: "a".repeat(5000) }),
      ).rejects.toBeInstanceOf(AiBoundaryViolationError);

      expect(harness.call).not.toHaveBeenCalled();
    });

    it("never opens a network socket during a rejected request", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      harness.succeedWith(validCriteria);

      await expect(
        harness.create().parseMood({ moodText: "https://open.spotify.com/x" }),
      ).rejects.toBeInstanceOf(AiBoundaryViolationError);

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  },
);
