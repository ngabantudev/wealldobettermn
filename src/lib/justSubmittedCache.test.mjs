#!/usr/bin/env node
// src/lib/justSubmittedCache.test.mjs
//
// Run directly: node --test src/lib/justSubmittedCache.test.mjs
// Or via: npm run test:lib

import assert from "node:assert/strict";
import test from "node:test";
import { consumeJustSubmitted, storeJustSubmitted } from "./justSubmittedCache.ts";

/** A minimal in-memory Storage-like, matching StorageLike — real Map, not a mock library, since the module's own contract is this small. */
function mockStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
    // Exposed for assertions only, not part of StorageLike.
    _size: () => map.size,
  };
}

const SAMPLE = {
  cityName: "Hugo",
  officials: [{ role: "Mayor", repName: "Tom Weidt", repEmail: null, repPhone: "651-955-1091", wardLabel: null }],
  confirmations: 0,
  confirmationsNeeded: 1,
};

test("stores and retrieves a matching city, then clears the entry", () => {
  const storage = mockStorage();
  storeJustSubmitted(SAMPLE, storage);
  assert.equal(storage._size(), 1);

  const result = consumeJustSubmitted("Hugo", storage);
  assert.deepEqual(result, SAMPLE);
  assert.equal(storage._size(), 0); // consumed — never lingers for a later read
});

test("city-name matching is fold()-based (case/whitespace-insensitive)", () => {
  const storage = mockStorage();
  storeJustSubmitted(SAMPLE, storage);
  const result = consumeJustSubmitted("  hugo  ", storage);
  assert.deepEqual(result, SAMPLE);
});

test("returns null for a different city, and still clears the entry", () => {
  const storage = mockStorage();
  storeJustSubmitted(SAMPLE, storage);
  const result = consumeJustSubmitted("Grant", storage);
  assert.equal(result, null);
  assert.equal(storage._size(), 0); // cleared even though it didn't match — never resurfaces for a later, unrelated visit
});

test("returns null when nothing was ever stored", () => {
  const storage = mockStorage();
  const result = consumeJustSubmitted("Hugo", storage);
  assert.equal(result, null);
});

test("a second consume after the first returns null — one-time handoff, not a durable cache", () => {
  const storage = mockStorage();
  storeJustSubmitted(SAMPLE, storage);
  consumeJustSubmitted("Hugo", storage);
  const second = consumeJustSubmitted("Hugo", storage);
  assert.equal(second, null);
});

test("consumeJustSubmitted never throws on corrupt stored JSON", () => {
  const storage = mockStorage();
  storage.setItem("wadb:just-submitted-pending", "not valid json{{{");
  assert.doesNotThrow(() => {
    const result = consumeJustSubmitted("Hugo", storage);
    assert.equal(result, null);
  });
});

test("storeJustSubmitted never throws when the storage implementation throws (e.g. quota exceeded)", () => {
  const throwingStorage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {},
  };
  assert.doesNotThrow(() => storeJustSubmitted(SAMPLE, throwingStorage));
});

test("with no storage available at all (null), both functions are safe no-ops", () => {
  assert.doesNotThrow(() => storeJustSubmitted(SAMPLE, null));
  assert.equal(consumeJustSubmitted("Hugo", null), null);
});
