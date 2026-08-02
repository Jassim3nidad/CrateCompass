export type LogLevel = "debug" | "info" | "warn" | "error";

type LogValue = unknown;

const sensitiveKeyPattern =
  /authorization|cookie|password|secret|token|api[-_]?key|ciphertext|code_verifier|prompt|input_text/i;

export function redactSensitive(value: LogValue): LogValue {
  if (Array.isArray(value)) {
    return value.map(redactSensitive);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        sensitiveKeyPattern.test(key)
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
