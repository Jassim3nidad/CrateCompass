/**
 * Live smoke test for the configured AI provider.
 *
 * Verifies the one assumption the whole Phase 5 design rests on: that the
 * configured model actually honours a JSON-schema constraint. It replicates the
 * adapter's request shape rather than importing it, because the adapters carry
 * `server-only` and cannot be loaded outside a React Server Component graph.
 *
 * Usage: node scripts/smoke-test-ai.mjs
 */

import nextEnv from "@next/env";
import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const provider = process.env.AI_PROVIDER;
if (provider !== "openrouter") {
  console.error(
    `This smoke test covers openrouter; AI_PROVIDER is "${provider}".`,
  );
  process.exit(1);
}

const apiKey = process.env.OPENROUTER_API_KEY;
const model = process.env.OPENROUTER_MODEL;

if (!apiKey || !model) {
  console.error("OPENROUTER_API_KEY and OPENROUTER_MODEL must both be set.");
  process.exit(1);
}

const client = new OpenAI({
  apiKey,
  baseURL: "https://openrouter.ai/api/v1",
  timeout: 30_000,
  maxRetries: 1,
  defaultHeaders: {
    "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000",
    "X-Title": "CrateCompass",
  },
});

// A trimmed mood schema — enough to prove schema adherence without depending on
// the TypeScript source.
const schema = z.object({
  primaryMood: z.string(),
  energyLevel: z.enum(["low", "medium", "high"]),
  genreHints: z.array(z.string()),
  clarificationNeeded: z.boolean(),
});

console.log(`Model: ${model}`);
console.log("Sending one structured-output request...\n");

const startedAt = Date.now();

try {
  const completion = await client.chat.completions.parse({
    model,
    max_tokens: 4000,
    response_format: zodResponseFormat(schema, "mood_criteria"),
    messages: [
      {
        role: "system",
        content:
          "You convert a listener's own description of a mood into structured discovery criteria. Use only what the listener wrote.",
      },
      {
        role: "user",
        content:
          "Listener's description:\nrainy sunday afternoon, something slow and warm with a lot of reverb",
      },
    ],
  });

  const choice = completion.choices[0];
  const durationMs = Date.now() - startedAt;

  if (choice?.message.refusal) {
    console.log(`REFUSED: ${choice.message.refusal}`);
    process.exit(1);
  }

  if (!choice?.message.parsed) {
    console.log("FAIL  model returned output that did not satisfy the schema");
    console.log("raw:", choice?.message.content?.slice(0, 400));
    process.exit(1);
  }

  console.log("PASS  schema-constrained output returned and validated");
  console.log(`      latency: ${durationMs}ms`);
  console.log(
    `      tokens: ${completion.usage?.prompt_tokens} in / ${completion.usage?.completion_tokens} out`,
  );
  console.log("\nparsed:", JSON.stringify(choice.message.parsed, null, 2));
} catch (error) {
  console.log(
    `FAIL  ${error?.constructor?.name ?? "Error"}: ${String(error).split("\n")[0]}`,
  );
  process.exit(1);
}
