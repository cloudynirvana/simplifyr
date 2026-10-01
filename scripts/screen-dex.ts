/**
 * One-shot HTTP screen (works without websockets): newest DexScreener Solana profile/boost tokens ->
 * market-data filters -> RugCheck gate. Prints survivors; places no orders.
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/screen-dex.ts     (the env var is only needed behind an HTTPS proxy)
 * NOTE: profile/boost feeds are paid promotion, so this sample is biased toward advertised tokens.
 */
import { makeRugCheckGate } from "../src/trading/rugcheckGate";

const get = async (p: string) => { const r = await fetch("https://api.dexscreener.com" + p); if (!r.ok) throw new Error(`${p} ${r.status}`); return r.json() as Promise<any>; };

async function main() {
  const lists = await Promise.all(["/token-profiles/latest/v1", "/token-boosts/latest/v1", "/token-boosts/top/v1"].map((p) => get(p).catch(() => [])));
  const addrs = [...new Set(lists.flat().filter((x: any) => x.chainId === "solana").map((x: any) => x.tokenAddress))] as string[];
  const pairs: any[] = [];
  for (let i = 0; i < addrs.length; i += 30) pairs.push(...(await get(`/tokens/v1/solana/${addrs.slice(i, i + 30).join(",")}`).catch(() => [])));
  const best = new Map<string, any>();
  for (const p of pairs) { const k = p.baseToken.address; if (!best.has(k) || (p.liquidity?.usd ?? 0) > (best.get(k).liquidity?.usd ?? 0)) best.set(k, p); }

  const now = Date.now(), survivors: any[] = [], tally: Record<string, number> = {};
  for (const p of best.values()) {
    const liq = p.liquidity?.usd ?? 0, vol = p.volume?.h24 ?? 0, ageH = p.pairCreatedAt ? (now - p.pairCreatedAt) / 36e5 : NaN, mc = p.marketCap ?? p.fdv ?? 0;
    const h1 = p.txns?.h1 ?? { buys: 0, sells: 0 }, m5 = p.txns?.m5 ?? { buys: 0, sells: 0 };
    const f: string[] = [];
    if (!(liq >= 25_000)) f.push("liq<25k");
    if (!(ageH >= 0.5)) f.push("age<30m"); else if (ageH > 48) f.push("age>48h");
    if (!(mc >= 50_000)) f.push("mcap<50k");
    if (liq > 0 && vol / liq > 15) f.push("vol/liq>15");
    if (h1.sells === 0 && h1.buys >= 20) f.push("no sells");
    if (m5.buys > 0 && m5.sells / m5.buys > 1.5) f.push("sell pressure");
    if ((p.priceChange?.h1 ?? 0) > 300) f.push("late +300%");
    if (h1.buys + h1.sells < 100) f.push("thin flow");
    f.forEach((x) => (tally[x] = (tally[x] ?? 0) + 1));
    if (!f.length) survivors.push({ sym: p.baseToken.symbol, dex: p.dexId, mint: p.baseToken.address, ageH: +ageH.toFixed(1), liq: Math.round(liq), mcap: Math.round(mc), h1: p.priceChange?.h1, buys: h1.buys, sells: h1.sells, url: p.url });
  }
  console.log(`screened ${best.size} tokens | passed market-data filters: ${survivors.length} | fail reasons:`, tally);

  const gate = makeRugCheckGate();
  for (const s of survivors) {
    const rc = await gate(s.mint);
    console.log(`${rc.pass ? "PASS" : "FAIL"} ${s.sym} (${s.dex}) age ${s.ageH}h liq $${s.liq} mcap $${s.mcap} h1 ${s.h1}% buys/sells ${s.buys}/${s.sells}\n     ${s.mint}\n     ${rc.pass ? "RugCheck gate: no red flags found" : rc.failures.join(" | ")}`);
  }
}
main().catch((e) => console.log("ERR", e.message));
