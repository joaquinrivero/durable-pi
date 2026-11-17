import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Store } from "../src/store.js";
import { faux, tempStore } from "./helpers.js";

for (const provider of ["opencode", "opencode-go"]) {
  test(`${provider}-only credentials supply the default and recovery model`, async () => {
    const t = await tempStore();
    let store = await t.open();
    try {
      const session = await store.create({ name: "Existing", cwd: t.work, model: faux });
      await store.close();
      const authPath = join(t.root, "auth.json");
      await writeFile(authPath, JSON.stringify({ [provider]: { type: "api_key", key: "test" } }), { mode: 0o600 });
      const models = await ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false });
      const options = { ...t.options, provider: "pi" as const, models };
      store = await Store.open(options);
      const device = store.deviceInfo();
      assert.deepEqual(new Set(device.models.map((m) => m.provider)), new Set([provider]));
      const selected = device.models.find((m) => m.id === device.defaultModel);
      assert.ok(selected, "the default must be an authenticated model");
      const expected = { provider, modelId: selected.id };
      assert.deepEqual(store.routedModel(), expected);
      assert.deepEqual(store.routedModel(faux), expected);
      const { row, c } = await store.resolveAgent(session.id, "main");
      assert.deepEqual((await store.agentDetail(row, c)).config.model, expected);
      await store.close();
      store = await Store.open(options);
      const reopened = await store.resolveAgent(session.id, "main");
      assert.deepEqual((await store.agentDetail(reopened.row, reopened.c)).config.model, expected);
    } finally {
      await store.close();
      await t.cleanup();
    }
  });
}

test("missing Pi credentials fail before changing stored selections", async () => {
  const t = await tempStore();
  let store = await t.open();
  try {
    const session = await store.create({ name: "Existing", cwd: t.work, model: faux });
    await store.close();
    const authPath = join(t.root, "auth.json");
    await writeFile(authPath, "{}", { mode: 0o600 });
    const models = await ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false });
    await assert.rejects(Store.open({ ...t.options, provider: "pi", models }), /No authenticated Pi models/);
    store = await t.open();
    const { row, c } = await store.resolveAgent(session.id, "main");
    assert.deepEqual((await store.agentDetail(row, c)).config.model, faux);
  } finally {
    await store.close();
    await t.cleanup();
  }
});

test("OpenCode and Codex share Pi credentials without exposing other providers or replacing selections", async () => {
  const t = await tempStore();
  const authPath = join(t.root, "auth.json");
  await writeFile(authPath, JSON.stringify({
    "openai-codex": { type: "oauth", access: "test", refresh: "test", expires: Number.MAX_SAFE_INTEGER },
    opencode: { type: "api_key", key: "test" },
    "opencode-go": { type: "api_key", key: "test" },
    openrouter: { type: "api_key", key: "test" },
  }), { mode: 0o600 });
  const models = await ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false });
  const options = { ...t.options, provider: "pi" as const, models };
  let store = await Store.open(options);
  try {
    const device = store.deviceInfo();
    assert.deepEqual(new Set(device.models.map((m) => m.provider)), new Set(["openai-codex", "opencode", "opencode-go"]));
    assert.equal(device.defaultModel, "gpt-6.1-sol");
    const model = { provider: "opencode", modelId: "gpt-5-nano" };
    assert.deepEqual(store.validateModel(model), model);
    assert.deepEqual(store.routedModel(model), model);
    const other = models.getModels("openrouter")[0];
    assert.ok(other);
    assert.throws(() => store.validateModel({ provider: "openrouter", modelId: other.id }), /Unknown model/);
    const session = await store.create({ name: "OpenCode", cwd: t.work, model });
    const go = { provider: "opencode-go", modelId: "minimax-m3" };
    assert.deepEqual(store.validateModel(go), go);
    assert.deepEqual(store.routedModel(go), go);
    const goSession = await store.create({ name: "OpenCode Go", cwd: t.work, model: go });
    await store.close();
    store = await Store.open(options);
    const { row, c } = await store.resolveAgent(session.id, "main");
    assert.deepEqual((await store.agentDetail(row, c)).config.model, model);
    const reopenedGo = await store.resolveAgent(goSession.id, "main");
    assert.deepEqual((await store.agentDetail(reopenedGo.row, reopenedGo.c)).config.model, go);
    assert.equal((await models.checkAuth("opencode"))?.type, "api_key");
    assert.equal((await models.checkAuth("opencode-go"))?.type, "api_key");
  } finally {
    await store.close();
    await t.cleanup();
  }
});
