# Memecoin model (what the bot assumes about how these coins move)

Memecoins are not normal tokens. They move in waves driven by who is buying and selling, and can be rugged in one block.
Edge for us is SELECTION and DISCIPLINE (which waves to join, when to leave), not raw speed: snipers and MEV bots
co-located with validators win the millisecond game, and a bot polling a rate-limited API cannot beat them there.
A rug that happens inside one block cannot be escaped by any polling bot; the defences are the entry gates, small size,
and position limits. Paper fills reproduce this: if the pool is gone, the sell fails (`no_route`).

## The wave
1. **Launch / snipe**: bundlers, snipers, dev wallets. Gates reject tokens still dominated by them.
2. **First leg (vertical)**: price runs, volume spikes. The bot does NOT chase (`vertical` phase = wait).
3. **Pullback**: early buyers take profit. If fresh buyers absorb it (holds >= ~35% of the wave, buy share >= 45%,
   volume alive) it is a `healthy_pullback`. Entry only when buyers visibly return (1m buy share >= 55%, green candle, activity accelerating).
4. **Second leg or failure**: either a new high (take profit in tranches, trail the rest) or `distribution`
   (flat at highs while sellers dominate), `breakdown` (>80% of the wave given back) or `dead` (volume gone).

## Signals used (all from GMGN, see `dynamics.mjs`, `bot.mjs`)
| Signal | Source | Use |
|---|---|---|
| Smart money / KOL buys clustering (>=3 wallets, 1h) | `track smartmoney`, `track kol` | candidate |
| Smart money / KOL SELLING a token we hold (>=2 since entry) | same feeds | exit `smart_money_selling` |
| Wave phase from 60 x 1m candles (gmgn-kline-pattern formulas + retrace) | `market kline` | entry timing, refuse bad phases |
| Order flow: buy/sell USD volume 1m/5m/1h, volume acceleration | `token info` price block | entry confirm, exit `sell_wave` |
| Dev wallet balance drop >10% | `token info` dev | exit `dev_sold` |
| Liquidity down >30% since entry (LP pull precursor) | `token info` liquidity | exit `liquidity_pulled` |
| Source wallet sold (mirror) | `portfolio activity` | exit `mirror_exit` |
| No move after STALE_MIN (45m) | price | exit `stale` (memecoin momentum decays fast) |

Speeds: open positions checked every 15 s (`POS_POLL_S`), scanning every 60 s (`POLL_S`). A client-side leaky bucket keeps
calls inside GMGN's plan limit (`GMGN_TIER=free|plus|pro`; free = 5 weight units/s), so the bot never trips 429 bans.

## Research loop
Every signal, entry and exit is journaled with its phase, candle features and order flow. `stats.mjs` adds
`byEntryPhase`, `avgPeakCapture` (how much of the best price we kept) and `klineErrors`. Rejected AND exited tokens are
followed up at +1h/+4h, which grades each gate and each exit rule. Thresholds in `dynamics.mjs` are starting points
to be tuned from this data, one change per run.
