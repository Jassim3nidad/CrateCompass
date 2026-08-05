import { describe, expect, it } from "vitest";

import { aiInputDisclosure } from "@/lib/ai/disclosure";

/**
 * ADR 0005 makes the free Gemini tier a privacy obligation rather than a cost
 * one: user-authored text becomes training data. These assertions exist so a
 * provider switch cannot silently drop the disclosure that obligation requires.
 */
describe("AI input disclosure", () => {
  it("names Google and what happens to the text on the free Gemini tier", () => {
    const notice = aiInputDisclosure("gemini");

    expect(notice).toBeTruthy();
    expect(notice).toMatch(/Google/);
    expect(notice).toMatch(/improve their products/);
  });

  it("names the extra processors an OpenRouter deployment introduces", () => {
    expect(aiInputDisclosure("openrouter")).toMatch(/OpenRouter/);
  });

  it("says nothing for providers that do not train on submitted content", () => {
    expect(aiInputDisclosure("openai")).toBeNull();
    expect(aiInputDisclosure("anthropic")).toBeNull();
  });
});
