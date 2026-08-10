#!/usr/bin/env node
// src/lib/htmlText.test.mjs
//
// Run directly: node --test src/lib/htmlText.test.mjs
// Or via: npm run test:lib

import assert from "node:assert/strict";
import test from "node:test";
import { htmlToVisibleText, normalizedIncludes } from "./htmlText.ts";

test("strips tags and collapses whitespace", () => {
  const html = "<div>\n  <h1>City of  Example</h1>\n  <p>Mayor: <b>Jane Smith</b></p>\n</div>";
  assert.equal(htmlToVisibleText(html), "City of Example Mayor: Jane Smith");
});

test("drops script and style blocks entirely, not just their tags", () => {
  const html = "<style>.x{color:red}</style><p>Council</p><script>trackEverything()</script>";
  assert.equal(htmlToVisibleText(html), "Council");
});

test("drops nav/header/footer chrome entirely, not just their tags — found via a real submission (Ham Lake, MN)", () => {
  // Real page shape: a dense nav-menu breadcrumb lists the same roster in
  // abbreviated form ("CM" for Council Member) right next to unrelated
  // nav links like "Administration/Clerk" — close enough in raw character
  // count to spuriously trip communityExtraction.ts's denylist, even
  // though nobody on the page is actually a clerk. The real, well-formed
  // roster lives in body content further down and should survive intact.
  const html =
    "<header class=\"header\"><nav role=\"navigation\">Departments Administration/Clerk Building/Inspections " +
    "Government Mayor and City Council Mayor Brian Kirkham CM Jim Doyle</nav></header>" +
    "<main><h1>Mayor and City Council</h1>" +
    "<p>City Council Profiles Mayor Brian Kirkham Councilmember Jim Doyle</p></main>" +
    "<footer id=\"footer\">City Hall (763) 434-9555</footer>";
  const visible = htmlToVisibleText(html);
  assert.equal(visible.includes("Administration/Clerk"), false);
  assert.equal(visible.includes("(763) 434-9555"), false);
  assert.equal(visible.includes("City Council Profiles Mayor Brian Kirkham Councilmember Jim Doyle"), true);
});

test("decodes common named and numeric entities", () => {
  const html = "<p>City &amp; County &mdash; est. 1875 &#39;Downtown&#39;</p>";
  assert.equal(htmlToVisibleText(html), "City & County — est. 1875 'Downtown'");
});

test("a quote separated by tags in the source still matches visible text after stripping", () => {
  const html = "<span>Mayor</span> <span>Jane Smith</span>";
  const visible = htmlToVisibleText(html);
  assert.equal(normalizedIncludes(visible, "Mayor Jane Smith"), true);
});

test("normalizedIncludes is case- and whitespace-insensitive", () => {
  assert.equal(normalizedIncludes("City   of   EXAMPLE", "city of example"), true);
  assert.equal(normalizedIncludes("City of Example", "Springfield"), false);
});

test("normalizedIncludes rejects a blank needle rather than trivially matching everything", () => {
  assert.equal(normalizedIncludes("City of Example", ""), false);
  assert.equal(normalizedIncludes("City of Example", "   "), false);
});
