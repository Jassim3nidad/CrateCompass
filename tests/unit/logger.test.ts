import { afterEach, describe, expect, it, vi } from "vitest";

import { logger, redactSensitive } from "@/lib/observability/logger";

describe("structured logger", () => {
  afterEach(() => vi.restoreAllMocks());

  it("redacts sensitive values at any nesting depth", () => {
    expect(
      redactSensitive({
        event: "example",
        authorization: "Bearer secret",
        nested: { refresh_token: "secret", safe: "value" },
      }),
    ).toEqual({
      event: "example",
      authorization: "[REDACTED]",
      nested: { refresh_token: "[REDACTED]", safe: "value" },
    });
  });

  it("writes one structured, redacted event", () => {
    const sink = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logger.info({
      event: "token_refresh",
      accessToken: "do-not-log",
      attempt: 1,
    });

    expect(sink).toHaveBeenCalledOnce();
    const payload = JSON.parse(String(sink.mock.calls[0]?.[0])) as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      level: "info",
      event: "token_refresh",
      accessToken: "[REDACTED]",
      attempt: 1,
    });
  });
});

describe("usage counts", () => {
  it("keeps numeric token counts readable so cost is visible", () => {
    const redacted = redactSensitive({
      event: "ai.request",
      inputTokens: 1200,
      outputTokens: 340,
      totalTokens: 1540,
    }) as Record<string, unknown>;

    expect(redacted.inputTokens).toBe(1200);
    expect(redacted.outputTokens).toBe(340);
    expect(redacted.totalTokens).toBe(1540);
  });

  it("still redacts a credential whose key merely looks like a count", () => {
    // The exemption is numeric-only, so a string under an allowlisted key is
    // treated as a credential rather than a count.
    const redacted = redactSensitive({
      inputTokens: "Bearer super-secret-value",
      access_token: "BQC-secret",
      refreshToken: "AQD-secret",
    }) as Record<string, unknown>;

    expect(redacted.inputTokens).toBe("[REDACTED]");
    expect(redacted.access_token).toBe("[REDACTED]");
    expect(redacted.refreshToken).toBe("[REDACTED]");
  });

  it("does not exempt a credential key that happens to be numeric", () => {
    const redacted = redactSensitive({
      access_token: 12345,
      apiKey: 99,
      authorization: 1,
    }) as Record<string, unknown>;

    expect(redacted.access_token).toBe("[REDACTED]");
    expect(redacted.apiKey).toBe("[REDACTED]");
    expect(redacted.authorization).toBe("[REDACTED]");
  });
});
