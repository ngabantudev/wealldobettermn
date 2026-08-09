#!/usr/bin/env node
// src/lib/communityExtraction.test.mjs
//
// Tests for the §1b/§1d structural extraction gate (AGENTS.md §2.6). The
// load-bearing property under test throughout: a hallucinated or
// mislabeled record can NEVER survive validateExtraction()/
// extractOfficials(), regardless of what a (mocked) model returns — the
// mechanical checks, not prompt compliance, are what's being verified.
//
// Run directly: node --test src/lib/communityExtraction.test.mjs
// Or via: npm run test:lib

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExtractionPrompt,
  extractOfficials,
  parseModelOutput,
  validateExtraction,
} from "./communityExtraction.ts";

function mockAi(responder) {
  const calls = [];
  return {
    calls,
    run: async (model, input) => {
      calls.push({ model, input });
      return responder(model, input);
    },
  };
}

const CLEAN_PAGE_HTML = `
  <html><body>
    <h1>City of Example</h1>
    <div class="official">
      <h2>Mayor Jane Smith</h2>
      <p>Jane Smith has served as Mayor of Example since 2022.</p>
      <p>Contact: <a href="mailto:mayor@example.gov">mayor@example.gov</a></p>
    </div>
    <div class="official">
      <h2>Council Member Alex Rivera</h2>
      <p>Alex Rivera represents Ward 1 on the Example City Council.</p>
    </div>
    <div class="official">
      <h2>Council Member Priya Nair</h2>
      <p>Priya Nair represents Ward 2 on the Example City Council.</p>
    </div>
  </body></html>
`;

// The filler paragraph below is deliberately long (>250 chars) so the
// Mayor mention and the Clerk mention sit farther apart than
// DENYLIST_WINDOW_CHARS in communityExtraction.ts — otherwise a
// short/unrealistic fixture would make the denylist "nearby" check
// spuriously span the whole page and reject the legitimate Mayor record
// too, which is not the behavior under test here (see the dedicated
// mislabeling tests below for that case).
const STAFF_MIXED_PAGE_HTML = `
  <html><body>
    <h1>City of Example — Government</h1>
    <p>Mayor Jane Smith leads the City of Example.</p>
    <p>The City of Example holds regular public meetings, maintains several parks and
    trails, and publishes agendas online. Residents can find recycling schedules, permit
    information, and community event calendars on the city's website, along with archived
    meeting minutes going back several years and a full listing of city services for
    anyone who wants to get more involved in local decisions throughout the year.</p>
    <p>City Clerk Pat Nguyen manages records and elections for the city.</p>
  </body></html>
`;

const NO_OFFICIALS_PAGE_HTML = `
  <html><body>
    <h1>City of Example</h1>
    <p>Welcome to our community calendar and public works updates.</p>
  </body></html>
`;

// --- extractOfficials: happy path ----------------------------------------

test("extractOfficials returns a clean record for each mayor/council member whose quote checks out", async () => {
  const ai = mockAi(() => ({
    officials: [
      {
        role: "Mayor",
        repName: "Jane Smith",
        roleSourceQuote: "Jane Smith has served as Mayor of Example since 2022.",
        repEmail: "mayor@example.gov",
        repPhone: null,
      },
      {
        role: "Council Member",
        repName: "Alex Rivera",
        roleSourceQuote: "Alex Rivera represents Ward 1 on the Example City Council.",
        repEmail: null,
        repPhone: null,
      },
    ],
  }));
  const result = await extractOfficials({ ai, pageHtml: CLEAN_PAGE_HTML, cityName: "Example" });
  assert.equal(result.ok, true);
  assert.equal(result.officials.length, 2);
  assert.equal(result.officials[0].role, "Mayor");
  assert.equal(result.officials[0].repEmail, "mayor@example.gov");
  assert.equal(result.officials[1].role, "Council Member");
  assert.equal(result.rejectedMentions.length, 0);
});

// --- extractOfficials: the adversarial case -------------------------------

