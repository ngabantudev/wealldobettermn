// src/lib/dohQuery.ts
//
// Shared low-level DNS-over-HTTPS request/parse plumbing for
// serverFetch.ts's SSRF pre-check and domainSafety.ts's malware/phishing
// blocklist check — both were hand-rolling identical request-building
// and JSON-parsing boilerplate against two different Cloudflare
// resolvers. Deliberately NOT a shared "is this hostname safe" decision:
// the two callers query different resolvers (plain 1.1.1.1 vs the
// security-filtered 1.1.1.1-for-Families) for different reasons and
// interpret the response differently — only the "build the request,
// parse the response" plumbing is genuinely common between them.

export interface DohAnswer {
  type: number;
  data: string;
}

export interface DohResult {
  // DNS RCODE — 0 = NOERROR, 3 = NXDOMAIN. -1 is not a real RCODE; it
  // means the resolver's JSON response omitted the Status field
  // entirely (malformed/non-standard response) — treated as a distinct,
  // never-silently-NOERROR case so a caller's fail-closed check
  // (`status !== 0`) catches it too, rather than defaulting a missing
  // field to "resolved safely." A live bug caught this exact default
  // during code review: `body.Status ?? 0` was fail-OPEN on a malformed
  // response, contradicting every caller's own documented "fail closed"
  // posture.
  status: number;
  answers: DohAnswer[];
}

export type DohRecordType = "A" | "AAAA";

/**
 * Queries a DNS-over-HTTPS resolver for a hostname's A or AAAA record.
 * Returns null on any error (network failure, non-OK response,
 * unparseable JSON) — every caller here treats null as "can't confirm
 * this is safe," but that fail-closed decision belongs to the caller,
 * not this shared helper.
 */
export async function queryDoh(
  dohUrl: string,
  hostname: string,
  fetchImpl: typeof fetch,
  recordType: DohRecordType = "A",
): Promise<DohResult | null> {
  try {
    const res = await fetchImpl(`${dohUrl}?name=${encodeURIComponent(hostname)}&type=${recordType}`, {
      headers: { accept: "application/dns-json" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { Status?: number; Answer?: DohAnswer[] };
    return { status: body.Status ?? -1, answers: body.Answer ?? [] };
  } catch {
    return null;
  }
}
