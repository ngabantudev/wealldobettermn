#!/usr/bin/env node
// scripts/ingest/extract-text.mjs
//
// Phase 6 (FEATURES.md) text-extraction step: PDF -> plain text, so
// archived agenda/minutes PDFs (see ./agenda-documents.mjs) become
// searchable and linkable back to individual agenda_item records via
// src/lib/types.ts's AgendaItemSnapshot.extractedTextRef.
//
// STUBBED — deliberately, not an oversight. There is no dependency-light,
// pure-JS PDF text extraction available in Node without pulling in a real
// parser:
//   - pdfjs-dist: Mozilla's own PDF.js. Tens of MB with worker/canvas
//     rendering machinery meant for full rendering, not just text pulls.
//   - pdf-parse: a thin wrapper around pdfjs-dist — same dependency
//     weight, plus its own maintenance history of being loosely kept up.
//   - pdf2json / unpdf: lighter, but still real parser dependencies with
//     their own transitive trees and long-term maintenance risk.
//
// AGENTS.md §0.8 asks for "dependency-light ETL" that "still works in ten
// years with nobody watching." Adding a several-MB PDF-parsing library
// (with its own transitive dependency tree, and its own risk of going
// unmaintained) to satisfy one ingest step is a real tradeoff — not a
// free win — and isn't a decision an AI-assisted scaffolding pass should
// make silently. Two real options for a human maintainer to choose
// between, neither implemented here:
//   1. Take a specific, reviewed PDF-parsing dependency (pdfjs-dist is
//      the most maintained of the three above).
//      2. Shell out to a system `pdftotext` (poppler-utils) where
//      available, falling back to this stub when the binary is missing —
//      keeps the JS dependency tree at zero but pushes a system-package
//      requirement onto whoever runs the ETL, which cuts against
//      "buildable and hostable elsewhere" per AGENTS.md §0.8 in a
//      different way.
//
// Until that decision is made, extractText() throws a clearly-labeled
// NotImplementedError so callers fail loudly instead of silently
// shipping empty or garbage "extracted" text as if it were real —
// AGENTS.md §3.1's "no placeholder data ships as fact" applies to
// derived text too, not just mocked records.

export class NotImplementedError extends Error {
  constructor(message) {
    super(message);
    this.name = "NotImplementedError";
  }
}

/**
 * Extract plain text from a PDF document's raw bytes.
 *
 * @param {Buffer} _pdfBuffer
 * @param {{sourceUrl?: string}} [context]
 * @returns {Promise<string>}
 */
export async function extractText(_pdfBuffer, context = {}) {
  void context;
  throw new NotImplementedError(
    "PDF text extraction is not implemented. See this file's header comment for " +
      "the dependency tradeoff that needs a maintainer decision before this can ship. " +
      "Do not add a PDF-parsing dependency here without that review, and do not fake " +
      "extracted text to unblock a caller — AGENTS.md §3.1."
  );
}
