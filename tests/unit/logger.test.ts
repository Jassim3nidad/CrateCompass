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
