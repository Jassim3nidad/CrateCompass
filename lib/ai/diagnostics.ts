/**
 * Redacted failure detail for AI provider logs.
 *
 * The adapters classify an SDK error into a typed `AiProviderError` and then
 * discard the original. That is right for the caller — a product surface must
 * not see a vendor error — but it left operators with "the AI provider is
 * unavailable" and nothing else, which is not enough to tell a quota problem
 * from a malformed request.
 *
 * What travels: the transport status, the SDK's error class name, and the
 * provider's own short error code. What does not: the message body, the request
 * payload, or anything carrying a credential — an authentication failure's
 * message can echo the key that was sent.
 */

export interface ProviderFailureDetail {
  readonly status?: number;
  readonly errorName?: string;
  readonly providerCode?: string;
}

export function describeProviderFailure(error: unknown): ProviderFailureDetail {
  if (typeof error !== "object" || error === null) {
    return {};
  }

  const candidate = error as {
    status?: unknown;
    name?: unknown;
    code?: unknown;
    error?: { code?: unknown; status?: unknown };
  };

  const detail: {
    status?: number;
    errorName?: string;
    providerCode?: string;
  } = {};

  if (typeof candidate.status === "number") {
    detail.status = candidate.status;
  }

  if (typeof candidate.name === "string") {
    detail.errorName = candidate.name;
  }

  // Short, enumerated provider codes only ("invalid_argument",
  // "resource_exhausted"). Anything longer is prose and may quote the request.
  const code =
    candidate.code ?? candidate.error?.code ?? candidate.error?.status;

  if (typeof code === "string" && code.length <= 64) {
    detail.providerCode = code;
  }

  return detail;
}
