// Realistic paper fill. Paper trading flatters results unless it charges what live charges:
// latency (price moves while your tx lands), slippage (base + pool impact), fees + tip, failed txs.
// All knobs are deliberately pessimistic by default; tune them to your real fills when you go live.
import { gmgn } from './lib.mjs';
const e = (k, d) => Number(process.env[k] ?? d);
export const P = { latencyS: e('LATENCY_S', 8), feePct: e('FEE_PCT', 1), tipUsd: e('TIP_USD', 0.5),
                   baseSlipPct: e('BASE_SLIP_PCT', 1), failRate: e('FAIL_RATE', 0.05) };
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function paperFill(order, chain) {
  await sleep(P.latencyS * 1000);
  if (Math.random() < P.failRate) return { ok: false, reason: 'tx_failed' };
  const info = gmgn(['token', 'info', '--chain', chain, '--address', order.token]);
  const mid = Number(info.price?.price), liq = Number(info.liquidity);
  if (!(mid > 0)) return { ok: false, reason: 'no_price' };
  const notional = order.side === 'buy' ? order.usd : order.units * mid;
  const slip = P.baseSlipPct / 100 + Math.min(0.95, (2 * notional) / Math.max(liq, 1)); // constant-product impact
  const fee = notional * P.feePct / 100 + P.tipUsd;
  if (order.side === 'buy') {
    const fillPx = mid * (1 + slip), units = (notional - fee) / fillPx;
    return { ok: true, mode: 'paper', fillPx, mid, units, usd: notional, costUsd: fee + units * (fillPx - mid),
             slipPct: slip * 100, latencyS: P.latencyS };
  }
  const fillPx = mid * (1 - slip), usd = Math.max(0, order.units * fillPx - fee);
  return { ok: true, mode: 'paper', fillPx, mid, units: order.units, usd, costUsd: fee + order.units * (mid - fillPx),
           slipPct: slip * 100, latencyS: P.latencyS };
}