test("a hallucinated quote is mechanically rejected regardless of what the mocked model returns", async () => {
  const ai = mockAi(() => ({
    officials: [
      {
        role: "Mayor",
        repName: "Nobody Real",
        // This sentence never appears anywhere in CLEAN_PAGE_HTML — a
        // fabricated attribution the mock "confidently" asserts anyway.
        roleSourceQuote: "Nobody Real was unanimously elected Mayor in a landslide.",
        repEmail: null,
        repPhone: null,
      },
    ],
  }));
  const result = await extractOfficials({ ai, pageHtml: CLEAN_PAGE_HTML, cityName: "Example" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_officials_survived");
  assert.equal(result.rejectedMentions.length, 1);
  assert.equal(result.rejectedMentions[0].reason, "quote_not_found_in_source");
});

test("a role outside the two-value enum is mechanically rejected even if the schema was supposedly followed", async () => {
  const ai = mockAi(() => ({
    officials: [
      {
        role: "City Clerk", // not in the allowed enum — a model ignoring instructions
        repName: "Pat Nguyen",
        roleSourceQuote: "City Clerk Pat Nguyen manages records and elections for the city.",
        repEmail: null,
        repPhone: null,
      },
    ],
  }));
  const result = await extractOfficials({ ai, pageHtml: STAFF_MIXED_PAGE_HTML, cityName: "Example" });
  assert.equal(result.ok, false);
  assert.equal(result.rejectedMentions[0].reason, "role_not_in_enum");
});

test("a staff member mislabeled with an allowed role is caught by the denylist, not just the enum check", async () => {
  const ai = mockAi(() => ({
    officials: [
      {
        role: "Mayor", // mislabeled — this is actually the city clerk
        repName: "Pat Nguyen",
        roleSourceQuote: "City Clerk Pat Nguyen manages records and elections for the city.",
        repEmail: null,
        repPhone: null,
      },
    ],
  }));
  const result = await extractOfficials({ ai, pageHtml: STAFF_MIXED_PAGE_HTML, cityName: "Example" });
  assert.equal(result.ok, false);
  assert.equal(result.rejectedMentions[0].reason, "denylist_keyword_nearby");
});

test("a real mayor mention survives on the same page as a denylisted staff mention", async () => {
  const ai = mockAi(() => ({
    officials: [
      {
        role: "Mayor",
        repName: "Jane Smith",
        roleSourceQuote: "Mayor Jane Smith leads the City of Example.",
        repEmail: null,
        repPhone: null,
      },
    ],
  }));
  const result = await extractOfficials({ ai, pageHtml: STAFF_MIXED_PAGE_HTML, cityName: "Example" });
  assert.equal(result.ok, true);
  assert.equal(result.officials.length, 1);
  assert.equal(result.officials[0].repName, "Jane Smith");
});

test("an empty repName is rejected even with an otherwise-valid role and quote", async () => {
  const ai = mockAi(() => ({
    officials: [{ role: "Mayor", repName: "  ", roleSourceQuote: "Mayor Jane Smith leads the City of Example.", repEmail: null, repPhone: null }],
  }));
  const result = await extractOfficials({ ai, pageHtml: STAFF_MIXED_PAGE_HTML, cityName: "Example" });
  assert.equal(result.ok, false);
  assert.equal(result.rejectedMentions[0].reason, "empty_name");
});

// --- extractOfficials: minimum-viable-result gate -------------------------

test("fails with no_officials_survived, not a partial publish, when the model finds nobody", async () => {
  const ai = mockAi(() => ({ officials: [] }));
  const result = await extractOfficials({ ai, pageHtml: NO_OFFICIALS_PAGE_HTML, cityName: "Example" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_officials_survived");
});

test("fails with no_city_name_evidence and never calls the model at all, as a cheap pre-filter", async () => {
  const ai = mockAi(() => {
    throw new Error("the model should never be called for this case");
  });
  const result = await extractOfficials({ ai, pageHtml: NO_OFFICIALS_PAGE_HTML, cityName: "Springfield" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_city_name_evidence");
  assert.equal(ai.calls.length, 0);
});

test("model errors are surfaced as model_error with a plain-language message, not thrown", async () => {
  const ai = mockAi(() => {
    throw new Error("upstream timeout");
  });
  const result = await extractOfficials({ ai, pageHtml: CLEAN_PAGE_HTML, cityName: "Example" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "model_error");
});

test("unparseable model output fails cleanly rather than crashing", async () => {
  const ai = mockAi(() => "this is not json at all, just prose");
  const result = await extractOfficials({ ai, pageHtml: CLEAN_PAGE_HTML, cityName: "Example" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "model_output_unparseable");
});

// --- parseModelOutput: defensive shape handling ---------------------------

test("parseModelOutput accepts the object directly", () => {
  const parsed = parseModelOutput({ officials: [{ role: "Mayor" }] });
  assert.deepEqual(parsed, { officials: [{ role: "Mayor" }] });
});

test("parseModelOutput accepts a nested .response object", () => {
  const parsed = parseModelOutput({ response: { officials: [] } });
  assert.deepEqual(parsed, { officials: [] });
});

test("parseModelOutput accepts a .response field holding a JSON string", () => {
  const parsed = parseModelOutput({ response: JSON.stringify({ officials: [{ role: "Council Member" }] }) });
  assert.deepEqual(parsed, { officials: [{ role: "Council Member" }] });
});

test("parseModelOutput recovers JSON from a .response string wrapped in prose/code fences", () => {
  const wrapped = "Here is the result:\n```json\n" + JSON.stringify({ officials: [] }) + "\n```";
  const parsed = parseModelOutput({ response: wrapped });
  assert.deepEqual(parsed, { officials: [] });
});

test("parseModelOutput returns null for genuinely unusable output, never throws", () => {
  assert.equal(parseModelOutput(null), null);
  assert.equal(parseModelOutput(undefined), null);
  assert.equal(parseModelOutput("plain string with no json"), null);
  assert.equal(parseModelOutput({ response: "still no json here" }), null);
  assert.equal(parseModelOutput({ officials: "not an array" }), null);
});

// --- validateExtraction, exercised directly -------------------------------

test("validateExtraction reports every rejection reason distinctly, not a single generic failure", () => {
  // Same reasoning as STAFF_MIXED_PAGE_HTML above: the Mayor quote and the
  // Clerk quote need to sit farther apart than DENYLIST_WINDOW_CHARS or
  // the legitimate Jane Smith record would be spuriously caught too.
  const filler =
    "The city holds public meetings monthly, maintains parks and trails, and publishes " +
    "agendas online for residents who want to follow along with upcoming decisions. " +
    "A calendar of events and public notices is also posted every week for anyone " +
    "curious about what's happening around town this season and beyond.";
  const pageText = `Mayor Jane Smith leads the city. ${filler} City Clerk Pat Nguyen keeps the records.`;
  const raw = [
    { role: "Mayor", repName: "Jane Smith", roleSourceQuote: "Mayor Jane Smith leads the city." },
    { role: "President", repName: "Someone", roleSourceQuote: "Mayor Jane Smith leads the city." },
    { role: "Mayor", repName: "Ghost", roleSourceQuote: "This sentence is not in the page." },
    { role: "Mayor", repName: "Pat Nguyen", roleSourceQuote: "City Clerk Pat Nguyen keeps the records." },
  ];
  const { officials, rejectedMentions } = validateExtraction(raw, pageText);
  assert.equal(officials.length, 1);
  assert.equal(officials[0].repName, "Jane Smith");
  assert.deepEqual(
    rejectedMentions.map((r) => r.reason),
    ["role_not_in_enum", "quote_not_found_in_source", "denylist_keyword_nearby"],
  );
});

// --- buildExtractionPrompt --------------------------------------------------

test("buildExtractionPrompt names the city and instructs against staff/private individuals", () => {
  const { system, user } = buildExtractionPrompt("Example", "some page text");
  assert.match(system, /Example/);
  assert.match(system, /clerk/i);
  assert.match(system, /private individual/i);
  assert.match(user, /some page text/);
});
