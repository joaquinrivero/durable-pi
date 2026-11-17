import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../src/config.js";
import { Store } from "../src/store.js";
import { faux, tempStore } from "./helpers.js";

test("configuration selects Pi providers", () => {
  const config = loadConfig(["--env-file", "/dev/null"], {
    DPI_PROVIDER: "pi",
    DPI_TOKEN: "x".repeat(40),
  });
  assert.equal(config.provider, "pi");
});

test("Codex uses Pi credentials, migrates stored models and preserves its selection on restart", async () => {
  const t = await tempStore();
  let store = await t.open();
  try {
    const session = await store.create({ name: "Existing", cwd: t.work, model: faux });
    await store.close();
    const authPath = join(t.root, "auth.json");
    await writeFile(authPath, JSON.stringify({
      "openai-codex": { type: "oauth", access: "test", refresh: "test", expires: Number.MAX_SAFE_INTEGER },
    }), { mode: 0o600 });
    const models = await ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false });
    const options = { ...t.options, provider: "pi" as const, models };
    store = await Store.open(options);
    const device = store.deviceInfo();
    assert.equal(device.defaultModel, "gpt-6.1-sol");
    assert.ok(device.models.some((m) => m.id === device.defaultModel));
    assert.ok(device.models.every((m) => m.provider === "openai-codex"));
    assert.deepEqual(store.routedModel({ provider: "openrouter", modelId: "deepseek/deepseek-v4.1-flash" }), {
      provider: "openai-codex", modelId: "gpt-6.1-sol",
    });
    const codex = { provider: "openai-codex", modelId: "gpt-6.1-sol" };
    assert.deepEqual(store.validateModel(codex), codex);
    assert.throws(() => store.validateModel(faux), /Unknown model/);
    assert.equal((await store.resolveAgent(session.id, "main")).row.provider, "openai-codex");
    const selected = { provider: "openai-codex", modelId: "gpt-5.6-luna" };
    const { row, c } = await store.resolveAgent(session.id, "main");
    await store.configure(row, c, { model: selected });
    await store.close();
    store = await Store.open(options);
    const reopened = await store.resolveAgent(session.id, "main");
    assert.deepEqual((await store.agentDetail(reopened.row, reopened.c)).config.model, selected);
    assert.equal((await models.checkAuth("openai-codex"))?.type, "oauth");
  } finally {
    await store.close();
    await t.cleanup();
  }
});
