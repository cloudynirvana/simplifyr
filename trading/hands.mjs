#!/usr/bin/env node
// HANDS: execution layer. PAPER ONLY. Live trading is hard-disabled in code: no env var, flag or argument can
// enable it. Going live requires editing LIVE_ENABLED below, writing a live executor, and a code review.
import { journal } from './lib.mjs';
import { paperFill } from './paper.mjs';

const LIVE_ENABLED = false;
const MAX_USD = Number(process.env.MAX_ORDER_USD ?? 25), CHAIN = process.env.CHAIN ?? 'sol';

export async function execute(order) {
  if (LIVE_ENABLED) throw new Error('live executor not implemented');
  if (order.side === 'buy' && order.usd > MAX_USD) throw new Error(`order $${order.usd} exceeds MAX_ORDER_USD=${MAX_USD}`);
  const res = await paperFill(order, CHAIN);
  journal({ event: 'fill', side: order.side, token: order.token, decisionPx: order.px, ...res, mode: 'paper' });
  return res;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const [side, token, amt] = process.argv.slice(2);
  console.log(await execute(side === 'buy' ? { side, token, usd: +amt } : { side, token, units: +amt }));
}
