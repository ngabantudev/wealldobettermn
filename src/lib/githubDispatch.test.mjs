#!/usr/bin/env node
// src/lib/githubDispatch.test.mjs
//
// Run directly: node --test src/lib/githubDispatch.test.mjs
// Or via: npm run test:lib

import assert from "node:assert/strict";
import test from "node:test";
import { triggerRepositoryDispatch } from "./githubDispatch.ts";

function mockFetch(handler) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url: String(url), options });
    return handler(url, options);
  };
  impl.calls = calls;
  return impl;
}

test("posts to the correct repo's dispatches endpoint with the event type and payload", async () => {
  const fetchImpl = mockFetch((url) => {
    assert.equal(url, "https://api.github.com/repos/ngabantudev/wealldobettermn/dispatches");
    return new Response(null, { status: 204 });
  });
  const result = await triggerRepositoryDispatch(
    "community-submission-graduated",
    { submissionId: "sub-1", cityName: "Hugo" },
    { fetchImpl, token: "a-token", repo: "ngabantudev/wealldobettermn" },
  );
  assert.equal(result.ok, true);
  assert.equal(result.status, 204);
  assert.equal(fetchImpl.calls.length, 1);

  const body = JSON.parse(fetchImpl.calls[0].options.body);
  assert.equal(body.event_type, "community-submission-graduated");
  assert.deepEqual(body.client_payload, { submissionId: "sub-1", cityName: "Hugo" });
});

test("sends the token as a Bearer Authorization header, never in the URL or body", async () => {
  const fetchImpl = mockFetch((url, options) => {
    assert.equal(options.headers.Authorization, "Bearer secret-pat-value");
    assert.equal(url.includes("secret-pat-value"), false);
    assert.equal(JSON.stringify(options.body).includes("secret-pat-value"), false);
    return new Response(null, { status: 204 });
  });
  await triggerRepositoryDispatch("community-submission-disputed", {}, { fetchImpl, token: "secret-pat-value", repo: "owner/repo" });
});

test("reports ok:false with the real status on a non-2xx GitHub response, never throws", async () => {
  const fetchImpl = mockFetch(() => new Response("bad credentials", { status: 401 }));
  const result = await triggerRepositoryDispatch("community-submission-graduated", {}, { fetchImpl, token: "bad-token", repo: "owner/repo" });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test("reports ok:false with status 0 on a network-level failure, never throws", async () => {
  const fetchImpl = mockFetch(() => {
    throw new TypeError("network down");
  });
  await assert.doesNotReject(async () => {
    const result = await triggerRepositoryDispatch("community-submission-graduated", {}, { fetchImpl, token: "t", repo: "owner/repo" });
    assert.equal(result.ok, false);
    assert.equal(result.status, 0);
  });
});
