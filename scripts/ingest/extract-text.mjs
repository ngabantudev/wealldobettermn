#!/usr/bin/env node
// scripts/ingest/extract-text.mjs
//
// Phase 6 (FEATURES.md) text-extraction step: PDF -> plain text, so
// archived agenda/minutes PDFs (see ./agenda-documents.mjs) become
// searchable and linkable back to individual agenda_item records via
// src/lib/types.ts's AgendaItemSnapshot.extractedTextRef.
//
// Dependency chosen: `unpdf` (devDependency, ingest-only — see
// package.json's devDependencies, alongside but-unzip/shpjs which are
// the same kind of ETL-only tool). Not `pdf-parse`:
//   - pdf-parse's actively-published line (2.x, since Oct 2025 under a
//     new maintainer) now takes `@napi-rs/canvas` as a *required*
//     (non-optional) dependency — a native binary, prebuilt-per-platform
//     addon. That cuts against AGENTS.md §0.8's "reproducible builds"
//     and "still works in ten years with nobody watching" harder than a
//     pure-JS dependency does: native addons can fail to find a
//     prebuild for an unusual platform/arch/Node ABI, and there's no
//     guarantee a future Cloudflare/OpenNext build image keeps shipping
//     one that matches.
//   - `unpdf` (unjs) has zero required dependencies — `@napi-rs/canvas`
//     is an *optional* peer dep, only needed for its image-rendering
//     helpers, which this file never calls. It ships its own bundled,
//     serverless-optimized build of Mozilla's PDF.js (no native code),
//     is explicitly built for "all JavaScript runtimes... including
//     serverless environments like Cloudflare Workers," and is actively
//     maintained (routinely updated) by a known unjs maintainer. Its own
//     README describes itself as the modern alternative to pdf-parse.
//     That is a better match for §0.8 than either pdf-parse option or
//     shelling out to a system `pdftotext` binary (rejected: not
//     guaranteed present in any given build environment — local dev,
//     CI, Cloudflare — which is its own reproducibility violation).
//
// Used only here, in scripts/ingest/ — a standalone Node ETL context
// (run via `node scripts/ingest/extract-text.mjs`, never imported by
// src/). Kept out of the Next.js/Workers app bundle by living in
// devDependencies rather than dependencies.
//
// AGENTS.md §3.1 applies to derived text exactly as it applies to mocked
// records: extracted text must trace to the real source PDF, and a PDF
// with no embedded text layer (a scanned image with no OCR) is a real,
// expected outcome — extractionStatus "failed" with a stated reason,
// never fabricated or silently-empty "success."

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractText as unpdfExtractText, getDocumentProxy } from "unpdf";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "../../public");
const DOCUMENTS_DIR = path.join(PUBLIC_DIR, "documents", "agendas");

// A PDF that parses but yields no usable text (scanned image with no
// text layer, or a redacted/blank document) is not a bug — it's a
// documented, expected extraction outcome. Callers key off `.reason`
// rather than a message string.
export class ExtractionFailedError extends Error {
  constructor(reason) {
    super(`PDF text extraction failed: ${reason}`);
    this.name = "ExtractionFailedError";
    this.reason = reason;
  }
}

// Below this many non-whitespace characters, treat extraction as having
// found no real text layer rather than a "successful" empty-ish result.
// A handful of stray characters (e.g. a page number pulled from a
// vector graphic) shouldn't count as a real extraction either.
const MIN_MEANINGFUL_CHARS = 20;

/**
 * Extract plain text from a PDF document's raw bytes.
 *
 * Never throws for the expected "this PDF has no text layer" case —
 * that's reported back as a structured failure so callers can record it
 * honestly (extractionStatus: "failed", with a reason) instead of
 * crashing the whole ingest run or, worse, being tempted to paper over
 * it with fabricated text. Only genuinely unexpected errors (corrupt
 * bytes that PDF.js can't even parse) throw.
 *
 * @param {Buffer | Uint8Array} pdfBuffer
 * @param {{sourceUrl?: string}} [context]
 * @returns {Promise<{ text: string, pageCount: number }>}
 * @throws {ExtractionFailedError} if the PDF parses but has no usable text layer.
 */
export async function extractText(pdfBuffer, context = {}) {
  if (!pdfBuffer || pdfBuffer.byteLength === 0) {
    throw new ExtractionFailedError("empty file (0 bytes)");
  }

  // unpdf/pdf.js want a plain Uint8Array, not a Node Buffer (a Uint8Array
  // subclass) — pass one explicitly rather than relying on the subclass
  // relationship, which unpdf rejects with its own runtime check.
  const bytes = Buffer.isBuffer(pdfBuffer)
    ? new Uint8Array(pdfBuffer.buffer, pdfBuffer.byteOffset, pdfBuffer.byteLength)
    : pdfBuffer;

  let pdf;
  try {
    pdf = await getDocumentProxy(bytes);
  } catch (err) {
    // A document that doesn't even parse as a PDF (corrupt bytes,
    // truncated download, wrong content-type served as .pdf) is a real
    // failure, not a "no text layer" case — surface the underlying
    // PDF.js error rather than swallowing it.
    const suffix = context.sourceUrl ? ` (source: ${context.sourceUrl})` : "";
    throw new ExtractionFailedError(`could not parse PDF structure: ${err.message}${suffix}`);
  }

  const { text, totalPages } = await unpdfExtractText(pdf, { mergePages: true });
  const trimmed = (text ?? "").trim();

  if (trimmed.replace(/\s+/g, "").length < MIN_MEANINGFUL_CHARS) {
    // The common real-world cause: a scanned agenda packet with no OCR
    // text layer. Expected and honest, per AGENTS.md §3.1 — not an
    // exception, a documented outcome the caller must record as such.
    throw new ExtractionFailedError(
      "no meaningful text layer found (likely a scanned/image-only PDF with no OCR text)"
    );
  }

  return { text: trimmed, pageCount: totalPages };
}

