import { test } from "node:test";
import assert from "node:assert/strict";
import { exeLlmProvider, EXE_PROVIDER } from "../src/exe-llm.js";

test("exe.dev discovers only agent models and selects the correct API without provider keys", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [
    { id: "openai/gpt-6.1-sol", owned_by: "chatgpt" },
    { id: "gpt-6.1-sol", owned_by: "chatgpt" },
    { id: "openai/whisper-1", owned_by: "openai" },
    { id: "fireworks/deepseek-v4p1-flash", owned_by: "fireworks", supportsTools: true, contextLength: 1048576 },
    { id: "fireworks/rune", owned_by: "fireworks" },
  ] }));
  try {
    const provider = await exeLlmProvider();
    const models = provider.getModels();
    assert.equal(provider.id, EXE_PROVIDER);
    assert.equal(models.length, 2);
    assert.equal(models[0].api, "openai-responses");
    assert.equal(models[0].thinkingLevelMap?.off, "low");
    assert.equal(models[1].api, "openai-completions");
    assert.equal(models[1].contextWindow, 1048576);
    assert.ok(models.every((m) => m.baseUrl === "https://llm.int.exe.xyz/v1"));
  } finally { globalThis.fetch = original; }
});

test("exe.dev discovery fails closed on gateway errors", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });
  try { await assert.rejects(exeLlmProvider, /503/); }
  finally { globalThis.fetch = original; }
});
