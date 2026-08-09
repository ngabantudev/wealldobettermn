#!/usr/bin/env node
// src/lib/serverFetch.test.mjs
//
// Tests for the SSRF mitigations in serverFetch.ts (AGENTS.md §2.6). Every
// test injects a mock `fetchImpl` — no real network access, no waiting on
// real timers. Node's built-in test runner, same convention as
// src/lib/electionConfig.test.mjs.
//
// Run directly: node --test src/lib/serverFetch.test.mjs
// Or via: npm run test:lib

import assert from "node:assert/strict";
import test from "node:test";
import {
  isBlockedHostname,
  isPrivateIPv4,
  isPrivateIPv6,
  looksLikeBareIp,
  serverFetch,
} from "./serverFetch.ts";
import { COMMUNITY_FETCH_MAX_BYTES, COMMUNITY_FETCH_MAX_REDIRECTS } from "./communityConfig.ts";

function dohResponse(answers) {
  return new Response(JSON.stringify({ Answer: answers }), { status: 200 });
}

function publicDohResponse() {
  return dohResponse([{ type: 1, data: "93.184.216.34" }]); // example.com's real public A record — a stand-in public address
}

/** A fetchImpl that dispatches on URL prefix; logs every call for assertions. */
function makeMockFetch(handlers) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push(String(url));
    for (const [prefix, handler] of handlers) {
      if (String(url).startsWith(prefix)) return handler(url, options);
    }
    throw new Error(`unexpected fetch to ${url}`);
  };
  impl.calls = calls;
  return impl;
}

// --- preflight rejections (never reach the network) ---------------------

