// Keyless exe.dev integration. Discover availability rather than advertising models
// (e.g. Claude) that the VM's integration has not enabled.
import { createProvider } from "@earendil-works/pi-ai/models";
import type { Api, Model } from "@earendil-works/pi-ai";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";

export const EXE_PROVIDER = "exe-llm";
export const EXE_DEFAULT_MODEL = "openai/gpt-6.1-sol";
export const exeAliases: Record<string, string> = {
  "deepseek/deepseek-v4.1-flash": "fireworks/deepseek-v4p1-flash",
  "qwen/qwen3.8-2.4t-a95b": "fireworks/qwen3p8-2p4t-a95b",
  "z-ai/glm-5.3": "fireworks/glm-5p3",
  "z-ai/glm-5.3-flash": "fireworks/glm-5p3-flash",
  "moonshotai/kimi-k3": "fireworks/kimi-k3",
  "minimax/minimax-m3": "fireworks/minimax-m3",
};

export async function exeLlmProvider() {
  const baseUrl = "https://llm.int.exe.xyz/v1";
  const response = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error(`exe.dev model discovery failed: ${response.status}`);
  const { data } = await response.json() as {
    data: { id: string; owned_by?: string; displayName?: string; contextLength?: number; supportsTools?: boolean }[];
  };
  const router = openrouterProvider().getModels();
  const openai = openaiProvider().getModels();
  const models: Model<Api>[] = [];
  for (const entry of data) {
    // OpenAI aliases are duplicated by discovery. Audio/embedding/classifier
    // endpoints aren't agent chat models.
    const isOpenAI = entry.id.startsWith("openai/") && entry.owned_by === "chatgpt";
    const isFireworks = entry.id.startsWith("fireworks/") && entry.supportsTools === true;
    if (!isOpenAI && !isFireworks) continue;
    const alias = Object.entries(exeAliases).find(([, id]) => id === entry.id)?.[0];
    const template = isOpenAI
      ? openai.find((m) => m.id === entry.id.slice(7)) ?? router.find((m) => m.id === entry.id)
      : router.find((m) => m.id === alias);
    models.push({
      id: entry.id,
      name: template?.name ?? entry.displayName ?? entry.id,
      provider: EXE_PROVIDER,
      baseUrl,
      api: isOpenAI ? "openai-responses" : "openai-completions",
      input: template?.input ?? ["text"],
      reasoning: template?.reasoning ?? true,
      thinkingLevelMap: isOpenAI && /gpt-6/.test(entry.id)
        ? { off: "low", minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh" }
        : template?.thinkingLevelMap,
      contextWindow: entry.contextLength ?? template?.contextWindow ?? 128000,
      maxTokens: template?.maxTokens ?? 8192,
      // Fallback rates are unknown; billing is owned by the exe.dev integration.
      cost: template?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
  }
  if (!models.length) throw Error("exe.dev integration has no supported agent models");
  return createProvider({
    id: EXE_PROVIDER,
    name: "exe.dev LLM integration",
    baseUrl,
    auth: { apiKey: {
      name: "exe.dev ambient VM identity (no API key)",
      resolve: async () => ({ auth: { apiKey: "implicit" }, source: "exe.dev VM integration" }),
    } },
    models,
    api: { "openai-responses": openAIResponsesApi(), "openai-completions": openAICompletionsApi() },
  });
}
