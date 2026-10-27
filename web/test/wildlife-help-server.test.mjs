import { test } from "node:test";
import assert from "node:assert/strict";
import {
  handleWildlifeHelp,
  createLimiter,
  SYSTEM_PROMPT,
} from "../lib/wildlife-help-server.js";
const req = (body, headers = {}) =>
  new Request("https://display.test/api/wildlife-help", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const env = {
  WN_HELP_API_KEY: "server-only-test-key",
  WN_HELP_MODEL: "test-model",
};
const output = (value) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(value) } }],
    }),
  );
const options = { limiter: () => true };
test("unconfigured server returns honest offline guidance without calling a provider", async () => {
  const response = await handleWildlifeHelp(req({ signs: ["bleeding"] }), {
    ...options,
    env: {},
    fetchImpl: () => {
      throw Error("should not call");
    },
  });
  const body = await response.json();
  assert.equal(body.mode, "offline");
  assert.equal(body.category, "Urgent assistance recommended");
  assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
});
test("valid model classification uses fixed source/copy and carries only codes upstream", async () => {
  let sent;
  const response = await handleWildlifeHelp(req({ signs: ["moving"] }), {
    ...options,
    env,
    fetchImpl: async (url, init) => {
      sent = init;
      return output({ category: "Observe safely", reason: "moving" });
    },
  });
  const body = await response.json();
  assert.equal(body.mode, "live");
  assert.equal(body.category, "Observe safely");
  assert.equal(JSON.parse(sent.body).messages[0].content, SYSTEM_PROMPT);
  assert.equal(
    JSON.parse(sent.body).messages[1].content,
    '{"signs":["moving"]}',
  );
  assert.equal(sent.headers.Authorization, "Bearer server-only-test-key");
  assert.ok(!JSON.stringify(body).includes(env.WN_HELP_API_KEY));
});
test("high-risk signs cannot be downgraded by the provider", async () => {
  const response = await handleWildlifeHelp(req({ signs: ["trapped"] }), {
    ...options,
    env,
    fetchImpl: async () =>
      output({ category: "Observe safely", reason: "uncertain" }),
  });
  assert.equal(
    (await response.json()).category,
    "Professional advice recommended",
  );
});
test("malformed, unsupported and invented provider output uses the exact safe fallback", async () => {
  for (const value of [
    { category: "Healthy", reason: "moving" },
    { category: "Observe safely", reason: "uncertain", phone: "123" },
    { category: "Unable to determine", reason: "bleeding" },
  ]) {
    const response = await handleWildlifeHelp(req({ signs: [] }), {
      ...options,
      env,
      fetchImpl: async () => output(value),
    });
    const body = await response.json();
    assert.equal(body.mode, "fallback");
    assert.equal(body.category, "Professional advice recommended");
    assert.match(body.explanation, /could not assess/);
  }
});
test("upstream outages and timeout keep safe offline guidance available", async () => {
  for (const fetchImpl of [
    async () => {
      throw Error("secret-provider-error");
    },
    () => new Promise(() => {}),
  ]) {
    const response = await handleWildlifeHelp(req({ signs: ["traffic"] }), {
      ...options,
      env,
      fetchImpl,
      timeoutMs: 10,
    });
    const body = await response.json();
    assert.equal(body.mode, "offline");
    assert.equal(body.category, "Urgent assistance recommended");
    assert.ok(!JSON.stringify(body).includes("secret-provider-error"));
  }
});
test("API blocks private/free-text payloads, malformed/oversized input and foreign origins", async () => {
  for (const body of [
    { description: "Jane at 12 Acacia Street" },
    { signs: ["person name"] },
    { signs: ["trapped"], image: "face" },
    "invalid",
    "x".repeat(1100),
  ]) {
    const response = await handleWildlifeHelp(req(body), { ...options, env });
    assert.equal(response.status, 400);
  }
  assert.equal(
    (
      await handleWildlifeHelp(
        req({ signs: [] }, { Origin: "https://other.test" }),
        options,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handleWildlifeHelp(
        req({ signs: [] }, { "Content-Type": "text/plain" }),
        options,
      )
    ).status,
    415,
  );
});
test("per-client and total caps expire; rate-limited requests never call a provider", async () => {
  let now = 0;
  const limiter = createLimiter(() => now);
  for (let i = 0; i < 6; i++) assert.ok(limiter("one"));
  assert.equal(limiter("one"), false);
  for (let i = 0; i < 24; i++) assert.ok(limiter("other" + i));
  assert.equal(limiter("new"), false);
  now = 60000;
  assert.ok(limiter("one"));
  const response = await handleWildlifeHelp(req({ signs: [] }), {
    env,
    limiter: () => false,
    fetchImpl: () => {
      throw Error("should not call");
    },
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
});
