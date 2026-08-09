#!/usr/bin/env node
// src/lib/domainSafety.test.mjs
//
// Run directly: node --test src/lib/domainSafety.test.mjs
// Or via: npm run test:lib

import assert from "node:assert/strict";
import test from "node:test";
import { checkDomainSafety, isDomainFlaggedMalicious, isGovernmentGatedTld } from "./domainSafety.ts";

function mockFetch(handler) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push(String(url));
    return handler(url, options);
  };
  impl.calls = calls;
  return impl;
}

function dohResponse(status, answers) {
  return new Response(JSON.stringify({ Status: status, Answer: answers }), { status: 200 });
}

// --- isGovernmentGatedTld — a positive signal, never a rejection --------

test("recognizes .gov as a gated TLD", () => {
  assert.equal(isGovernmentGatedTld("cityofexample.gov"), true);
});

test("recognizes .mn.us as a gated TLD", () => {
  assert.equal(isGovernmentGatedTld("ci.example.mn.us"), true);
});

test("an ordinary .com/.org domain is not flagged — absence is not a red flag, just no bonus signal", () => {
  assert.equal(isGovernmentGatedTld("cityofexample.com"), false);
  assert.equal(isGovernmentGatedTld("cityofexample.org"), false);
});

test("is case-insensitive", () => {
  assert.equal(isGovernmentGatedTld("CityOfExample.GOV"), true);
});

test("does not false-positive on a domain that merely contains 'gov' as a substring", () => {
  assert.equal(isGovernmentGatedTld("governmentwatch.com"), false);
});

// --- isDomainFlaggedMalicious — a known-bad blocklist check, not proof of safety --

test("returns false for a domain the resolver answers normally", async () => {
  const fetchImpl = mockFetch(() => dohResponse(0, [{ type: 1, data: "93.184.216.34" }]));
  const flagged = await isDomainFlaggedMalicious("city.example.gov", { fetchImpl });
  assert.equal(flagged, false);
});

test("returns true when the resolver NXDOMAINs (Status !== 0) — a known-bad hit", async () => {
  const fetchImpl = mockFetch(() => dohResponse(3, []));
  const flagged = await isDomainFlaggedMalicious("known-bad.example", { fetchImpl });
  assert.equal(flagged, true);
});

test("returns true when the resolver sinkholes the domain to 0.0.0.0", async () => {
  const fetchImpl = mockFetch(() => dohResponse(0, [{ type: 1, data: "0.0.0.0" }]));
  const flagged = await isDomainFlaggedMalicious("sinkholed.example", { fetchImpl });
  assert.equal(flagged, true);
});

test("fails closed (treated as flagged) on a non-OK HTTP response", async () => {
  const fetchImpl = mockFetch(() => new Response("error", { status: 500 }));
  const flagged = await isDomainFlaggedMalicious("city.example.gov", { fetchImpl });
  assert.equal(flagged, true);
});

test("fails closed on a network error, never throws", async () => {
  const fetchImpl = mockFetch(() => {
    throw new TypeError("network down");
  });
  await assert.doesNotReject(async () => {
    const flagged = await isDomainFlaggedMalicious("city.example.gov", { fetchImpl });
    assert.equal(flagged, true);
  });
});

// --- checkDomainSafety — combines both, independently ----------------------

test("checkDomainSafety reports both signals independently for a clean .gov domain", async () => {
  const fetchImpl = mockFetch(() => dohResponse(0, [{ type: 1, data: "93.184.216.34" }]));
  const result = await checkDomainSafety("city.example.gov", { fetchImpl });
  assert.equal(result.hostname, "city.example.gov");
  assert.equal(result.isGovernmentGatedTld, true);
  assert.equal(result.isFlaggedMalicious, false);
});

test("checkDomainSafety reports a clean .com domain as no gated-TLD bonus but still not flagged", async () => {
  const fetchImpl = mockFetch(() => dohResponse(0, [{ type: 1, data: "93.184.216.34" }]));
  const result = await checkDomainSafety("cityofexample.com", { fetchImpl });
  assert.equal(result.isGovernmentGatedTld, false);
  assert.equal(result.isFlaggedMalicious, false);
});
