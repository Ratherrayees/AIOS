import assert from "node:assert/strict";
import test from "node:test";

import {
  executeProviderRoute,
  isTransientProviderFailure,
  isTransientProviderStatus,
  validFallbackProvider,
} from "../lib/ai/provider-fallback";

test("provider fallback recognizes only the bounded transient HTTP statuses", () => {
  for (const status of [408, 409, 425, 429, 500, 502, 503, 504])
    assert.equal(isTransientProviderStatus(status), true, String(status));
  for (const status of [400, 401, 403, 404, 422, 501])
    assert.equal(isTransientProviderStatus(status), false, String(status));
});

test("provider fallback recognizes network and timeout failures", () => {
  const networkError = new Error("provider request failed");
  networkError.name = "AiosProviderNetworkError";
  assert.equal(isTransientProviderFailure(networkError), true);
  for (const name of [
    "AbortError",
    "APIConnectionError",
    "APIConnectionTimeoutError",
    "TimeoutError",
  ]) {
    const error = new Error(name);
    error.name = name;
    assert.equal(isTransientProviderFailure(error), true, name);
  }
});

test("provider fallback refuses authentication and output failures", () => {
  assert.equal(isTransientProviderFailure({ status: 401 }), false);
  assert.equal(isTransientProviderFailure(new TypeError("programming error")), false);
  assert.equal(isTransientProviderFailure(new SyntaxError("invalid JSON")), false);
  assert.equal(isTransientProviderFailure(new Error("safety blocked")), false);
});

test("fallback policy requires a distinct provider inside the allow-list", () => {
  assert.equal(
    validFallbackProvider({
      primary: "glm",
      fallback: "qwen",
      allowedProviders: ["glm", "qwen"],
    }),
    true,
  );
  assert.equal(
    validFallbackProvider({
      primary: "glm",
      fallback: "glm",
      allowedProviders: ["glm"],
    }),
    false,
  );
  assert.equal(
    validFallbackProvider({
      primary: "glm",
      fallback: "qwen",
      allowedProviders: ["glm"],
    }),
    false,
  );
});

test("a successful primary call never invokes fallback", async () => {
  const calls: string[] = [];
  const routed = await executeProviderRoute({
    primary: "glm",
    fallback: "qwen",
    execute: async (provider) => {
      calls.push(provider);
      return `${provider}-result`;
    },
    isTransientFailure: isTransientProviderFailure,
  });
  assert.deepEqual(calls, ["glm"]);
  assert.deepEqual(routed.attemptedProviders, ["glm"]);
  assert.equal(routed.fallbackUsed, false);
  assert.equal(routed.value, "glm-result");
});

test("one transient primary failure invokes one configured fallback", async () => {
  const calls: string[] = [];
  const routed = await executeProviderRoute({
    primary: "glm",
    fallback: "qwen",
    execute: async (provider) => {
      calls.push(provider);
      if (provider === "glm") throw { status: 429 };
      return "recovered";
    },
    isTransientFailure: isTransientProviderFailure,
  });
  assert.deepEqual(calls, ["glm", "qwen"]);
  assert.deepEqual(routed.attemptedProviders, ["glm", "qwen"]);
  assert.equal(routed.fallbackUsed, true);
  assert.equal(routed.value, "recovered");
});

test("the governed priority chain advances across transient provider failures", async () => {
  const calls: string[] = [];
  const routed = await executeProviderRoute({
    primary: "groq",
    fallbacks: ["glm", "nvidia", "openrouter"],
    execute: async (provider) => {
      calls.push(provider);
      if (provider === "groq") throw { status: 429 };
      if (provider === "glm") throw { status: 503 };
      return `${provider}-recovered`;
    },
    isTransientFailure: isTransientProviderFailure,
  });
  assert.deepEqual(calls, ["groq", "glm", "nvidia"]);
  assert.deepEqual(routed.attemptedProviders, ["groq", "glm", "nvidia"]);
  assert.equal(routed.fallbackUsed, true);
  assert.equal(routed.value, "nvidia-recovered");
});

test("the priority chain stops immediately on a non-transient failure", async () => {
  const calls: string[] = [];
  await assert.rejects(
    executeProviderRoute({
      primary: "groq",
      fallbacks: ["glm", "nvidia"],
      execute: async (provider) => {
        calls.push(provider);
        if (provider === "groq") throw { status: 429 };
        throw { status: 401 };
      },
      isTransientFailure: isTransientProviderFailure,
    }),
  );
  assert.deepEqual(calls, ["groq", "glm"]);
});

test("non-transient primary failures never invoke fallback", async () => {
  const calls: string[] = [];
  await assert.rejects(
    executeProviderRoute({
      primary: "glm",
      fallback: "qwen",
      execute: async (provider) => {
        calls.push(provider);
        throw { status: 401 };
      },
      isTransientFailure: isTransientProviderFailure,
    }),
  );
  assert.deepEqual(calls, ["glm"]);
});

test("an absent fallback preserves the primary failure", async () => {
  const failure = Object.assign(new Error("busy"), { status: 503 });
  await assert.rejects(
    executeProviderRoute({
      primary: "glm",
      fallback: null,
      execute: async () => {
        throw failure;
      },
      isTransientFailure: isTransientProviderFailure,
    }),
    (error) => error === failure,
  );
});

test("fallback failure propagates without a third attempt", async () => {
  const calls: string[] = [];
  const fallbackFailure = Object.assign(new Error("still busy"), {
    status: 503,
  });
  await assert.rejects(
    executeProviderRoute({
      primary: "glm",
      fallback: "qwen",
      execute: async (provider) => {
        calls.push(provider);
        if (provider === "glm") throw { status: 503 };
        throw fallbackFailure;
      },
      isTransientFailure: isTransientProviderFailure,
    }),
    (error) => error === fallbackFailure,
  );
  assert.deepEqual(calls, ["glm", "qwen"]);
});

test("a provider cannot fall back to itself", async () => {
  await assert.rejects(
    executeProviderRoute({
      primary: "glm",
      fallback: "glm",
      execute: async () => "not reached",
      isTransientFailure: isTransientProviderFailure,
    }),
    /must differ/,
  );
});
