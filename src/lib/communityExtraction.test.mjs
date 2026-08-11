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
  pageTitleIndicatesMayorCouncilRoster,
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

// --- regression: a "Staff Contact"-style page heading must not poison an
// entire nearby roster (found via a real submission for Hugo, MN) --------

test("a 'Staff Contact' section heading does not cause the denylist to reject real officials listed right after it", () => {
  // Same shape as the real page that surfaced this: a "Staff Contact"
  // label immediately followed by five real people in quick succession.
  const pageText =
    "Meetings are held monthly. Staff Contact Tom Weidt, Mayor Term Expires 12/31/26 651-955-1091 " +
    "Mike Miron, Acting Mayor and Council Member At Large Term Expires 12/31/28 651-402-6492 " +
    "Becky Petryk, Council Member Ward 1 Term Expires 12/31/26 651-398-8524 " +
    "Ben Krull, Council Member Ward 2 Term Expires 12/31/28 612-210-2173 " +
    "David Strub, Council Member Ward 3 Term Expires 12/31/26 651-402-8654";
  const raw = [
    { role: "Mayor", repName: "Tom Weidt", roleSourceQuote: "Tom Weidt, Mayor Term Expires 12/31/26 651-955-1091" },
    {
      role: "Council Member",
      repName: "Mike Miron",
      roleSourceQuote: "Mike Miron, Acting Mayor and Council Member At Large Term Expires 12/31/28 651-402-6492",
    },
    { role: "Council Member", repName: "Becky Petryk", roleSourceQuote: "Becky Petryk, Council Member Ward 1 Term Expires 12/31/26 651-398-8524" },
    { role: "Council Member", repName: "Ben Krull", roleSourceQuote: "Ben Krull, Council Member Ward 2 Term Expires 12/31/28 612-210-2173" },
    { role: "Council Member", repName: "David Strub", roleSourceQuote: "David Strub, Council Member Ward 3 Term Expires 12/31/26 651-402-8654" },
  ];
  const { officials, rejectedMentions } = validateExtraction(raw, pageText);
  assert.deepEqual(
    officials.map((o) => o.repName),
    ["Tom Weidt", "Mike Miron", "Becky Petryk", "Ben Krull", "David Strub"],
  );
  assert.equal(rejectedMentions.length, 0);
});

test("a real, specific staff role (not the generic word 'staff') still gets denylisted right next to a roster", () => {
  // Filler keeps the two quotes farther apart than DENYLIST_WINDOW_CHARS —
  // same reasoning as the STAFF_MIXED_PAGE_HTML fixture above: a too-short
  // fixture makes the "nearby" window spuriously span the whole page.
  const filler =
    "The city holds public meetings monthly, maintains parks and trails, and publishes " +
    "agendas online for residents who want to follow along with upcoming decisions. " +
    "A calendar of events and public notices is also posted every week for anyone " +
    "curious about what's happening around town this season and beyond.";
  const pageText = `Mayor Jane Smith leads the city. ${filler} City Clerk Pat Nguyen is also listed on this same page.`;
  const raw = [
    { role: "Mayor", repName: "Jane Smith", roleSourceQuote: "Mayor Jane Smith leads the city." },
    { role: "Mayor", repName: "Pat Nguyen", roleSourceQuote: "City Clerk Pat Nguyen is also listed on this same page." },
  ];
  const { officials, rejectedMentions } = validateExtraction(raw, pageText);
  assert.deepEqual(officials.map((o) => o.repName), ["Jane Smith"]);
  assert.equal(rejectedMentions[0].reason, "denylist_keyword_nearby");
});

test("regression: 'Directory' (a page heading) does not trigger the 'director' denylist keyword via substring match", () => {
  const pageText = "Staff Directory is below. Mayor Jane Smith leads the city government.";
  const raw = [{ role: "Mayor", repName: "Jane Smith", roleSourceQuote: "Mayor Jane Smith leads the city government." }];
  const { officials, rejectedMentions } = validateExtraction(raw, pageText);
  assert.equal(officials.length, 1);
  assert.equal(rejectedMentions.length, 0);
});

