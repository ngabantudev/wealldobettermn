#!/usr/bin/env node
// src/lib/turnstile.test.mjs
//
// Run directly: node --test src/lib/turnstile.test.mjs
// Or via: npm run test:lib

import assert from "node:assert/strict";
import test from "node:test";
import { verifyTurnstileToken } from "./turnstile.ts";

function mockFetch(handler) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url: String(url), options });
    return handler(url, options);
  };
  impl.calls = calls;
  return impl;
}

test("returns false immediately for an empty token, without calling fetch", async () => {
  const fetchImpl = mockFetch(() => {
    throw new Error("should never be called");
  });
  const ok = await verifyTurnstileToken("", { fetchImpl, secretKey: "secret" });
  assert.equal(ok, false);
  assert.equal(fetchImpl.calls.length, 0);
});

test("returns true when siteverify reports success", async () => {
  const fetchImpl = mockFetch(() => new Response(JSON.stringify({ success: true }), { status: 200 }));
  const ok = await verifyTurnstileToken("a-real-token", { fetchImpl, secretKey: "secret" });
  assert.equal(ok, true);
});

test("returns false when siteverify reports failure", async () => {
  const fetchImpl = mockFetch(() => new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }), { status: 200 }));
  const ok = await verifyTurnstileToken("a-bad-token", { fetchImpl, secretKey: "secret" });
  assert.equal(ok, false);
});

test("fails closed on a non-OK HTTP response", async () => {
  const fetchImpl = mockFetch(() => new Response("server error", { status: 500 }));
  const ok = await verifyTurnstileToken("a-token", { fetchImpl, secretKey: "secret" });
  assert.equal(ok, false);
});

test("fails closed on a network error, never throws", async () => {
  const fetchImpl = mockFetch(() => {
    throw new TypeError("network down");
  });
  await assert.doesNotReject(async () => {
    const ok = await verifyTurnstileToken("a-token", { fetchImpl, secretKey: "secret" });
    assert.equal(ok, false);
  });
});

test("fails closed on unparseable JSON", async () => {
  const fetchImpl = mockFetch(() => new Response("not json", { status: 200 }));
  const ok = await verifyTurnstileToken("a-token", { fetchImpl, secretKey: "secret" });
  assert.equal(ok, false);
});

test("sends the secret, token, and remote IP as form fields", async () => {
  const fetchImpl = mockFetch((url, options) => {
    const params = new URLSearchParams(options.body);
    assert.equal(params.get("secret"), "my-secret");
    assert.equal(params.get("response"), "the-token");
    assert.equal(params.get("remoteip"), "203.0.113.5");
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  });
  await verifyTurnstileToken("the-token", { fetchImpl, secretKey: "my-secret" }, "203.0.113.5");
  assert.equal(fetchImpl.calls.length, 1);
});
