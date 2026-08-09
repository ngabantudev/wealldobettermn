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
  status: number; // DNS RCODE — 0 = NOERROR, 3 = NXDOMAIN
  answers: DohAnswer[];
}

/**
 * Queries a DNS-over-HTTPS resolver for a hostname's A record. Returns
 * null on any error (network failure, non-OK response, unparseable
 * JSON) — every caller here treats null as "can't confirm this is
 * safe," but that fail-closed decision belongs to the caller, not this
 * shared helper.
 */
export async function queryDoh(dohUrl: string, hostname: string, fetchImpl: typeof fetch): Promise<DohResult | null> {
  try {
    const res = await fetchImpl(`${dohUrl}?name=${encodeURIComponent(hostname)}&type=A`, {
      headers: { accept: "application/dns-json" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { Status?: number; Answer?: DohAnswer[] };
    return { status: body.Status ?? 0, answers: body.Answer ?? [] };
  } catch {
    return null;
  }
}