test("a real 'director' role, as its own word, is still denylisted", () => {
  const filler =
    "The city holds public meetings monthly, maintains parks and trails, and publishes " +
    "agendas online for residents who want to follow along with upcoming decisions. " +
    "A calendar of events and public notices is also posted every week for anyone " +
    "curious about what's happening around town this season and beyond.";
  const pageText = `Mayor Jane Smith leads the city. ${filler} Public Works Director John Doe also works here.`;
  const raw = [
    { role: "Mayor", repName: "Jane Smith", roleSourceQuote: "Mayor Jane Smith leads the city." },
    { role: "Mayor", repName: "John Doe", roleSourceQuote: "Public Works Director John Doe also works here." },
  ];
  const { officials, rejectedMentions } = validateExtraction(raw, pageText);
  assert.deepEqual(officials.map((o) => o.repName), ["Jane Smith"]);
  assert.equal(rejectedMentions[0].reason, "denylist_keyword_nearby");
});

// --- regression: a role stated ONCE as a shared heading over several
// names must not force everyone after the first person to be dropped
// (found via a real submission for Grant, MN) -------------------------

test("a 'Council Members' heading stated once, followed by four names with no role word repeated, extracts all four", () => {
  // Same shape as the real page that surfaced this: "Council Members"
  // appears exactly once, immediately before John Rog, then three more
  // names follow in sequence with no role word anywhere near them —
  // only the shared heading, well before the later names. Real distances
  // measured against the live page (see ROLE_EVIDENCE_WINDOW_CHARS's own
  // comment): up to ~330 normalized characters from heading to 4th name.
  const pageText =
    "Mayor Jeff Giefer 11922 Imperial Ave N, Grant MN 55038 Phone: 612-382-9034 jgiefer@cityofgrant.us Term expires: 2028 " +
    "Council Members John Rog 111 Wildwood Road, Willernie, MN 55090 Phone: 612-867-1218 jrog@cityofgrant.us Term Expires: 2026 " +
    "Greg Anderson 8660 Kimbro Lane N 612-720-5883 ganderson@cityofgrant.us Term expires: 2026 " +
    "Ben Cornett 111 Wildwood Road, Willernie, MN 55090 Phone: 812-212-2310 bcornett@cityofgrant.us Term expires: 2028 " +
    "Lindsay Cremona 11589 110th St N, Grant, MN 55082 Phone: 715-937-2764 lcremona@cityofgrant.us Term expires: 2028";
  // Quotes below deliberately do NOT restate "Council Member" next to
  // each name, matching what the current prompt actually asks the model
  // to produce — the whole point under test is that the mechanical
  // role-evidence check, not the quote's own content, is what lets these
  // survive.
  const raw = [
    { role: "Mayor", repName: "Jeff Giefer", roleSourceQuote: "Mayor Jeff Giefer 11922 Imperial Ave N, Grant MN 55038" },
    { role: "Council Member", repName: "John Rog", roleSourceQuote: "Council Members John Rog 111 Wildwood Road, Willernie, MN 55090" },
    { role: "Council Member", repName: "Greg Anderson", roleSourceQuote: "Greg Anderson 8660 Kimbro Lane N 612-720-5883" },
    { role: "Council Member", repName: "Ben Cornett", roleSourceQuote: "Ben Cornett 111 Wildwood Road, Willernie, MN 55090" },
    { role: "Council Member", repName: "Lindsay Cremona", roleSourceQuote: "Lindsay Cremona 11589 110th St N, Grant, MN 55082" },
  ];
  const { officials, rejectedMentions } = validateExtraction(raw, pageText);
  assert.deepEqual(
    officials.map((o) => o.repName),
    ["Jeff Giefer", "John Rog", "Greg Anderson", "Ben Cornett", "Lindsay Cremona"],
  );
  assert.equal(rejectedMentions.length, 0);
});

