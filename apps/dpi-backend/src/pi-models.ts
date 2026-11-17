import type { ModelRef } from "@earendil-works/pi-durable";
import type { ModelInfo } from "../../dpi-sdk/src/api.js";

type CatalogModel = Pick<ModelInfo, "id" | "provider">;

export const piProviders = [
  { id: "openai-codex", tier: "Subscription", icon: "openai.png" },
  { id: "opencode", tier: "OpenCode Zen", icon: "lab.png" },
  { id: "opencode-go", tier: "OpenCode Go", icon: "lab.png" },
] as const;

export function defaultPiModel(available: readonly CatalogModel[]): ModelRef {
  const model = available.find((m) => m.provider === "openai-codex" && m.id === "gpt-6.1-sol") ?? available[0];
  if (!model) throw Error("No authenticated Pi models. Sign in to Codex, OpenCode Zen or OpenCode Go.");
  return { provider: model.provider, modelId: model.id };
}

export function isPiModel(model: ModelRef, catalog: readonly CatalogModel[]): boolean {
  return piProviders.some((p) => p.id === model.provider) &&
    catalog.some((m) => m.provider === model.provider && m.id === model.modelId);
}

export function routePiModel(
  model: ModelRef | undefined,
  catalog: readonly CatalogModel[],
  available: readonly CatalogModel[],
): ModelRef {
  return model && isPiModel(model, catalog)
    ? { provider: model.provider, modelId: model.modelId }
    : defaultPiModel(available);
}
