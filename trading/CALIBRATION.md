# Calibration brief: running a $100 paper book (for the server operator)

## 0. Version check first
Time stop, liquidity-drop exit, sell-wave, smart-money-selling and dev-sold exits already exist since `e576e17`.
If the server lacks them, it is running older code. Load the latest branch commit, reapply local patches, send the patches
back for merging, `reset.sh`, restart. The BOT START line shows the code hash; report it.

## 1. Risk policy for $100 (memecoin-specific)
- **Position size = maximum loss.** Rugs gap straight through stops, so "risk 1-2% via a -35% stop" understates real risk.
  Treat each position as fully losable: `ORDER_USD=10` (10% of book) is the ceiling, not the floor.
- **Do not go smaller than $10.** Fixed costs (tip + fees) dominate small orders: at $5, round-trip friction exceeds 10%.
- `MAX_OPEN=3`, `DAILY_LOSS_USD=20`, `WEEKLY_LOSS_USD=30` (new). Kill switch: equity <= $60 -> stop and review, no restart without a written reason.
- No averaging down, no re-entry on a token after any exit (already enforced in code).

## 2. The biggest lever at $100 is friction, not entries
Measured friction ~$0.69 per $10 round trip (~7%) = tip $0.15 x 2 + platform fee 1% x 2 + impact.
Model the route you will actually use live, honestly:
- Live via Jupiter directly: no 1% bot fee -> paper `FEE_PCT=0`. Via GMGN/a Telegram bot: keep `FEE_PCT=1`.
- Priority fee: measured auto ~0.0009 SOL, MEV-protected 0.001 SOL (~$0.12): `TIP_USD=0.12`. Keep MEV protection on (sandwiches are real).
- Only trade pools where a $10 quote shows < 2% impact (liquidity >= ~$30k does this).
Going 7% -> ~3.5% friction roughly halves the edge a strategy needs to break even.

## 3. Get data faster: shadow cohorts (new, on by default)
1 signal in 6h means 100 trades takes weeks. Now every token that fails exactly ONE relaxable gate (liquidity >= $10k) is
paper-traded as `shadow:<gate>` with the same entry/exit logic and cost model. Shadow trades never touch the $100 book,
daily/weekly limits or alerts. `stats.mjs` -> `byStrategy` compares `cluster` vs each `shadow:<gate>`.
Knobs: `SHADOW_GATES`, `SHADOW_MAX_OPEN=8`, `SHADOW_MIN_LIQ=10000`. Never relaxed: honeypot, can't sell, tax, mint/freeze.

## 4. Calibrate gates from the data you already have
`node trading/analyze.mjs 1` and `node trading/analyze.mjs 4`: outcomes of tokens that failed ONLY one gate, buy-and-hold,
after a 7% cost, with gains capped at 5x so one 37x doesn't fake an edge. Read with the shadow results:
- `only:<gate>` far below ALL -> the gate protects you, keep it.
- `only:<gate>` near/above zero with n >= 30 AND its shadow cohort is profitable after costs over >= 30 trades -> relax that one gate, new run.
- The big misses (37x, 35x, 21x, 12x) are hindsight. Judge a gate by its cohort, never by its best miss.

## 5. Data quality (new)
- Upward price jumps > 3x in one tick are held as `suspect_tick` until the next tick confirms them; they can't set a peak or trigger a
  take-profit alone. Downward moves are never ignored (that is what rugs look like); sells are always priced from real quotes.
- Jupiter quote calls back off on 429 instead of hammering. A failed buy keeps the token on the watchlist and retries next cycle
  if the entry trigger still holds.

## 6. Pass/fail (unchanged, set before looking)
>= 100 closed REAL trades, >= 3 weeks, positive after costs AND with costs doubled, profit factor >= 1.5, not carried by one trade,
drawdown < 30%. Shadow cohorts inform settings; they never count toward the pass bar. Then a $10-20 live pilot, every order approved.

## 7. Report format (daily, not every 30 min)
`node trading/stats.mjs` (equity, trades, byStrategy incl. shadows, byReason, byEntryPhase, avgPeakCapture, klineErrors, runs)
+ `node trading/analyze.mjs 1` + count of `suspect_tick` + any `cycle error` lines. No setting changes mid-run.

## 8. Funnel fix (after 30h, 1,617 rejects, 0 real signals)
Diagnosis: the smart-money feed mostly surfaces tokens minutes after launch, when they are bonding-curve tokens with low
liquidity and heavy bots/bundlers. Two problems followed:
- **Banned at birth.** A token failing `too_new` AND anything else was rejected forever, judged on launch-time stats.
  Now any `too_new` token is DEFERRED (`deferred` event) and re-evaluated with fresh data once it reaches minimum age.
- **Wrong universe.** New source `trending`: GMGN rank filtered server-side by our own gates (liquidity, >=3 smart holders,
  age 15m-6h, bundler rate, top-10 share, dev holdings). Candidates already sit where the gates allow; full gates still run.
  `SOURCES=smart,trending` (default). Trending trades are labelled `trending` in byStrategy, separate from `cluster`.
`node trading/analyze.mjs` now prints the funnel (rejects, signals and deferrals by source, entries, closes).
This is a strategy change: new run (`reset.sh`), new code hash. Gates and exits are unchanged.

## 9. Four-week plan (paid GMGN plan = 4 weeks): find the edge with replay, confirm forward, then trade
- **Replay first (`backtest.mjs`).** Every token the bot has seen is replayed on GMGN 1m candles (cached in `trading/cache/`)
  under three entries (`immediate`, `pullback15`, `wave`) x the live exit ladder, grouped by cohort (`pass_all`, `only:<gate>`,
  `fail_N`) and by source. Run it with a smaller rate share so the live paper bot keeps working:
  `GMGN_TIER=plus COST_PCT=5 node trading/backtest.mjs 3000`
- **Edge candidate:** trades >= 30, avg% > 0, avg_wo_best% > 0, PF >= 1.3 at COST_PCT=5, and still > 0 at COST_PCT=8.
- Week 1: replay daily on everything collected; pick at most ONE change (source / gate / entry) that the replay supports.
- Week 2: run that config forward in paper (new run, new hash) to confirm out-of-sample: >= 30 closed trades.
- Week 3: if the edge gate passes -> owner arms live Phase 1 ($10 trades). If not, iterate once more.
- Week 4: Phase 2 only if live confirms. When the plan expires the bot still works on the free tier (`GMGN_TIER=free`, slower).
Replay limits: candles only (no order-flow, dev or liquidity exits), worst-case intra-candle order. It ranks ideas; paper confirms them.
