// Paper fill priced from a REAL executable quote (Jupiter public quote API: no key, no wallet), taken after
// simulated latency. The quote already includes AMM fee + price impact for our exact size. On top we charge
// the trading-bot platform fee + priority tip and a random tx-failure rate. If no route exists (pool pulled,
// honeypot), the fill fails, exactly as a real sell would. QUOTE_SOURCE=model falls back to the old estimate.
// TIP_USD default 0.15 = measured SOL priority fee (gmgn-cli gas-price: auto ~0.0009 SOL, MEV-protected 0.001 SOL) + margin.
import { gmgn } from './lib.mjs';
const e = (k, d) => Number(process.env[k] ?? d);
export const P = { latencyS: e('LATENCY_S', 8), feePct: e('FEE_PCT', 1), tipUsd: e('TIP_USD', 0.15),
                   baseSlipPct: e('BASE_SLIP_PCT', 1), failRate: e('FAIL_RATE', 0.05), slippageBps: e('SLIPPAGE_BPS', 3000) };
const SOL = 'So11111111111111111111111111111111111111112';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const int = n => BigInt(Math.floor(n)).toString();

async function jupQuote(inMint, outMint, amount) {
  const u = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${inMint}&outputMint=${outMint}&amount=${amount}&slippageBps=${P.slippageBps}`;
  for (let k = 0; ; k++) {                                     // free Jupiter API throttles: back off, don't hammer
    const r = await fetch(u); const d = await r.json().catch(() => ({}));
    if (r.status === 429 && k < 3) { await sleep(1500 * 2 ** k); continue; }
    if (!r.ok || !d.outAmount) throw new Error(d.error ?? `quote http ${r.status}`);
    return d;
  }
}
async function solUsd() {
  const d = await (await fetch(`https://lite-api.jup.ag/price/v3?ids=${SOL}`)).json();
  return Number(d[SOL].usdPrice);
}

export async function paperFill(order, chain) {
  await sleep(P.latencyS * 1000);
  if (Math.random() < P.failRate) return { ok: false, reason: 'tx_failed' };
  if (chain !== 'sol' || process.env.QUOTE_SOURCE === 'model') return modelFill(order, chain);
  const info = gmgn(['token', 'info', '--chain', chain, '--address', order.token], { ttlMs: 0 }); // fresh price after latency
  const mid = Number(info.price?.price), dec = Number(info.decimals), sol = await solUsd();
  try {
    if (order.side === 'buy') {
      const fee = order.usd * P.feePct / 100 + P.tipUsd;              // platform fee + tip come out of the spend
      const q = await jupQuote(SOL, order.token, int((order.usd - fee) / sol * 1e9));
      const units = Number(q.outAmount) / 10 ** dec, fillPx = (order.usd - fee) / units;
      return { ok: true, mode: 'paper', src: 'jupiter', fillPx, mid, units, usd: order.usd,
               costUsd: fee + Math.max(0, units * (fillPx - mid)), slipPct: (fillPx / mid - 1) * 100,
               impactPct: Number(q.priceImpactPct) * 100, latencyS: P.latencyS };
    }
    const q = await jupQuote(order.token, SOL, int(order.units * 10 ** dec));
    const gross = Number(q.outAmount) / 1e9 * sol, fee = gross * P.feePct / 100 + P.tipUsd;
    const usd = Math.max(0, gross - fee), fillPx = gross / order.units;
    return { ok: true, mode: 'paper', src: 'jupiter', fillPx, mid, units: order.units, usd,
             costUsd: fee + Math.max(0, order.units * (mid - fillPx)), slipPct: (1 - fillPx / mid) * 100,
             impactPct: Number(q.priceImpactPct) * 100, latencyS: P.latencyS };
  } catch (err) {
    return { ok: false, reason: 'no_route: ' + err.message };          // can't buy/sell = real-world outcome
  }
}

function modelFill(order, chain) {
  const info = gmgn(['token', 'info', '--chain', chain, '--address', order.token]);
  const mid = Number(info.price?.price), liq = Number(info.liquidity);
  if (!(mid > 0)) return { ok: false, reason: 'no_price' };
  const notional = order.side === 'buy' ? order.usd : order.units * mid;
  const slip = P.baseSlipPct / 100 + Math.min(0.95, (2 * notional) / Math.max(liq, 1));
  const fee = notional * P.feePct / 100 + P.tipUsd;
  if (order.side === 'buy') {
    const fillPx = mid * (1 + slip), units = (notional - fee) / fillPx;
    return { ok: true, mode: 'paper', src: 'model', fillPx, mid, units, usd: notional, costUsd: fee + units * (fillPx - mid), slipPct: slip * 100, latencyS: P.latencyS };
  }
  const fillPx = mid * (1 - slip), usd = Math.max(0, order.units * fillPx - fee);
  return { ok: true, mode: 'paper', src: 'model', fillPx, mid, units: order.units, usd, costUsd: fee + order.units * (mid - fillPx), slipPct: slip * 100, latencyS: P.latencyS };
}
