/**
 * NanoGPT transport, same wiring as kimigachi's src/lib/llm/provider.ts.
 *
 * NanoGPT is OpenAI-compatible, so `@ai-sdk/openai-compatible` does the HTTP,
 * the bearer header and the retries. The provider is built lazily and cached
 * so importing this module never reads the environment; typecheck, lint and
 * `next build` run without a key, and so does the whole test suite.
 *
 * Two models: a cheap one for decision ticks and a better one for talking
 * and the nightly roll-up. `GOTCHA_MODEL` is the shared fallback for both.
 *
 * No temperature, top_p or penalty overrides anywhere in the brain. GLM's
 * defaults are the tuned values and it gets worse with a repetition penalty
 * above 1.1. If a model turns out to need one, add it at the call site with
 * the reason in a comment.
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

/** The shape `generateObject` takes for providerOptions: provider name to a JSON object. */
export type ProviderOptions = NonNullable<Parameters<typeof import("ai").generateObject>[0]["providerOptions"]>;

export const DEFAULT_BASE_URL = "https://nano-gpt.com/api/v1";
export const DEFAULT_MODEL = "zai-org/glm-5.2";

let cached: { key: string; provider: ReturnType<typeof createOpenAICompatible> } | null = null;

/** True when a key is present. Everything downstream falls back to rules when this is false. */
export function isConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.NANOGPT_API_KEY?.trim());
}

function provider() {
  const apiKey = process.env.NANOGPT_API_KEY?.trim();
  if (!apiKey) throw new Error("NANOGPT_API_KEY is not set; check isConfigured() before asking for a model");
  const baseURL = process.env.NANOGPT_BASE_URL?.trim() || DEFAULT_BASE_URL;
  const key = `${apiKey}|${baseURL}`;
  if (!cached || cached.key !== key) {
    cached = {
      key,
      provider: createOpenAICompatible({
        // The name is the key `providerOptions` is looked up under. Renaming
        // it detaches the GLM thinking suppression below.
        name: "nanogpt",
        apiKey,
        baseURL,
      }),
    };
  }
  return cached.provider;
}

export function tickModelId(env: NodeJS.ProcessEnv = process.env): string {
  return env.GOTCHA_MODEL_TICK?.trim() || env.GOTCHA_MODEL?.trim() || DEFAULT_MODEL;
}

export function talkModelId(env: NodeJS.ProcessEnv = process.env): string {
  return env.GOTCHA_MODEL_TALK?.trim() || env.GOTCHA_MODEL?.trim() || DEFAULT_MODEL;
}

export function tickModel(): LanguageModel {
  return provider()(tickModelId());
}

export function talkModel(): LanguageModel {
  return provider()(talkModelId());
}

/**
 * GLM models on NanoGPT write their chain of thought into the content
 * stream unless told not to. Structured output cannot survive that, so the
 * flag goes in the request body for any model id that mentions glm.
 */
export const GLM_PROVIDER_OPTIONS = {
  nanogpt: { chat_template_kwargs: { enable_thinking: false } },
} as const;

export function providerOptionsFor(modelId: string): ProviderOptions | undefined {
  return modelId.toLowerCase().includes("glm") ? GLM_PROVIDER_OPTIONS : undefined;
}

/** Tests swap keys between cases; production never calls this. */
export function resetProviderCache(): void {
  cached = null;
}
