export type LogLevel = "debug" | "info" | "warn" | "error";

type LogValue = unknown;

const sensitiveKeyPattern =
  /authorization|cookie|password|secret|token|api[-_]?key|ciphertext|code_verifier|prompt|input_text/i;

/**
 * Keys that match the pattern above but carry a usage count, not a credential.
 *
 * `inputTokens` contains "token", so provider usage figures were being written
 * to logs as `[REDACTED]` — the cost data was invisible from the day it was
 * first recorded.
 *
 * The pattern is deliberately not loosened to fix that. A narrower pattern is a
 * permanent widening of what can escape, and getting it wrong once means a
 * credential in a log file. This allowlist inverts the risk: only these exact
 * key names are exempt, and only when the value is a number. A number cannot
 * be a bearer token, so an exemption here cannot leak a secret even if a key
 * name is later reused for something else.
 */
const SAFE_NUMERIC_KEYS = new Set([
  "inputtokens",
  "outputtokens",
  "totaltokens",
  "cachedinputtokens",
  "reasoningtokens",
  "tokencount",
  "prompttokens",
  "completiontokens",
]);

function isSafeNumericCount(key: string, value: LogValue): boolean {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    SAFE_NUMERIC_KEYS.has(key.toLowerCase())
  );
}

export function redactSensitive(value: LogValue): LogValue {
  if (Array.isArray(value)) {
    return value.map(redactSensitive);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        sensitiveKeyPattern.test(key) && !isSafeNumericCount(key, nestedValue)
          ? "[REDACTED]"
          : redactSensitive(nestedValue),
      ]),
    );
  }

  return value;
}

export interface LogContext {
  readonly event: string;
  readonly correlationId?: string;
  readonly [key: string]: unknown;
}

function write(level: LogLevel, context: LogContext): void {
  const redactedContext = redactSensitive(context) as Record<string, unknown>;
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    ...redactedContext,
  });

  const sink = level === "error" ? console.error : console.log;
  sink(payload);
}

export const logger = {
  debug: (context: LogContext) => write("debug", context),
  info: (context: LogContext) => write("info", context),
  warn: (context: LogContext) => write("warn", context),
  error: (context: LogContext) => write("error", context),
};
