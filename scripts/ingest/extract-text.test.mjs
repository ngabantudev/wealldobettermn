#!/usr/bin/env node
// scripts/ingest/extract-text.test.mjs
//
// Tests for the Phase 6 PDF text extraction step (see ./extract-text.mjs).
// Uses Node's built-in test runner (`node --test`), matching
// ./roster-diff.test.mjs's convention.
//
// Fixtures are minimal, hand-built PDF byte buffers generated in this
// file — not real government agenda PDFs (per this task's guidance:
// don't vendor real source documents into test fixtures). buildMinimalPdf()
// constructs a legally-inert, single-page PDF with a real embedded text
// stream, computing its own xref byte offsets so the PDF is a genuinely
// valid document a real parser accepts, not a happy-path fake.
//
// The extractAndStoreDocumentText() tests exercise the real function
// against public/documents/agendas/ (the same directory
// agenda-documents.mjs archives into), using throwaway content hashes
// that are cleaned up in t.after() — never real archived documents.
//
// Run directly: node scripts/ingest/extract-text.test.mjs
// Or via the whole ingest suite: node --test scripts/ingest/

import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { extractAndStoreDocumentText, extractText, ExtractionFailedError } from "./extract-text.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCUMENTS_DIR = path.join(__dirname, "../../public/documents/agendas");

/**
 * Build a minimal, valid, single-page PDF as a Buffer, with a real
 * Tj text-showing operator in its content stream (or an empty content
 * stream, for the "no text layer" fixture). Computes real xref offsets
 * rather than hard-coding them, so this is a structurally valid PDF a
 * real parser accepts — not a stub.
 *
 * @param {string} text - text to place on the page; "" for no text at all.
 * @returns {Buffer}
 */
function buildMinimalPdf(text) {
  const escaped = text.replace(/([()\\])/g, "\\$1");
  // Small font size on a wide page: pdf.js's text-content extraction
  // drops glyphs positioned beyond the page's MediaBox, so the box has
  // to be wide enough to actually contain the whole rendered line.
  const contentStream = text ? `BT /F1 10 Tf 20 100 Td (${escaped}) Tj ET` : "";

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 1200 150] /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0]; // object 0 is the free-list head, never written directly

  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = Buffer.byteLength(pdf, "latin1");
  const count = objects.length + 1;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += xref;
  pdf += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, "latin1");
}

test("extractText pulls real text out of a PDF with a text layer", async () => {
  const pdf = buildMinimalPdf("Agenda Item 12: Approve Contract 2026-014");
  const { text, pageCount } = await extractText(pdf);

  assert.equal(pageCount, 1);
  assert.match(text, /Agenda Item 12: Approve Contract 2026-014/);
});

test("extractText throws ExtractionFailedError for a PDF with no text layer", async () => {
  const pdf = buildMinimalPdf(""); // valid PDF, empty content stream — no text anywhere
  await assert.rejects(
    () => extractText(pdf),
    (err) => {
      assert.ok(err instanceof ExtractionFailedError);
      assert.match(err.reason, /no meaningful text layer/);
      return true;
    }
  );
});

test("extractText throws ExtractionFailedError for bytes that aren't a real PDF", async () => {
  const notAPdf = Buffer.from("this is not a pdf file at all, just plain bytes");
  await assert.rejects(
    () => extractText(notAPdf),
    (err) => {
      assert.ok(err instanceof ExtractionFailedError);
      assert.match(err.reason, /could not parse PDF structure/);
      return true;
    }
  );
});

test("extractText throws ExtractionFailedError for an empty buffer", async () => {
  await assert.rejects(
    () => extractText(Buffer.alloc(0)),
    (err) => {
      assert.ok(err instanceof ExtractionFailedError);
      assert.match(err.reason, /empty file/);
      return true;
    }
  );
});

