/**
 * The one place generateObject is called. Each entry point takes a
 * GenerateFn so tests can hand in a fake without a network, and the
 * default wraps the SDK with the GLM option when the model id needs it.
 */

import { generateObject, type LanguageModel } from "ai";
import type { z } from "zod";
import { providerOptionsFor } from "./provider";

export interface GenerateArgs {
  model: LanguageModel;
  system: string;
  prompt: string;
  schema: z.ZodType;
  signal: AbortSignal;
}

export interface GenerateResult {
  object: unknown;
  tokens: number;
}

export type GenerateFn = (args: GenerateArgs) => Promise<GenerateResult>;

export function modelId(model: LanguageModel): string {
  return typeof model === "string" ? model : model.modelId;
}

export const generateWithSdk: GenerateFn = async ({ model, system, prompt, schema, signal }) => {
  const result = await generateObject({
    model,
    system,
    prompt,
    schema,
    abortSignal: signal,
    providerOptions: providerOptionsFor(modelId(model)),
  });
  const usage = result.usage;
  const tokens = usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  return { object: result.object, tokens };
};
