export function getSafeReturnPath(
  candidate: string | null | undefined,
  fallback = "/discover",
): string {
  if (!candidate?.startsWith("/") || candidate.startsWith("//")) {
    return fallback;
  }

  try {
    const url = new URL(candidate, "https://cratecompass.invalid");
    return url.origin === "https://cratecompass.invalid"
      ? `${url.pathname}${url.search}${url.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}
