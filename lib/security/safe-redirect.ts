/**
 * The only sanctioned way to turn an untrusted `returnTo` into a path.
 *
 * The check that matters runs on the **output**, not only the input. Rejecting
 * a candidate that starts `//` is necessary but not sufficient, because URL
 * normalisation can *produce* a protocol-relative path from one that did not
 * start that way: `/..//evil.com` normalises to `//evil.com`, which
 * `new URL(path, base)` then resolves to `http://evil.com/`.
 *
 * That was a live, exploitable open redirect on the sign-in and sign-up flows
 * (Phase 11, SEC-01) — a listener who authenticated on the real domain was
 * handed to an external origin afterwards, which is exactly the position
 * credential phishing wants.
 *
 * So the post-condition is asserted explicitly: whatever comes out begins with
 * a single `/`. Callers may compose it with a base URL without re-checking.
 */
export function getSafeReturnPath(
  candidate: string | null | undefined,
  fallback = "/discover",
): string {
  if (!candidate?.startsWith("/") || candidate.startsWith("//")) {
    return fallback;
  }

  let path: string;

  try {
    const url = new URL(candidate, "https://cratecompass.invalid");

    if (url.origin !== "https://cratecompass.invalid") {
      return fallback;
    }

    path = `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }

  // The post-condition. `//host` and `/\host` are both protocol-relative once
  // resolved against a base, and a backslash is normalised to a forward slash
  // by the URL parser in exactly the contexts that matter here.
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.startsWith("/\\")
  ) {
    return fallback;
  }

  return path;
}