test("extractAndStoreDocumentText writes extracted text and updates the sidecar record on success", async (t) => {
  const contentHash = `test-extracted-${Date.now()}`;
  const pdfPath = path.join(DOCUMENTS_DIR, `${contentHash}.pdf`);
  const txtPath = path.join(DOCUMENTS_DIR, `${contentHash}.txt`);
  const jsonPath = path.join(DOCUMENTS_DIR, `${contentHash}.json`);
  t.after(() => Promise.all([rm(pdfPath, { force: true }), rm(txtPath, { force: true }), rm(jsonPath, { force: true }) ]));

  const pdf = buildMinimalPdf("Minutes of the Regular Meeting, August 6, 2026");
  await mkdir(DOCUMENTS_DIR, { recursive: true });
  await writeFile(pdfPath, pdf);

  const record = {
    sourceUrl: "https://example.gov/minutes.pdf",
    documentType: "minutes",
    sourceAgency: "Example City Council",
    fetchedAt: "2026-08-06T00:00:00.000Z",
    contentHash,
    storedPath: `documents/agendas/${contentHash}.pdf`,
    byteLength: pdf.byteLength,
    contentType: "application/pdf",
    extractedTextRef: null,
    extractionStatus: "pending",
  };

  const result = await extractAndStoreDocumentText(record);

  assert.equal(result.extractionStatus, "extracted");
  assert.equal(result.extractedTextRef, `documents/agendas/${contentHash}.txt`);

  const storedText = await readFile(txtPath, "utf-8");
  assert.match(storedText, /Minutes of the Regular Meeting, August 6, 2026/);

  const storedRecord = JSON.parse(await readFile(jsonPath, "utf-8"));
  assert.equal(storedRecord.extractionStatus, "extracted");
  assert.equal(storedRecord.extractedTextRef, `documents/agendas/${contentHash}.txt`);
});

test("extractAndStoreDocumentText records extractionStatus: failed honestly, never fabricates text", async (t) => {
  const contentHash = `test-scanned-${Date.now()}`;
  const pdfPath = path.join(DOCUMENTS_DIR, `${contentHash}.pdf`);
  const jsonPath = path.join(DOCUMENTS_DIR, `${contentHash}.json`);
  t.after(() => Promise.all([rm(pdfPath, { force: true }), rm(jsonPath, { force: true })]));

  const pdf = buildMinimalPdf(""); // no text layer — e.g. a scanned page
  await mkdir(DOCUMENTS_DIR, { recursive: true });
  await writeFile(pdfPath, pdf);

  const record = {
    sourceUrl: "https://example.gov/scanned-agenda.pdf",
    documentType: "agenda",
    sourceAgency: "Example City Council",
    fetchedAt: "2026-08-06T00:00:00.000Z",
    contentHash,
    storedPath: `documents/agendas/${contentHash}.pdf`,
    byteLength: pdf.byteLength,
    contentType: "application/pdf",
    extractedTextRef: null,
    extractionStatus: "pending",
  };

  const result = await extractAndStoreDocumentText(record);

  assert.equal(result.extractionStatus, "failed");
  assert.equal(result.extractedTextRef, null);
  assert.match(result.extractionFailureReason, /no meaningful text layer/);

  const storedRecord = JSON.parse(await readFile(jsonPath, "utf-8"));
  assert.equal(storedRecord.extractionStatus, "failed");
  assert.equal(storedRecord.extractedTextRef, null);
});

test("extractAndStoreDocumentText leaves video documents alone (not a PDF-text pipeline)", async () => {
  const record = {
    sourceUrl: "https://example.gov/meeting.mp4",
    documentType: "video",
    sourceAgency: "Example City Council",
    fetchedAt: "2026-08-06T00:00:00.000Z",
    contentHash: "unused-video-hash",
    storedPath: "documents/agendas/unused-video-hash.mp4",
    byteLength: 12345,
    contentType: "video/mp4",
    extractedTextRef: null,
    extractionStatus: "pending",
  };

  const result = await extractAndStoreDocumentText(record);
  assert.deepEqual(result, record);
});
