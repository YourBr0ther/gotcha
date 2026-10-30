/**
 * One live call to NanoGPT with the configured key and tick model, so a
 * fresh install can tell "key works" from "brain is in rules mode".
 * Run: pnpm exec tsx scripts/brain-smoke.mts
 */
import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

process.loadEnvFile(new URL("../.env", import.meta.url).pathname);
const apiKey = process.env.NANOGPT_API_KEY;
if (!apiKey) {
  console.log("NANOGPT_API_KEY is not set; the brain runs by rules.");
  process.exit(1);
}
const provider = createOpenAICompatible({ name: "nanogpt", apiKey, baseURL: process.env.NANOGPT_BASE_URL ?? "https://nano-gpt.com/api/v1" });
const model = process.env.GOTCHA_MODEL_TICK || process.env.GOTCHA_MODEL || "zai-org/glm-5.2";
const started = Date.now();
try {
  const r = await generateText({
    model: provider(model),
    prompt: "You are an Eevee. In at most 8 words, what do you want right now?",
    providerOptions: model.includes("glm") ? { nanogpt: { chat_template_kwargs: { enable_thinking: false } } } : undefined,
  });
  console.log(JSON.stringify({ model, ms: Date.now() - started, text: r.text.trim().slice(0, 120), usage: r.usage }, null, 2));
} catch (error) {
  console.log("ERROR", (error as Error).message.slice(0, 400));
  process.exit(1);
}
