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

test("exposes a mailto: link's real address, appended in parens to its visible label — found via a real submission (Oakdale, MN)", () => {
  // Real page shape: the visible link text was just "Email Mayor Kevin
  // Zabel" — a generic label — with the real address only ever present
  // in href="mailto:...". Nothing downstream of tag-stripping (the model
  // call, quote verification) could ever have seen it before this fix.
  const html = '<p>Mayor Kevin Zabel <a href="mailto:kevin.zabel@oakdalemn.gov">Email Mayor Kevin Zabel</a></p>';
  const visible = htmlToVisibleText(html);
  assert.equal(visible, "Mayor Kevin Zabel Email Mayor Kevin Zabel (kevin.zabel@oakdalemn.gov)");
});

test("exposes a tel: link's real number the same way — the identical hidden-href failure mode, not unique to email", () => {
  const html = '<a href="tel:+16515551234">Call City Hall</a>';
  assert.equal(htmlToVisibleText(html), "Call City Hall (+16515551234)");
});

test("strips a mailto: link's ?subject=/&body= query string, keeping only the actual address", () => {
  const html = '<a href="mailto:clerk@example.gov?subject=Records%20Request&body=Hello">Email the Clerk</a>';
  assert.equal(htmlToVisibleText(html), "Email the Clerk (clerk@example.gov)");
});

test("a mailto: link with nested tags in its label still exposes the address correctly", () => {
  const html = '<a href="mailto:mayor@example.gov"><span class="icon"></span><b>Email Mayor Smith</b></a>';
  const visible = htmlToVisibleText(html);
  assert.equal(visible, "Email Mayor Smith (mayor@example.gov)");
});

test("multiple mailto: links on the same page each expose their own distinct address", () => {
  const html =
    '<p>Council Member Kari Moore <a href="mailto:kari.moore@example.gov">Email Kari Moore</a></p>' +
    '<p>Council Member Andy Morcomb <a href="mailto:andy.morcomb@example.gov">Email Andy Morcomb</a></p>';
  const visible = htmlToVisibleText(html);
  assert.equal(visible.includes("Email Kari Moore (kari.moore@example.gov)"), true);
  assert.equal(visible.includes("Email Andy Morcomb (andy.morcomb@example.gov)"), true);
});

test("never throws on a malformed mailto: %-escape, falling back to the raw value", () => {
  const html = '<a href="mailto:bad%escape@example.gov">Email</a>';
  assert.doesNotThrow(() => htmlToVisibleText(html));
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
