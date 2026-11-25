import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";

const TOKEN = "t".repeat(40);

function home(settings?: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "dpi-config-"));
  if (settings !== undefined)
    writeFileSync(join(dir, "settings.json"), typeof settings === "string" ? settings : JSON.stringify(settings));
  return { DPI_HOME: dir, DPI_TOKEN: TOKEN } as NodeJS.ProcessEnv;
}

test("settings.json sets the pi provider with Pi's field names", () => {
  const c = loadConfig(
    [],
    home({
      provider: "pi",
      defaultProvider: "github-copilot",
      defaultModel: "claude-haiku-4.5",
      enabledModels: ["github-copilot/*"],
      startDirs: ["/tmp/dpi-a"],
      port: 4799,
    }),
  );
  assert.equal(c.provider, "pi");
  assert.equal(c.defaultModel, "github-copilot/claude-haiku-4.5");
  assert.deepEqual(c.models, ["github-copilot/*"]);
  assert.deepEqual(c.startDirs, ["/tmp/dpi-a"]);
  assert.equal(c.port, 4799);
});

test("defaultModel may be provider/modelId alone", () => {
  const c = loadConfig([], home({ provider: "pi", defaultModel: "anthropic/claude-sonnet-5" }));
  assert.equal(c.defaultModel, "anthropic/claude-sonnet-5");
});

test("environment wins over settings.json, flags win over both", () => {
  const env = {
    ...home({ provider: "pi", enabledModels: ["a/*"], port: 4799 }),
    DPI_MODELS: "b/x, c/*",
    DPI_PORT: "4800",
  };
  const c = loadConfig(["--port", "4801"], env);
  assert.deepEqual(c.models, ["b/x", "c/*"]);
  assert.equal(c.port, 4801);
});

test("without settings.json the defaults stay as before", () => {
  const c = loadConfig([], home());
  assert.equal(c.provider, "openrouter");
  assert.deepEqual(c.models, []);
  assert.equal(c.port, 4780);
});

test("bad settings.json fails with the file name", () => {
  assert.throws(() => loadConfig([], home("{ nope")), /settings\.json: invalid JSON/);
  assert.throws(() => loadConfig([], home({ provider: "openai" })), /provider must be one of/);
  assert.throws(() => loadConfig([], home({ enabledModels: "x/*" })), /enabledModels must be a list/);
});

test("the token comes from auth.json, as in Pi", () => {
  const env = home({});
  delete env.DPI_TOKEN;
  const file = join(env.DPI_HOME!, "auth.json");
  writeFileSync(file, JSON.stringify({ token: TOKEN }), { mode: 0o600 });
  assert.equal(loadConfig([], env).token, TOKEN);
  assert.equal(loadConfig([], { ...env, DPI_TOKEN: "e".repeat(40) }).token, "e".repeat(40));
});

test("auth.json that others can read is refused", () => {
  const env = home({});
  delete env.DPI_TOKEN;
  const file = join(env.DPI_HOME!, "auth.json");
  writeFileSync(file, JSON.stringify({ token: TOKEN }));
  chmodSync(file, 0o644);
  assert.throws(() => loadConfig([], env), /other users can read this file/);
});

test("no token anywhere names both places", () => {
  const env = home({});
  delete env.DPI_TOKEN;
  assert.throws(() => loadConfig([], env), /auth\.json and .*backend\.env/);
});
