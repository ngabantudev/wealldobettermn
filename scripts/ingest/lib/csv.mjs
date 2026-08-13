// scripts/ingest/lib/csv.mjs
//
// A minimal, dependency-free RFC-4180-ish CSV line splitter — handles
// quoted fields (including embedded commas) and doubled-quote escaping
// ("" inside a quoted field), nothing more exotic. Extracted here after
// scripts/ingest/turnout.mjs and scripts/ingest/mn-campaign-finance.mjs
// independently arrived at byte-identical implementations; both now
// import from here instead of each carrying its own copy that a future
// real-world CSV-quoting edge case (found in one script's data) could
// silently fix in one place and leave broken in the other.
//
// Same "write the small parser instead of adding a dependency" choice
// every scripts/ingest/*.mjs in this repo makes for its own format —
// see mn-campaign-finance.mjs's own header for the fuller reasoning.

export function splitCsvLine(line) {
  const fields = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}
