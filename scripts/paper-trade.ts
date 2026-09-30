/**
 * Autonomous PAPER trading loop.
 *   npx tsx scripts/paper-trade.ts <poolAddress> [network=solana] [cash=1000]
 * Backtests first; trades only strategies that pass every gate. State persists in .trading-state/.
 */
import fs from "fs";
import { getCandles } from "../src/lib/geckoterminal";
import { getPair } from "../src/lib/dexscreener";
import { validateAll } from "../src/trading/backtest";
import { newState, tick, equityOf, AgentState } from "../src/trading/agent";
import { getExecutor } from "../src/trading/executor";

const [pool, network = "solana", cash = "1000"] = process.argv.slice(2);
if (!pool) { console.error("usage: paper-trade.ts <pool> [network] [cash]"); process.exit(1); }
const file = `.trading-state/${network}-${pool}.json`;

async function main() {
  fs.mkdirSync(".trading-state", { recursive: true });
  const ex = getExecutor();
  let state: AgentState | null = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;

  if (!state) {
    const verdicts = validateAll(await getCandles(network, pool));
    console.table(verdicts.map((v) => ({ strategy: v.strategy, passed: v.passed, oosSharpe: v.outOfSample.sharpe.toFixed(2), oosDD: v.outOfSample.maxDrawdown.toFixed(2), why: v.failures.join("; ") })));
    const pick = verdicts.filter((v) => v.passed).sort((a, b) => b.outOfSample.sharpe - a.outOfSample.sharpe)[0];
    if (!pick) { console.log("No strategy passed validation. Not trading."); return; }
    state = newState(pick.strategy, pick.params, Number(cash));
    console.log(`Selected ${pick.strategy}`, pick.params);
  }

  for (;;) {
    try {
      const [candles, pair] = await Promise.all([getCandles(network, pool), getPair(network, pool)]);
      await tick(state, candles, pair?.liquidity?.usd ?? 0, ex);
      fs.writeFileSync(file, JSON.stringify(state, null, 2));
      const px = candles[candles.length - 2].c;
      console.log(new Date().toISOString(), `equity $${equityOf(state, px).toFixed(2)}`, state.halted ? `HALTED: ${state.halted}` : "");
      if (state.halted) { console.log("Kill switch tripped. Review before restarting."); return; }
    } catch (e) { console.error("tick failed:", (e as Error).message); }
    await new Promise((r) => setTimeout(r, 5 * 60_000));
  }
}
main();
