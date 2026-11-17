import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultPiModel, isPiModel, routePiModel } from "../src/pi-models.js";

const codex = { provider: "openai-codex", id: "gpt-6.1-sol" };
const zen = { provider: "opencode", id: "gpt-5-nano" };
const go = { provider: "opencode-go", id: "minimax-m3" };
const ref = (m: typeof codex) => ({ provider: m.provider, modelId: m.id });

test("Pi defaults prefer authenticated Codex, otherwise the first authenticated model", () => {
  assert.deepEqual(defaultPiModel([zen, codex]), ref(codex));
  assert.deepEqual(defaultPiModel([zen, go]), ref(zen));
  assert.deepEqual(defaultPiModel([go]), ref(go));
  assert.deepEqual(defaultPiModel([{ ...codex, id: "another-codex-model" }]), {
    provider: "openai-codex", modelId: "another-codex-model",
  });
  assert.throws(() => defaultPiModel([]), /No authenticated Pi models/);
});

test("Pi validation matches both provider and model within the allowed catalog", () => {
  assert.equal(isPiModel(ref(zen), [zen]), true);
  assert.equal(isPiModel({ ...ref(zen), provider: "opencode-go" }, [zen]), false);
  assert.equal(isPiModel({ ...ref(zen), modelId: "missing" }, [zen]), false);
  const other = { provider: "openrouter", id: zen.id };
  assert.equal(isPiModel(ref(other), [other]), false);
});

test("Pi routing preserves known choices and uses authenticated fallback for unknown choices", () => {
  assert.deepEqual(routePiModel(ref(go), [zen, go], [zen]), ref(go));
  assert.deepEqual(routePiModel(undefined, [codex, zen], [zen]), ref(zen));
  assert.deepEqual(routePiModel({ ...ref(zen), modelId: "missing" }, [zen], [zen]), ref(zen));
  assert.deepEqual(routePiModel({ ...ref(zen), provider: "openrouter" }, [zen], [zen]), ref(zen));
});
