import type { AiProviderName } from "@/lib/ai/provider";

/**
 * What a listener must be told before their own words reach a provider.
 *
 * ADR 0005 records the trade the zero-cost stack makes: Google states that
 * free-tier content **is used to improve their products**, unlike the paid
 * tier. The discovery explanation panel accepts free text from the listener,
 * so on that provider their words become training data — an obligation that a
 * privacy policy alone does not discharge, because the person typing needs to
 * know at the moment they type.
 *
 * Returned as data rather than rendered inline so the notice is decided
 * server-side, where the configured provider is actually known: `AI_PROVIDER`
 * is not public configuration and must not be shipped to the browser.
 */
export function aiInputDisclosure(provider: AiProviderName): string | null {
  switch (provider) {
    case "gemini":
      // Specific about who and what. "Your data may be processed" would be
      // technically true and practically useless.
      return "This deployment uses Google's free Gemini tier, where anything you type here is sent to Google and may be used to improve their products. Leave the field empty to keep your words out of it.";
    case "openrouter":
      // ADR 0004: a router adds at least two processors — OpenRouter itself
      // and whoever hosts the selected model.
      return "This deployment routes AI requests through OpenRouter, so anything you type here reaches OpenRouter and the provider hosting the selected model.";
    case "openai":
    case "anthropic":
      return null;
  }
}