test("a quote genuinely belonging to a DIFFERENT real person on the page is rejected, not silently attributed to whoever the model claims it for", () => {
  // Reproduces exactly what the real Workers AI model did live against
  // Grant, MN's page: it correctly named all four council members, but
  // for three of them it reused John Rog's own verbatim quote instead of
  // relocating each person's own text — a real, non-hallucinated
  // sentence, just attached to the wrong person. Every check BEFORE this
  // one (quote-exists, denylist, role-evidence) still passes for a reused
  // quote, since it's real, role-adjacent page text; only the
  // name-belongs-to-this-person check catches it.
  const pageText =
    "Mayor Jeff Giefer leads the city. Council Members John Rog serves Ward 1. " +
    "Greg Anderson also serves on the council but has no quote of his own here.";
  const raw = [
    { role: "Mayor", repName: "Jeff Giefer", roleSourceQuote: "Mayor Jeff Giefer leads the city." },
    { role: "Council Member", repName: "John Rog", roleSourceQuote: "Council Members John Rog serves Ward 1." },
    // Greg Anderson's own name IS on the page, but the model reused John
    // Rog's quote instead of Greg's own sentence — the failure mode under
    // test.
    { role: "Council Member", repName: "Greg Anderson", roleSourceQuote: "Council Members John Rog serves Ward 1." },
  ];
  const { officials, rejectedMentions } = validateExtraction(raw, pageText);
  assert.deepEqual(officials.map((o) => o.repName), ["Jeff Giefer", "John Rog"]);
  assert.equal(rejectedMentions.length, 1);
  assert.equal(rejectedMentions[0].repName, "Greg Anderson");
  assert.equal(rejectedMentions[0].reason, "quote_missing_person_name");
});

test("a real, verbatim name with NO Mayor/Council Member evidence anywhere nearby is rejected, even with a clean quote and no denylist hit", () => {
  // Proves the new check is a real backstop, not just a rubber stamp: a
  // genuine substring match with zero denylist keywords nearby (so it
  // would have survived every OTHER existing check) still correctly
  // fails, because nothing on the page ever calls this person a Mayor or
  // Council Member — a model hallucinating a role for someone it found
  // in an unrelated part of the page.
  const filler =
    "The city holds public meetings monthly, maintains parks and trails, and publishes " +
    "agendas online for residents who want to follow along with upcoming decisions. " +
    "A calendar of events and public notices is also posted every week for anyone " +
    "curious about what's happening around town this season and beyond, along with links " +
    "to newsletters, volunteer opportunities, and other community programs residents can join.";
  const pageText = `Mayor Jane Smith leads the city. ${filler} The summer newsletter was edited by Sam Lee this year.`;
  const raw = [
    { role: "Mayor", repName: "Jane Smith", roleSourceQuote: "Mayor Jane Smith leads the city." },
    { role: "Council Member", repName: "Sam Lee", roleSourceQuote: "The summer newsletter was edited by Sam Lee this year." },
  ];
  const { officials, rejectedMentions } = validateExtraction(raw, pageText);
  assert.deepEqual(officials.map((o) => o.repName), ["Jane Smith"]);
  assert.equal(rejectedMentions[0].reason, "role_not_evidenced_nearby");
});

// --- wardLabel: a text-only label, never a resolved boundary --------------

test("a wardLabel that actually appears on the page is captured and kept", () => {
  const pageText = "Council Member Alex Rivera represents Ward 1 on the Example City Council.";
  const raw = [{ role: "Council Member", repName: "Alex Rivera", roleSourceQuote: pageText, wardLabel: "Ward 1" }];
  const { officials, rejectedMentions } = validateExtraction(raw, pageText);
  assert.equal(officials.length, 1);
  assert.equal(officials[0].wardLabel, "Ward 1");
  assert.equal(rejectedMentions.length, 0);
});