test("rejects a non-https scheme without ever calling fetch", async () => {
  const fetchImpl = makeMockFetch([]); // any call throws
  const result = await serverFetch("http://example.com/", { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unsupported_scheme");
  assert.equal(fetchImpl.calls.length, 0);
});

test("rejects a bare IPv4 hostname without ever calling fetch", async () => {
  const fetchImpl = makeMockFetch([]);
  const result = await serverFetch("https://93.184.216.34/", { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "bare_ip_hostname");
  assert.equal(fetchImpl.calls.length, 0);
});

test("rejects a blocked hostname (localhost) without ever calling fetch", async () => {
  const fetchImpl = makeMockFetch([]);
  const result = await serverFetch("https://localhost/", { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "blocked_hostname");
  assert.equal(fetchImpl.calls.length, 0);
});

test("rejects a *.internal hostname without ever calling fetch", async () => {
  const fetchImpl = makeMockFetch([]);
  const result = await serverFetch("https://admin.internal/", { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "blocked_hostname");
});

test("rejects an unparseable URL without ever calling fetch", async () => {
  const fetchImpl = makeMockFetch([]);
  const result = await serverFetch("not a url at all", { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_url");
  assert.equal(fetchImpl.calls.length, 0);
});

// --- DNS-based rejection --------------------------------------------------

test("rejects when DNS resolves to a private/loopback address, and never fetches the page itself", async () => {
  const fetchImpl = makeMockFetch([
    ["https://1.1.1.1/dns-query", () => dohResponse([{ type: 1, data: "127.0.0.1" }])],
    ["https://city.example.gov", () => { throw new Error("page should never be fetched"); }],
  ]);
  const result = await serverFetch("https://city.example.gov/", { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "private_ip_target");
  assert.equal(fetchImpl.calls.length, 1); // only the DoH call
});

test("rejects when DNS resolves to the metadata-service address (169.254.169.254)", async () => {
  const fetchImpl = makeMockFetch([
    ["https://1.1.1.1/dns-query", () => dohResponse([{ type: 1, data: "169.254.169.254" }])],
  ]);
  const result = await serverFetch("https://city.example.gov/", { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "private_ip_target");
});

test("fails closed when the DNS pre-check itself errors, rather than proceeding", async () => {
  const fetchImpl = makeMockFetch([
    ["https://1.1.1.1/dns-query", () => { throw new Error("resolver unreachable"); }],
  ]);
  const result = await serverFetch("https://city.example.gov/", { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "private_ip_target");
});

test("fails closed when DNS returns no answers at all", async () => {
  const fetchImpl = makeMockFetch([["https://1.1.1.1/dns-query", () => dohResponse([])]]);
  const result = await serverFetch("https://city.example.gov/", { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "private_ip_target");
});

// --- happy path ------------------------------------------------------------

test("fetches and returns page text when everything checks out", async () => {
  const fetchImpl = makeMockFetch([
    ["https://1.1.1.1/dns-query", () => publicDohResponse()],
    ["https://city.example.gov", () => new Response("<html>Welcome to the City of Example</html>", { status: 200 })],
  ]);
  const result = await serverFetch("https://city.example.gov/", { fetchImpl });
  assert.equal(result.ok, true);
  assert.match(result.text, /City of Example/);
  assert.equal(result.finalUrl, "https://city.example.gov/");
});

test("returns unreachable on a non-redirect, non-2xx status", async () => {
  const fetchImpl = makeMockFetch([
    ["https://1.1.1.1/dns-query", () => publicDohResponse()],
    ["https://city.example.gov", () => new Response("nope", { status: 404 })],
  ]);
  const result = await serverFetch("https://city.example.gov/", { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unreachable");
});

// --- redirects ---------------------------------------------------------

test("follows a redirect and re-validates the target through the full preflight", async () => {
  let pageCalls = 0;
  const fetchImpl = makeMockFetch([
    ["https://1.1.1.1/dns-query", () => publicDohResponse()],
    [
      "https://city.example.gov",
      () => new Response(null, { status: 302, headers: { location: "https://www.city.example.gov/home" } }),
    ],
    [
      "https://www.city.example.gov/home",
      () => {
        pageCalls += 1;
        return new Response("<html>Home</html>", { status: 200 });
      },
    ],
  ]);
  const result = await serverFetch("https://city.example.gov/", { fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.finalUrl, "https://www.city.example.gov/home");
  assert.equal(pageCalls, 1);
  // Two DoH calls expected — one per hostname, since the redirect target is
  // re-preflighted from scratch rather than trusted because the first hop passed.
  const dohCalls = fetchImpl.calls.filter((u) => u.startsWith("https://1.1.1.1/dns-query"));
  assert.equal(dohCalls.length, 2);
});

test("a redirect to a private-IP-resolving host is rejected, even after the first hop was public", async () => {
  const fetchImpl = makeMockFetch([
    [
      "https://1.1.1.1/dns-query?name=city.example.gov",
      () => publicDohResponse(),
    ],
    [
      "https://1.1.1.1/dns-query?name=internal.example.gov",
      () => dohResponse([{ type: 1, data: "10.0.0.5" }]),
    ],
    [
      "https://city.example.gov",
      () => new Response(null, { status: 302, headers: { location: "https://internal.example.gov/" } }),
    ],
  ]);
  const result = await serverFetch("https://city.example.gov/", { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "private_ip_target");
});

test("stops following redirects past the configured cap", async () => {
  const fetchImpl = makeMockFetch([
    ["https://1.1.1.1/dns-query", () => publicDohResponse()],
    ["https://redirect.example.gov", () => new Response(null, { status: 302, headers: { location: "https://redirect.example.gov/next" } })],
  ]);
  const result = await serverFetch("https://redirect.example.gov/", { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "too_many_redirects");
  const pageCalls = fetchImpl.calls.filter((u) => u.startsWith("https://redirect.example.gov"));
  // Initial fetch + COMMUNITY_FETCH_MAX_REDIRECTS follow-up hops, all of
  // which redirect again, then it gives up rather than following forever.
  assert.equal(pageCalls.length, COMMUNITY_FETCH_MAX_REDIRECTS + 1);
});

test("a redirect response with no Location header is rejected as unreachable", async () => {
  const fetchImpl = makeMockFetch([
    ["https://1.1.1.1/dns-query", () => publicDohResponse()],
    ["https://city.example.gov", () => new Response(null, { status: 302 })],
  ]);
  const result = await serverFetch("https://city.example.gov/", { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unreachable");
});

// --- size cap ------------------------------------------------------------

test("caps the response body at COMMUNITY_FETCH_MAX_BYTES", async () => {
  const oversized = new Uint8Array(COMMUNITY_FETCH_MAX_BYTES + 1024).fill(97); // "a" * (cap + 1KB)
  const fetchImpl = makeMockFetch([
    ["https://1.1.1.1/dns-query", () => publicDohResponse()],
    ["https://city.example.gov", () => new Response(oversized, { status: 200 })],
  ]);
  const result = await serverFetch("https://city.example.gov/", { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "response_too_large");
});

test("accepts a response body right at the byte cap", async () => {
  const exact = new Uint8Array(COMMUNITY_FETCH_MAX_BYTES).fill(97);
  const fetchImpl = makeMockFetch([
    ["https://1.1.1.1/dns-query", () => publicDohResponse()],
    ["https://city.example.gov", () => new Response(exact, { status: 200 })],
  ]);
  const result = await serverFetch("https://city.example.gov/", { fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.text.length, COMMUNITY_FETCH_MAX_BYTES);
});

// --- timeout -------------------------------------------------------------

test("maps an aborted request to a timeout rejection, not a generic unreachable one", async () => {
  const fetchImpl = makeMockFetch([
    ["https://1.1.1.1/dns-query", () => publicDohResponse()],
    [
      "https://city.example.gov",
      () => {
        const err = new DOMException("The operation was aborted.", "AbortError");
        throw err;
      },
    ],
  ]);
  const result = await serverFetch("https://city.example.gov/", { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "timeout");
});

test("maps a generic network failure to unreachable, distinct from timeout", async () => {
  const fetchImpl = makeMockFetch([
    ["https://1.1.1.1/dns-query", () => publicDohResponse()],
    [
      "https://city.example.gov",
      () => { throw new TypeError("network error"); },
    ],
  ]);
  const result = await serverFetch("https://city.example.gov/", { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unreachable");
});

// --- pure helper functions ------------------------------------------------

test("isPrivateIPv4 covers every documented range", () => {
  assert.equal(isPrivateIPv4("10.1.2.3"), true);
  assert.equal(isPrivateIPv4("172.16.0.1"), true);
  assert.equal(isPrivateIPv4("172.31.255.255"), true);
  assert.equal(isPrivateIPv4("172.32.0.1"), false); // just outside 172.16.0.0/12
  assert.equal(isPrivateIPv4("192.168.1.1"), true);
  assert.equal(isPrivateIPv4("127.0.0.1"), true);
  assert.equal(isPrivateIPv4("169.254.169.254"), true); // cloud metadata address
  assert.equal(isPrivateIPv4("93.184.216.34"), false); // a public address
});

test("isPrivateIPv6 catches loopback, unique-local, and link-local", () => {
  assert.equal(isPrivateIPv6("::1"), true);
  assert.equal(isPrivateIPv6("fc00::1"), true);
  assert.equal(isPrivateIPv6("fd12:3456::1"), true);
  assert.equal(isPrivateIPv6("fe80::1"), true);
  assert.equal(isPrivateIPv6("2001:4860:4860::8888"), false); // a public address (Google DNS)
});

test("looksLikeBareIp flags IPv4 and IPv6 literals, not domain names", () => {
  assert.equal(looksLikeBareIp("93.184.216.34"), true);
  assert.equal(looksLikeBareIp("::1"), true);
  assert.equal(looksLikeBareIp("city.example.gov"), false);
});

test("isBlockedHostname flags localhost and *.internal/*.local suffixes", () => {
  assert.equal(isBlockedHostname("localhost"), true);
  assert.equal(isBlockedHostname("printer.local"), true);
  assert.equal(isBlockedHostname("admin.internal"), true);
  assert.equal(isBlockedHostname("city.example.gov"), false);
});
