#!/usr/bin/env node
// src/lib/voteDedup.test.mjs
//
// Run directly: node --test src/lib/voteDedup.test.mjs
// Or via: npm run test:lib

import assert from "node:assert/strict";
import test from "node:test";
import { computeDedupKey, hashIp } from "./voteDedup.ts";

test("the same salt/ip/submission/day always produces the same key", async () => {
  const now = new Date("2026-08-09T12:00:00Z");
  const a = await computeDedupKey({ salt: "s", ip: "203.0.113.5", submissionId: "sub-1", now });
  const b = await computeDedupKey({ salt: "s", ip: "203.0.113.5", submissionId: "sub-1", now });
  assert.equal(a, b);
});

test("a different IP produces a different key", async () => {
  const now = new Date("2026-08-09T12:00:00Z");
  const a = await computeDedupKey({ salt: "s", ip: "203.0.113.5", submissionId: "sub-1", now });
  const b = await computeDedupKey({ salt: "s", ip: "203.0.113.6", submissionId: "sub-1", now });
  assert.notEqual(a, b);
});

test("a different salt produces a different key for the same IP (the salt genuinely matters)", async () => {
  const now = new Date("2026-08-09T12:00:00Z");
  const a = await computeDedupKey({ salt: "salt-one", ip: "203.0.113.5", submissionId: "sub-1", now });
  const b = await computeDedupKey({ salt: "salt-two", ip: "203.0.113.5", submissionId: "sub-1", now });
  assert.notEqual(a, b);
});

test("a different submissionId produces a different key for the same voter", async () => {
  const now = new Date("2026-08-09T12:00:00Z");
  const a = await computeDedupKey({ salt: "s", ip: "203.0.113.5", submissionId: "sub-1", now });
  const b = await computeDedupKey({ salt: "s", ip: "203.0.113.5", submissionId: "sub-2", now });
  assert.notEqual(a, b);
});

test("the same voter/submission produces the same key at two different moments within the same day bucket", async () => {
  const morning = new Date("2026-08-09T01:00:00Z");
  const evening = new Date("2026-08-09T23:00:00Z");
  const a = await computeDedupKey({ salt: "s", ip: "203.0.113.5", submissionId: "sub-1", now: morning, windowDays: 1 });
  const b = await computeDedupKey({ salt: "s", ip: "203.0.113.5", submissionId: "sub-1", now: evening, windowDays: 1 });
  assert.equal(a, b);
});

test("the same voter/submission produces a DIFFERENT key once the window rolls over — this is a friction layer, not durable identity", async () => {
  const day1 = new Date("2026-08-09T12:00:00Z");
  const day2 = new Date("2026-08-10T12:00:00Z");
  const a = await computeDedupKey({ salt: "s", ip: "203.0.113.5", submissionId: "sub-1", now: day1, windowDays: 1 });
  const b = await computeDedupKey({ salt: "s", ip: "203.0.113.5", submissionId: "sub-1", now: day2, windowDays: 1 });
  assert.notEqual(a, b);
});

test("the result never contains the raw IP as a substring", async () => {
  const key = await computeDedupKey({ salt: "s", ip: "203.0.113.5", submissionId: "sub-1", now: new Date("2026-08-09T12:00:00Z") });
  assert.equal(key.includes("203.0.113.5"), false);
  assert.match(key, /^[0-9a-f]{64}$/); // a plain SHA-256 hex digest, nothing else
});

// --- hashIp (submission-creation rate limiting) ---------------------------

test("hashIp is stable for the same salt/ip, unlike computeDedupKey it is NOT day-bucketed", async () => {
  const a = await hashIp("s", "203.0.113.5");
  const b = await hashIp("s", "203.0.113.5");
  assert.equal(a, b);
});

test("hashIp differs for a different IP or a different salt", async () => {
  const base = await hashIp("s", "203.0.113.5");
  assert.notEqual(base, await hashIp("s", "203.0.113.6"));
  assert.notEqual(base, await hashIp("other-salt", "203.0.113.5"));
});

test("hashIp never contains the raw IP as a substring and is a plain SHA-256 hex digest", async () => {
  const key = await hashIp("s", "203.0.113.5");
  assert.equal(key.includes("203.0.113.5"), false);
  assert.match(key, /^[0-9a-f]{64}$/);
});
