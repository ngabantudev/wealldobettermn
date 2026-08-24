#!/usr/bin/env node
// scripts/lib/fetchJson.test.mjs
//
// Tests for fetchJson() — extracted from 5 independently-implemented
// copies (issue #131): 3 bare (no retry) and 2 with 429/Retry-After
// backoff. Mocks globalThis.fetch since this is the one function in the
// codebase whose whole job is talking to the network — no existing test
// file in this repo mocks fetch, since everything else tests pure
// functions over fixture data; this is deliberately the exception, and
// restores the real fetch after each test so it can't leak into another
// test file run in the same process.
//
// Run directly: node scripts/lib/fetchJson.test.mjs
// Or via: npm run test:scripts-lib (new npm script + CI step added
// alongside this file — scripts/lib/ had no test runner wired in before,
// unlike scripts/ingest/'s test:ingest and src/lib/'s test:lib)

import assert from "node:assert/strict";
import test from "node:test";
import { fetchJson, USER_AGENT } from "./fetchJson.mjs";

function fakeResponse({ ok, status, statusText = "", body = {}, headers = {} }) {
  return {
    ok,
    status,
    statusText,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

test("fetchJson returns the parsed JSON body on a 200", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init });
    return fakeResponse({ ok: true, status: 200, body: { hello: "world" } });
  });
  const result = await fetchJson("https://example.com/data.json");
  assert.deepEqual(result, { hello: "world" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.com/data.json");
  assert.equal(calls[0].init.headers["User-Agent"], USER_AGENT);
});

test("fetchJson merges caller-supplied headers on top of the default User-Agent", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push(init);
    return fakeResponse({ ok: true, status: 200, body: {} });
  });
  await fetchJson("https://example.com", { headers: { "X-API-KEY": "secret" } });
  assert.equal(calls[0].headers["User-Agent"], USER_AGENT);
  assert.equal(calls[0].headers["X-API-KEY"], "secret");
});

test("fetchJson throws immediately on a non-429 error response, no retry", async (t) => {
  let callCount = 0;
  t.mock.method(globalThis, "fetch", async () => {
    callCount++;
    return fakeResponse({ ok: false, status: 500, statusText: "Internal Server Error" });
  });
  await assert.rejects(() => fetchJson("https://example.com"), /HTTP 500 Internal Server Error/);
  assert.equal(callCount, 1);
});

// retry-after: "0" is deliberately NOT used in either test below — the
// real fetchJson code treats 0 (and anything <= 0) as "no Retry-After
// given," falling back to the attempt*2000ms exponential wait, exactly
// like a response with no header at all. Using a genuinely tiny positive
// value ("0.001", i.e. 1ms) instead is what actually exercises the
// "honor Retry-After" branch, and keeps these tests fast rather than
// burning multiple real seconds of wall-clock time per run.
test("fetchJson retries a 429 honoring a positive Retry-After, then succeeds", async (t) => {
  let callCount = 0;
  t.mock.method(globalThis, "fetch", async () => {
    callCount++;
    if (callCount === 1) {
      return fakeResponse({ ok: false, status: 429, headers: { "retry-after": "0.001" } });
    }
    return fakeResponse({ ok: true, status: 200, body: { attempt: callCount } });
  });
  const result = await fetchJson("https://example.com", { logLabel: "test" });
  assert.deepEqual(result, { attempt: 2 });
  assert.equal(callCount, 2);
});

test("fetchJson gives up and throws after exhausting maxRetries on a persistent 429", async (t) => {
  let callCount = 0;
  t.mock.method(globalThis, "fetch", async () => {
    callCount++;
    return fakeResponse({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      headers: { "retry-after": "0.001" },
    });
  });
  await assert.rejects(() => fetchJson("https://example.com", { maxRetries: 2 }), /HTTP 429/);
  // Exactly maxRetries + 1 attempts: the initial try plus 2 retries, then
  // the 3rd 429 response (attempt=3 > maxRetries=2) falls through to the
  // final `if (!res.ok) throw` below the retry check.
  assert.equal(callCount, 3);
});
