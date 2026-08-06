#!/usr/bin/env node
// scripts/ingest/agenda-documents.mjs
//
// Phase 6 (FEATURES.md — "Meeting documents & agenda ingestion"): fetch
// and store meeting documents with a content hash under public/, per
// AGENTS.md §3.3 Document Retention ("Mirror source documents under
// public/ with content hashes where licensing permits. A citation that
// 404s in eighteen months is not a citation.").
//
// This is a LIBRARY module, not a standalone crawler — it never discovers
// URLs on its own. Other ingest scripts (a future Legistar /events,
// /matters fetcher per AGENTS.md §3.2) find agenda/minutes/video URLs
// already present in their own upstream API payloads and pass one of
// those URLs to archiveDocument() here. That keeps politeness/paging
// concerns (AGENTS.md §2.2 Good-Citizen Fetcher) owned by the script that
// actually walks an upstream API, while this module owns exactly one
// thing: mirror one already-known document URL, once, with a hash.
//
// Dependency-light per AGENTS.md §0.8: only Node built-ins (global
// fetch, node:crypto, node:fs, node:path). No PDF parsing here — see
// ./extract-text.mjs for that step and why it's stubbed.
//
// @typedef {import("../../src/lib/types.js").ArchivedDocument} ArchivedDocumentRecord

import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "../../public");
const DOCUMENTS_DIR = path.join(PUBLIC_DIR, "documents", "agendas");

// Descriptive User-Agent + contact per AGENTS.md §2.2 Good-Citizen
// Fetcher. Update the contact if the maintainer of record changes.
const USER_AGENT = "wealldobettermn-agenda-archiver/0.1 (+https://github.com/ngabantudev/wealldobettermn)";

const EXTENSION_BY_CONTENT_TYPE = {
  "application/pdf": "pdf",
  "text/html": "html",
  "video/mp4": "mp4",
  "text/plain": "txt",
};

function extensionFor(url, contentType) {
  const fromUrl = path.extname(new URL(url).pathname).replace(/^\./, "");
  if (fromUrl && /^[a-z0-9]{1,5}$/i.test(fromUrl)) return fromUrl.toLowerCase();
  if (contentType) {
    const base = contentType.split(";")[0].trim().toLowerCase();
    if (EXTENSION_BY_CONTENT_TYPE[base]) return EXTENSION_BY_CONTENT_TYPE[base];
  }
  return "bin";
}

/**
 * Fetch a single agenda/minutes/video URL already present in an ingested
 * upstream payload and mirror it under public/documents/agendas/, keyed
 * by the sha256 of its bytes, alongside a sidecar provenance JSON record
 * of the same shape as src/lib/types.ts's ArchivedDocument.
 *
 * Deterministic per AGENTS.md §2.2: re-archiving an unchanged URL
 * produces the same hash and rewrites the same path with identical
 * bytes. A *changed* upstream document (an amended agenda) produces a
 * different hash and a different file — the caller is responsible for
 * recording that as a new AgendaItemSnapshot (src/lib/types.ts) rather
 * than overwriting the pointer to the old one; this function only ever
 * archives, it never decides what a change means to the domain model.
 *
 * @param {string} url - source URL, already discovered by another ingest script.
 * @param {{documentType?: "agenda"|"minutes"|"video"|"other", sourceAgency?: string}} [options]
 * @returns {Promise<ArchivedDocumentRecord>}
 */
export async function archiveDocument(url, options = {}) {
  if (!url || typeof url !== "string") {
    throw new TypeError("archiveDocument(url) requires a non-empty URL string");
  }

  const documentType = options.documentType ?? "other";
  const fetchedAt = new Date().toISOString();

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`archiveDocument: ${url} responded ${res.status} ${res.statusText}`);
  }
  const contentType = res.headers.get("content-type");
  const buffer = Buffer.from(await res.arrayBuffer());

  const contentHash = createHash("sha256").update(buffer).digest("hex");
  const ext = extensionFor(url, contentType);
  const fileName = `${contentHash}.${ext}`;
  // Web-facing path, relative to public/ — always forward slashes
  // regardless of the host OS, since this ends up in a URL/JSON contract.
  const storedPath = path.posix.join("documents", "agendas", fileName);
  const absolutePath = path.join(DOCUMENTS_DIR, fileName);

  await mkdir(DOCUMENTS_DIR, { recursive: true });
  await writeFile(absolutePath, buffer);

  /** @type {ArchivedDocumentRecord} */
  const record = {
    sourceUrl: url,
    documentType,
    sourceAgency: options.sourceAgency ?? null,
    fetchedAt,
    contentHash,
    storedPath,
    byteLength: buffer.byteLength,
    contentType: contentType ?? null,
    // Extraction is a separate step (extract-text.mjs) that a caller
    // runs afterward — never populated here, never guessed at.
    extractedTextRef: null,
    extractionStatus: "pending",
  };

  await writeFile(path.join(DOCUMENTS_DIR, `${contentHash}.json`), JSON.stringify(record, null, 2));

  return record;
}

/**
 * Read back a previously archived document's provenance record by its
 * content hash, without re-fetching. Returns null if never archived.
 * Lets a caller check "have I already mirrored this exact document?"
 * before hitting the network again.
 *
 * @param {string} contentHash
 * @returns {Promise<ArchivedDocumentRecord | null>}
 */
export async function readArchivedRecord(contentHash) {
  try {
    const raw = await readFile(path.join(DOCUMENTS_DIR, `${contentHash}.json`), "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}