test("a hallucinated wardLabel is dropped to null WITHOUT rejecting the whole official — it's supplementary, not proof of office", () => {
  const pageText = "Jane Smith has served as Mayor of Example since 2022.";
  const raw = [
    {
      role: "Mayor",
      repName: "Jane Smith",
      roleSourceQuote: pageText,
      // "Ward 4" never appears anywhere in pageText — a fabricated label
      // the mock model asserts anyway, same adversarial shape as the
      // hallucinated-quote test above.
      wardLabel: "Ward 4",
    },
  ];
  const { officials, rejectedMentions } = validateExtraction(raw, pageText);
  assert.equal(officials.length, 1);
  assert.equal(officials[0].repName, "Jane Smith");
  assert.equal(officials[0].wardLabel, null);
  assert.equal(rejectedMentions.length, 0);
});

test("no wardLabel stated on the page (e.g. an at-large city) yields null, not an empty string or a guess", () => {
  const pageText = "Jane Smith has served as Mayor of Example since 2022.";
  const raw = [{ role: "Mayor", repName: "Jane Smith", roleSourceQuote: pageText, wardLabel: "" }];
  const { officials } = validateExtraction(raw, pageText);
  assert.equal(officials[0].wardLabel, null);
});

// --- repEmail/repPhone: verified against the page, not blindly trusted ----
// (found live, Oakdale MN, before the htmlText.ts mailto:/tel: fix)

test("a repEmail/repPhone that actually appear on the page are kept", () => {
  const pageText = "Mayor Jane Smith leads the city. Email Mayor Jane Smith (jane.smith@example.gov). Phone: 555-1234.";
  const raw = [{ role: "Mayor", repName: "Jane Smith", roleSourceQuote: "Mayor Jane Smith leads the city.", repEmail: "jane.smith@example.gov", repPhone: "555-1234" }];
  const { officials } = validateExtraction(raw, pageText);
  assert.equal(officials[0].repEmail, "jane.smith@example.gov");
  assert.equal(officials[0].repPhone, "555-1234");
});

test("a hallucinated repEmail/repPhone are dropped to null WITHOUT rejecting the whole official", () => {
  const pageText = "Mayor Jane Smith leads the city.";
  const raw = [
    {
      role: "Mayor",
      repName: "Jane Smith",
      roleSourceQuote: pageText,
      // Neither of these appears anywhere in pageText.
      repEmail: "jane.smith@example.gov",
      repPhone: "555-1234",
    },
  ];
  const { officials, rejectedMentions } = validateExtraction(raw, pageText);
  assert.equal(officials.length, 1);
  assert.equal(officials[0].repEmail, null);
  assert.equal(officials[0].repPhone, null);
  assert.equal(rejectedMentions.length, 0);
});

// --- termExpires: verified the same way as wardLabel ----------------------

test("a termExpires that actually appears on the page is captured and kept", () => {
  const pageText = "Mayor Jane Smith leads the city. Term Expires: December 31, 2028.";
  const raw = [{ role: "Mayor", repName: "Jane Smith", roleSourceQuote: "Mayor Jane Smith leads the city.", termExpires: "December 31, 2028" }];
  const { officials } = validateExtraction(raw, pageText);
  assert.equal(officials[0].termExpires, "December 31, 2028");
});

test("a hallucinated termExpires is dropped to null WITHOUT rejecting the whole official", () => {
  const pageText = "Mayor Jane Smith leads the city.";
  const raw = [{ role: "Mayor", repName: "Jane Smith", roleSourceQuote: pageText, termExpires: "December 31, 2028" }];
  const { officials, rejectedMentions } = validateExtraction(raw, pageText);
  assert.equal(officials.length, 1);
  assert.equal(officials[0].termExpires, null);
  assert.equal(rejectedMentions.length, 0);
});

