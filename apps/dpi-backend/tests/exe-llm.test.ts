import { test } from "node:test";
import assert from "node:assert/strict";
import { exeLlmProvider, EXE_PROVIDER } from "../src/exe-llm.js";
import { loadConfig } from "../src/config.js";
import { Store } from "../src/store.js";
import { faux, tempStore } from "./helpers.js";

test("configuration retains both Pi and exe.dev provider modes", () => {
  for (const provider of ["pi", "exe-llm", "faux", "openrouter"]) {
    const config = loadConfig(["--env-file", "/dev/null"], {
      DPI_PROVIDER: provider,
      DPI_TOKEN: "x".repeat(40),
    });
    assert.equal(config.provider, provider);
  }
});

test("exe.dev store discovers models before recovery and preserves selections across restart", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [
    { id: "openai/gpt-6.1-sol", owned_by: "chatgpt" },
    { id: "fireworks/deepseek-v4p1-flash", supportsTools: true },
  ] }));
  const t = await tempStore();
  let store = await t.open();
  try {
    const session = await store.create({ name: "Existing", cwd: t.work, model: faux });
    await store.close();
    const options = { ...t.options, provider: "exe-llm" as const };
    store = await Store.open(options);
    const device = store.deviceInfo();
    assert.equal(device.defaultModel, "openai/gpt-6.1-sol");
    assert.equal(device.models.length, 2);
    assert.ok(device.models.every((m) => m.provider === EXE_PROVIDER));
    const { row, c } = await store.resolveAgent(session.id, "main");
    assert.deepEqual((await store.agentDetail(row, c)).config.model, {
      provider: EXE_PROVIDER, modelId: device.defaultModel,
    });
    const selected = { provider: EXE_PROVIDER, modelId: "fireworks/deepseek-v4p1-flash" };
    assert.deepEqual(store.routedModel({ provider: "openrouter", modelId: "deepseek/deepseek-v4.1-flash" }), selected);
    assert.deepEqual(store.validateModel(selected), selected);
    assert.throws(() => store.validateModel(faux), /Unknown model/);
    await store.configure(row, c, { model: selected });
    await store.close();
    store = await Store.open(options);
    const reopened = await store.resolveAgent(session.id, "main");
    assert.deepEqual((await store.agentDetail(reopened.row, reopened.c)).config.model, selected);
  } finally {
    globalThis.fetch = original;
    await store.close();
    await t.cleanup();
  }
});

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
