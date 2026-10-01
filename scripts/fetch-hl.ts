/**
 * Download + cache Hyperliquid daily candles and funding for the top-N perps by volume.
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/fetch-hl.ts [topN=20] [startISO=2023-06-01]
 * Cache: .trading-state/hl/<COIN>.json  (gitignored).
 */
import fs from "fs";
import { getMarkets, getCandles, getFunding } from "../src/lib/hyperliquid";

const flag = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const pos = process.argv.slice(2).filter((a, i, arr) => !a.startsWith("--") && !(i > 0 && arr[i - 1].startsWith("--")));
const topN = Number(pos[0] ?? 20), start = Date.parse(pos[1] ?? "2023-06-01");
const only = flag("--coins")?.split(","), dir = flag("--dir") ?? ".trading-state/hl";
async function main() {
  fs.mkdirSync(dir, { recursive: true });
  const all = await getMarkets();
  const markets = only ? all.filter((m) => only.includes(m.coin)) : all.filter((m) => !m.coin.startsWith("k") && !m.coin.includes(":")).slice(0, topN);
  fs.writeFileSync(`${dir}/_markets.json`, JSON.stringify(markets));
  let i = 0;
  const worker = async () => {
    while (i < markets.length) {
      const m = markets[i++];
      if (fs.existsSync(`${dir}/${m.coin}.json`) && !process.argv.includes("--force")) continue; // cached
      try {
        const [candles, funding] = await Promise.all([getCandles(m.coin, "1d", start), getFunding(m.coin, start)]);
        fs.writeFileSync(`${dir}/${m.coin}.json`, JSON.stringify({ coin: m.coin, candles, funding }));
        console.log(`${m.coin.padEnd(6)} candles ${candles.length}  funding ${funding.length}  from ${candles[0] ? new Date(candles[0].t).toISOString().slice(0, 10) : "-"}`);
      } catch (e) { console.log(`${m.coin} FAILED: ${(e as Error).message}`); }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}
main();
