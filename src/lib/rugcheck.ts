/**
 * RugCheck.xyz report client (public, keyless: https://api.rugcheck.xyz/v1/tokens/{mint}/report).
 * Only the fields the filters use are typed. Read-only; sends no credentials.
 */

export interface RugCheckReport {
  mintAuthority: string | null;
  freezeAuthority: string | null;
  rugged?: boolean;
  creatorBalance?: number;
  token: { supply: number; decimals: number };
  transferFee?: { pct?: number } | null;
  token_extensions?: { permanentDelegate?: unknown } | null;
  risks?: Array<{ name: string; level: string; description?: string }>;
  topHolders?: Array<{ owner?: string; address?: string; pct: number; insider?: boolean }>;
  insiderNetworks?: Array<{ id: string; size: number; currentHolding: number; tokenAmount: number }> | null;
  markets?: Array<{ pubkey?: string; liquidityA?: string; liquidityB?: string; lp?: { lpLockedPct?: number } }>;
}

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export async function getRugCheckReport(mint: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<RugCheckReport> {
  const res = await fetchImpl(`https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report`);
  if (!res.ok) throw new Error(`RugCheck ${res.status}`);
  return (await res.json()) as RugCheckReport;
}