/**
 * Run extraction for one already-archived document (see
 * ./agenda-documents.mjs's archiveDocument()) and persist the result:
 * on success, writes the extracted plain text alongside the PDF under
 * public/documents/agendas/<hash>.txt and updates the sidecar
 * provenance JSON's extractedTextRef/extractionStatus; on failure,
 * leaves extractedTextRef null and records extractionStatus: "failed"
 * with an `extractionFailureReason` — never partially-written, never
 * fabricated.
 *
 * Deterministic and re-runnable per AGENTS.md §2.2: re-running against
 * an unchanged archived PDF reproduces the same extracted text and the
 * same sidecar record.
 *
 * @param {import("../../src/lib/types.js").ArchivedDocument} record
 * @returns {Promise<import("../../src/lib/types.js").ArchivedDocument>}
 */
export async function extractAndStoreDocumentText(record) {
  if (!record || typeof record.contentHash !== "string" || !record.contentHash) {
    throw new TypeError("extractAndStoreDocumentText(record) requires a record with contentHash");
  }
  if (record.documentType === "video") {
    // Nothing wrong with the record — video documents simply have no
    // PDF text to pull. Leave extractionStatus alone rather than
    // guessing at a different pipeline (captions, transcripts) that
    // isn't in scope here.
    return record;
  }

  const pdfPath = path.join(PUBLIC_DIR, record.storedPath);
  const jsonPath = path.join(DOCUMENTS_DIR, `${record.contentHash}.json`);

  /** @type {import("../../src/lib/types.js").ArchivedDocument} */
  let updated;
  try {
    const buffer = await readFile(pdfPath);
    const { text } = await extractText(buffer, { sourceUrl: record.sourceUrl });

    const textFileName = `${record.contentHash}.txt`;
    const extractedTextRef = path.posix.join("documents", "agendas", textFileName);
    await mkdir(DOCUMENTS_DIR, { recursive: true });
    await writeFile(path.join(DOCUMENTS_DIR, textFileName), text, "utf-8");

    updated = {
      ...record,
      extractedTextRef,
      extractionStatus: "extracted",
    };
  } catch (err) {
    if (!(err instanceof ExtractionFailedError)) throw err;
    updated = {
      ...record,
      extractedTextRef: null,
      extractionStatus: "failed",
      // Not part of the ArchivedDocument type contract in
      // src/lib/types.ts, but useful for a human reviewing the sidecar
      // JSON directly — harmless extra key, never read by
      // TypeScript-typed callers.
      extractionFailureReason: err.reason,
    };
  }

  await writeFile(jsonPath, JSON.stringify(updated, null, 2));
  return updated;
}

// Run directly (`node scripts/ingest/extract-text.mjs`): walk every
// archived document's sidecar JSON under public/documents/agendas/ and
// run extraction for any still `extractionStatus: "pending"`. Skips
// documents already extracted or already recorded as failed, so re-runs
// are cheap and idempotent per AGENTS.md §2.2.
async function main() {
  const { readdir } = await import("node:fs/promises");

  let entries;
  try {
    entries = await readdir(DOCUMENTS_DIR);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      console.log(`[extract-text] ${DOCUMENTS_DIR} does not exist yet — nothing archived to extract from.`);
      return;
    }
    throw err;
  }

  const jsonFiles = entries.filter((name) => name.endsWith(".json"));
  if (jsonFiles.length === 0) {
    console.log("[extract-text] no archived document records found.");
    return;
  }

  let extracted = 0;
  let failed = 0;
  let skipped = 0;

  for (const fileName of jsonFiles) {
    const raw = await readFile(path.join(DOCUMENTS_DIR, fileName), "utf-8");
    const record = JSON.parse(raw);

    if (record.extractionStatus !== "pending") {
      skipped++;
      continue;
    }

    const result = await extractAndStoreDocumentText(record);
    if (result.extractionStatus === "extracted") {
      extracted++;
    } else if (result.extractionStatus === "failed") {
      failed++;
      console.warn(`[extract-text] ${record.contentHash}: ${result.extractionFailureReason ?? "failed"}`);
    } else {
      skipped++;
    }
  }

  console.log(`[extract-text] extracted=${extracted} failed=${failed} skipped=${skipped}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[extract-text] fatal:", err);
    process.exitCode = 1;
  });
}