// --- page-title role-evidence fallback (Council Member only) --------------
// Found live, Inver Grove Heights, MN: a real table roster had a Mayor row
// saying "Mayor" right there, then four Council Member rows with NO role
// word anywhere near them — not even far away, genuinely absent from the
// whole page except an unrelated "Committees & Boards" section far below
// that only names 2 of the 4 by a role word, well outside
// ROLE_EVIDENCE_WINDOW_CHARS. The page's own <title>, "Mayor & Council |
// Inver Grove Heights, MN", is the only real signal available.

test("pageTitleIndicatesMayorCouncilRoster requires BOTH words, not a bare 'council'", () => {
  assert.equal(pageTitleIndicatesMayorCouncilRoster("Mayor & Council | Inver Grove Heights, MN"), true);
  assert.equal(pageTitleIndicatesMayorCouncilRoster("City Council Meetings | Example, MN"), false); // no "mayor"
  assert.equal(pageTitleIndicatesMayorCouncilRoster("Planning Council | Example, MN"), false); // no "mayor"
  assert.equal(pageTitleIndicatesMayorCouncilRoster(null), false);
  assert.equal(pageTitleIndicatesMayorCouncilRoster(""), false);
});

test("a Council Member with NO role word anywhere on the page survives when the page's own title says 'Mayor & Council'", () => {
  // Shaped exactly like the real Inver Grove Heights page: a Mayor row
  // (with "Mayor" right there) followed by a Council Member with no role
  // word anywhere near — or anywhere at all — on the rest of the page.
  const pageText = "Mayor Brenda Dietrich Voicemail: 651-450-2503 Sue Gliva Voicemail: 651-450-2506 December 31, 2028";
  const raw = [
    { role: "Mayor", repName: "Brenda Dietrich", roleSourceQuote: "Mayor Brenda Dietrich Voicemail: 651-450-2503" },
    { role: "Council Member", repName: "Sue Gliva", roleSourceQuote: "Sue Gliva Voicemail: 651-450-2506" },
  ];
  const { officials, rejectedMentions } = validateExtraction(raw, pageText, "Mayor & Council | Inver Grove Heights, MN");
  assert.deepEqual(officials.map((o) => o.repName), ["Brenda Dietrich", "Sue Gliva"]);
  assert.equal(rejectedMentions.length, 0);
});

test("the SAME page, without the pageTitle argument, correctly rejects the Council Member with no nearby role evidence — proves the fallback is doing real work, not masking a broken check", () => {
  const pageText = "Mayor Brenda Dietrich Voicemail: 651-450-2503 Sue Gliva Voicemail: 651-450-2506 December 31, 2028";
  const raw = [
    { role: "Mayor", repName: "Brenda Dietrich", roleSourceQuote: "Mayor Brenda Dietrich Voicemail: 651-450-2503" },
    { role: "Council Member", repName: "Sue Gliva", roleSourceQuote: "Sue Gliva Voicemail: 651-450-2506" },
  ];
  const { officials, rejectedMentions } = validateExtraction(raw, pageText); // no pageTitle arg
  assert.deepEqual(officials.map((o) => o.repName), ["Brenda Dietrich"]);
  assert.equal(rejectedMentions[0].reason, "role_not_evidenced_nearby");
});

test("the page-title fallback does NOT apply to Mayor — a mislabeled Mayor with no nearby 'mayor' text still correctly fails, even on a 'Mayor & Council' page", () => {
  // Deliberately no "mayor" anywhere in the page BODY text (only in the
  // separately-passed title) — if this test used a page body that
  // happened to say "mayor" near the quote, the ordinary windowed check
  // would pass it for an unrelated reason and this wouldn't actually
  // prove the title fallback is Council-Member-only.
  const pageText = "Sue Gliva is listed here on this roster page, alongside several other names and unrelated filler text.";
  const raw = [{ role: "Mayor", repName: "Sue Gliva", roleSourceQuote: "Sue Gliva is listed here on this roster page" }];
  const { officials, rejectedMentions } = validateExtraction(raw, pageText, "Mayor & Council | Example, MN");
  assert.equal(officials.length, 0);
  assert.equal(rejectedMentions[0].reason, "role_not_evidenced_nearby");
});
