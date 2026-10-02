# Handoff: PumpPortal / memecoin trading system

Branch: `claude/dexscreener-jev-api-on69u1` (all work is committed and pushed).
Written 2026-10-01. Read section 1 first.

---

## 1. Bottom line (read this first)

- **Nothing built so far has shown a profitable edge.** Every strategy tested failed its quality gates. That is a normal, honest result and the system is designed to say "no trade" most of the time.
- **What exists is a research and risk platform, not a money machine.** It can screen tokens, veto rugs, backtest with realistic costs, size positions, paper trade, and review its own calibration. It cannot yet trade live, and that is deliberate.
- **"Passive income" is the wrong frame.** Treat all capital as experiment money you can lose completely. The correct goal for the next 4-8 weeks is to *find out whether an edge exists*, cheaply, not to compound.
- **Profit accumulation comes last and is mechanical:** scale only after a measured, positive, after-cost track record; withdraw profits on a schedule; never add capital to chase losses (section 8).

---

## 2. Verified results so far

| Test | Result |
|---|---|
| Solana SOL/USDC hourly backtest (3 simple strategies, 0.8%/side costs, out-of-sample) | All 3 failed. OOS returns -9.2%, -4.0%, -3.2% vs buy&hold +12.3%. |
| pump.fun-style market screen, 59 newest DexScreener Solana profile/boost tokens | 57 failed market-data filters; 2 passed. |
| RugCheck + insider-network gate on those 2 (HI, BSI) | Both rejected: linked insider wallets held 8.1% / 8.3% combined, 6-wallet identical-balance cluster (HI), creator rug history (BSI). RugCheck's own score for HI was a clean 1. |
| Hyperliquid perps tournament, top-20 markets, 20 configs, walk-forward + untouched 180-day holdout + 2x-cost stress + deflated Sharpe | No strategy passed. Best: cross-sectional momentum WF Sharpe 0.58 (gate 1.0). |
| Hyperliquid memecoin-perp tournament, 11 coins, 15 bps slippage | No strategy passed. Equal-weight long basket lost 59% over the OOS window; DOGE alone -15%. |
| Machinery tests | 0 lookahead leaks across all configs; cost and funding signs correct; deflated Sharpe separates noise from planted edge; pure noise passes nothing. |

Interpretation: simple public strategies do not beat costs here. Memecoins decay on average. The filters correctly reject most tokens, including ones a headline safety score called clean.

---

## 3. Architecture

```
PumpPortal websocket ──► PumpTracker ──► market screen ──► RugCheck gate ──► Jev gate ──► sizing ──► Executor
 (new tokens + trades)   (per-token         (liquidity,        (authorities,      (typed        (quarter    (PAPER now;
                          holders, dev,      flow, age,         insider nets,      judgments;    Kelly, risk  Jupiter-quote
                          flow, fees est.)   late-entry)        bundles, LP lock)  code owns     limits)      fills)
                                                                                    thresholds)
                       ▲                                                                              │
                       └────────────── position manager (NOT BUILT): watches held token, rug-exit ◄───────┘
Risk layer (src/trading/risk.ts) sits above everything: max drawdown 15%, daily loss, stop-loss, position caps, kill switch.
Nightly review (calibration, Brier) proposes changes; a human approves. Nothing self-modifies.
```

Principles that must be preserved:
1. **Code owns thresholds, sizes and side effects.** The judgment model (Jev) only supplies typed, calibrated answers. It can never override the risk layer.
2. **Fail closed.** Any error (RugCheck, Jev, quote) means no entry.
3. **Paper by default.** `TRADING_MODE=live` throws. Live execution is intentionally unimplemented.
4. **Hard filters are vetoes, not scores.** A token failing any filter is never shown to the model.

---

## 4. What is built (file map and status)

Status key: **T** = tested with mocks/synthetic data, **L** = verified against live data, **U** = unverified assumption inside.

### Pump.fun / Solana (the PumpPortal path)
| File | Purpose | Status |
|---|---|---|
| `src/lib/pumpportal.ts` | Read-only websocket feed (new tokens, per-token trades), reconnect + backoff, queued subscriptions | T, L. **Verified live (2026-10-01): the `create` event fields match; the websocket DOES work from the sandbox with `NODE_USE_ENV_PROXY=1`. The per-token trade stream is NOT keyless: it needs an API key whose wallet holds >= 0.02 SOL.** Trade-event shape still unverified. |
| `src/trading/pumpTracker.ts` | Builds filter inputs from events: age, buy/sell counts, unique traders, holders, dev holdings/sells, price change | T; **U**: supply=1B, fees ~1% of volume, liquidity = virtual SOL - 30, authorities *assumed* revoked |
| `src/trading/pumpFilters.ts` | Hard filters + execution caps (slippage <=15%, impact <=5%, tip <=2% of order) | T |
| `src/trading/screenFilters.ts` | Market-data screen for DexScreener pairs, incl. lopsided-flow rule (buys/sells > 8) | T, L |
| `src/lib/rugcheck.ts`, `src/trading/rugcheckFilter.ts`, `src/trading/rugcheckGate.ts` | RugCheck.xyz report -> veto (insider networks >5% combined, creator >5%, LP lock <90%, top holder >5%, bundle cluster, authorities, danger risks); cached, 3 s spacing, fails closed | T, L |
| `src/lib/dexscreener.ts` | Search, pair, token-pairs | L |
| `src/lib/jupiter.ts`, `src/trading/jupiterPaper.ts` | Read-only quote client; paper executor that fills at real quotes and refuses >5% impact | T; **U**: endpoints/fields from memory |
| `scripts/pump-scan.ts`, `src/trading/discovery.ts`, `src/trading/discoveryScan.ts` | **Discovery + HTTP scanner (no paid key):** free PumpPortal new-token stream -> wait for 30m/1h/2h/4h/8h checkpoints -> DexScreener market screen (batched 30 mints/call) -> RugCheck gate (holders, insider networks, authorities, LP lock; fails closed) -> every market-passer logged to `.trading-state/pump-candidates.jsonl` with its RugCheck verdict. Writes `heartbeat.json`. | T (mock tests incl. 429 retry); L (live: 166 tokens checked against DexScreener, 0 errors; all failed filters as expected at <30 min age). Never yet produced a real candidate. |
| `scripts/screen-dex.ts` | One-shot HTTP screen (works anywhere): DexScreener feeds -> market filters -> RugCheck | L |
| `scripts/trade-sheet.ts <mint>` | Runs every filter on one mint; writes a filled manual entry/exit sheet only if it passes (`--demo` previews format) | T, L |

### Decision layer / agent
| File | Purpose | Status |
|---|---|---|
| `src/trading/state.ts` | Causal numeric snapshot (<400 tokens) for the judgment model | T (causality verified) |
| `src/trading/jevPolicy.ts` | Gate policy: setup quality >=2, direction confidence >0.80 & long, toxic flow <=0.5, risk_state safe, escalate on crisis or confidence <0.6, quarter-Kelly sizing capped 25% | T; payoff ratio 1.5 is a **placeholder** |
| `src/trading/agent.ts` | Tick loop: signal -> Jev gate -> risk -> execute; fail closed; decision log | T |
| `src/trading/risk.ts` | Limits: position 25%, stop 12%, daily loss 5%, max drawdown **15%**, min liquidity $100k, order <=0.5% of liquidity | T |
| `src/trading/calibration.ts`, `scripts/nightly-review.ts` | Brier score vs base-rate, calibration bins, report with *proposed* changes only | T |
| `src/lib/jev.ts`, `src/agents/tradingResearch.ts`, `pages/api/research/run.ts` | Research agent (planner/researcher/builder/reviewer/router) | T; uses the older fetch-based Jev client |

### Backtesting / research
| File | Purpose | Status |
|---|---|---|
| `src/trading/backtest.ts`, `strategies.ts`, `pages/api/trading/backtest.ts` | Single-asset hourly backtester with costs, IS/OOS split, quality gates | T, L |
| `src/lib/geckoterminal.ts` | Paginated OHLCV with 429 backoff | L |
| `src/lib/hyperliquid.ts`, `scripts/fetch-hl.ts` | Hyperliquid public API: markets, candles, funding; cache in `.trading-state/hl*/` | L |
| `src/research/{panel,engine,strategies,stats,tournament}.ts`, `scripts/tournament.ts` | Perp portfolio backtester (fees, slippage, actual funding, vol targeting), 6 strategies / 20 configs, walk-forward, holdout, 2x-cost stress, deflated Sharpe | T, L |

### Not built
- **Position manager with rug-exit logic** (the speed-critical piece).
- **Live signer / executor** (PumpPortal trade API or Jupiter-built transactions). `getExecutor()` throws in live mode.
- **Telegram alerts and command bot.**
- **Helius reads** (true holders, authorities, deployer history) to replace approximations.
- **Jev SDK wiring** (blocked, see section 9).
- **Hyperliquid data recorder** (order book, trades, liquidations).
- **Deploy scripts** (Dockerfile / systemd units / server hardening).

---

## 5. Verified facts vs assumptions

**Verified live:** PumpPortal new-token websocket (create events) and the trade-stream key requirement; Hyperliquid info API (178 perps, candles, funding); DexScreener; GeckoTerminal; RugCheck report API (keyless); Jev/TypeSafe API host reachable and requires a key; main Raydium SOL/USDC pool data.

**Not verified (must check before relying on them):**
- PumpPortal trade-event field names (create events verified); rate limits; whether it restricts datacenter IPs.
- Jupiter quote endpoints/fields; whether Jupiter limit/trigger orders support stop-loss for pumpswap tokens.
- Hyperliquid fee tiers and any US-IP / jurisdiction restrictions (I believe both Hyperliquid and Bybit restrict US access; confirm before choosing a US server).
- That Hyperliquid API wallets can trade but not withdraw (my understanding; confirm in docs).
- All prices/stock in the VPS comparison (pasted from elsewhere with citations I could not see).
- `@typesafe-ai/sdk` request shape: types were read (`choice`/`score`/`noul`, `client.systemOne({state, questions, model})`), but no real authenticated call has been made.

**Known biases:** Hyperliquid universe = today's listings (survivorship flatters results); profile/boost feeds on DexScreener are paid promotion (selection bias); costs are assumptions (taker 4.5 bps + slippage 5-15 bps for perps; 0.8%/side for Solana spot).

---

## 6. Recommended setup (infrastructure)

**Principle:** at this stage nothing is raced. Filters only consider tokens >= 30 min old, so server latency is secondary. Choose reliability, a location that avoids jurisdiction problems, and low cost.

1. **Server:** small VPS, 1 vCPU / 2 GB is plenty. Prefer a **European** location (Frankfurt/Amsterdam on Vultr, or Helsinki/Falkenstein on Hetzner): avoids possible US-IP restrictions for exchange APIs, good Solana validator/RPC proximity, lower SSH latency from Nigeria. Monthly billing, **no backups add-on**, no prepaying. Ubuntu 24.04, SSH keys only.
2. **RPC:** choose the RPC endpoint *after* the server, in the same region. Start on a free Helius tier (key already referenced in `.env.local.example`). Use it for holders/authorities/deployer history.
3. **Runtime:** Node 22, run scripts under `systemd` (auto-restart) or `pm2`. Docker is optional, not needed.
4. **Process layout:**
   - service A: `scripts/pump-scan.ts` (scanner, paper)
   - service B: Hyperliquid data recorder (backlog)
   - cron: `scripts/nightly-review.ts` daily
   - alerting: Telegram bot (backlog); until built, tail the candidates file.
5. **Secrets:** a root-owned env file (mode 600) loaded by systemd; never in git, never in chat. Dedicated trading wallet funded by hand with a small amount; the server must have no path to withdraw to other addresses.
6. **Network note for this dev sandbox:** HTTP APIs and WebSockets work with `NODE_USE_ENV_PROXY=1` (an earlier claim here that WebSockets are blocked was wrong: the handshake test omitted that flag). The sandbox is ephemeral, so the 24/7 scanner still belongs on the VPS.
7. **PumpPortal trade stream needs a funded key (verified live; tested again 2026-10-02 with a user-supplied key: connection accepted, trade stream still denied).** The scanner NO LONGER depends on it: it uses the free new-token stream for discovery and DexScreener + RugCheck over HTTP for flow and holders. Create a fresh PumpPortal API key and fund its wallet with the minimum (>= 0.02 SOL, about $2). That wallet is controlled by PumpPortal's Lightning service, so treat it as spent money, never fund it further, and never reuse a key that was pasted in chat. Alternative without PumpPortal custody: subscribe to pump.fun program logs through Helius and parse trades on-chain (more work, no custody). Until one of these exists, holder/flow filters have nothing to work on for fresh pump.fun tokens; the DexScreener-based `screen-dex.ts` path (migrated tokens) still works.
8. **Monitoring:** healthcheck that the websocket is receiving events; alert if no events for >5 min; log rotation; daily summary of candidates, vetoes by reason, paper PnL, kill-switch state.

---

## 7. Operating procedure

**Phase 0: now (free, manual):**
- `NODE_USE_ENV_PROXY=1 npx tsx scripts/screen-dex.ts` (screen + RugCheck gate).
- For any passing mint: `npx tsx scripts/trade-sheet.ts <mint> --size-usd 15 --capital <yours>`; fills the manual sheet only on a pass. Keep a trade log; compare what the filters missed.
- Expect most runs to pass nothing. That is the filters working.
- Timing is unknown; run at several times for a week and log pass rates before assuming "best hours".

**Phase 1: VPS scanner (about 1-2 weeks):**
- Run `pump-scan.ts` 24/7. First goal is fixing the tracker against real events (field names), then collecting candidates + veto reasons.
- Add Helius reads so holders/authorities are real, not assumed.

**Phase 2: autonomous paper trading (about 2+ weeks):**
- Build position manager + rug-exit + Telegram alerts + Jev wiring. Fill with `JupiterPaperExecutor` (real quotes, pessimistic slippage).
- Nightly review. Paper results are an *upper bound*; live fills on fast tokens are worse.

**Phase 3: live micro-stake:**
- Dedicated wallet with only what you can fully lose (e.g. $25-50 total, $2-5 per position).
- Build the signer; first action is one micro-trade to test the path. Per-trade and per-day spend caps enforced in code.

**Phase 4: scale only on evidence** (section 8).

### Go-live gates (all must hold; may never be met)
- >= 100 paper trades or >= 4 weeks, whichever is later.
- Positive expectancy **after** pessimistic costs; profit factor >= 1.3; max drawdown <= 15%.
- Rug-exit tests pass in replay (see backlog).
- If Jev is used: Brier score beats the base-rate baseline on >= 100 scored decisions.
- Kill switch, fail-closed paths, and spend caps verified in tests.
- Your explicit written approval.

---

## 8. Profit accumulation policy (the part that actually matters)

1. **Measure expectancy, not wins.** Expectancy per trade = win% x avg win - loss% x avg loss, after fees, tips, failed transactions and slippage. Don't judge on fewer than ~100 trades; a streak of wins on a handful of trades means nothing.
2. **Position size is the survival variable.** Keep the 2%-of-capital-per-position rule and the 12% stop. Quarter-Kelly is a *cap*, and Kelly needs a measured payoff ratio (currently a placeholder of 1.5).
3. **Scale rule:** increase stake by at most ~1.5x only after each ~50 additional trades with positive after-cost expectancy and no kill-switch event. Any halt, or drawdown beyond 15%, resets to the smallest stake and triggers a review.
4. **Skim profits:** every week, move realised profit above the starting stake out of the trading wallet to cold storage or fiat. Never top the wallet up after a loss streak.
5. **Hard stop:** if cumulative loss reaches your pre-declared budget (decide it now, in writing), stop trading and review before any further deposit.
6. **Costs scale against small stakes:** a fixed priority fee/tip is a large % of a tiny order (the code refuses tips >2% of order). Profit on a very small stake will be tiny even if the strategy works; that is a reason to prove the edge first, not to size up early.
7. **Tax/legal:** keep the trade log (it doubles as a tax record). Check your jurisdiction's rules for crypto gains and for the venues you use.

---

## 9. Pending decisions and blockers

| Item | Owner | Notes |
|---|---|---|
| Allow `@typesafe-ai/sdk` integration | User | Previous attempts were blocked by the tool-permission classifier ("untrusted code integration"). The package was installed locally then reverted from `package.json`. Needs an explicit allow (or a Bash permission rule). Wiring is ~60 lines: question definitions (regime, direction, toxic_flow, setup_quality, risk_state), `getJudge()`, and the research router. Pin model `jev-1.13.0`. |
| VPS purchase and region | User | Recommended: Vultr `vc2-1c-2gb` in Frankfurt or Amsterdam (verify price/stock in cart), monthly, no backups. |
| Helius key as env var on the server | User | Never paste it in chat. |
| Telegram bot token + chat ID | User | Via BotFather, as server env vars. Command whitelist by chat ID. |
| Risk budget in writing | User | Total stake, per-trade size, max loss before stopping. |
| Sources of truth for PumpPortal/Jupiter | Claude | Verify field names/endpoints against live responses once the VPS runs. |

---

## 10. Security and key hygiene (urgent)

- **Several secrets were pasted into the chat** during this project (API keys of unknown services, a TypeSafe/Jev key, strings that may include wallet credentials, an "oanor_live_" rug-check key). Treat all of them as exposed: **rotate them**, and if any string could control a wallet, move the funds.
- Only these keys were ever written to disk, in the sandbox container's gitignored `.env.local` (ephemeral): `JEV_API_KEY`, `TYPESAFE_API_KEY`, `DEXSCREENER_DEFAULT_PAIR`. None are in git (checked repeatedly with `git grep`).
- Going forward: keys are entered directly on the server into a protected env file. Wallet key only on the server, dedicated wallet, small balance. Exchange keys (if any): trade permission only, **no withdrawal**, IP-allowlisted to the server, sub-account with limited funds.
- Do not install or run third-party "agent harness" tools (e.g. AgenKit) or add third-party MCP connectors with trade scope (e.g. OpenMarket trade-through-tab) to a system that touches funds.
- The tool-permission classifier blocked fetching code from outside repos; respect that boundary.

---

## 11. Backlog (ordered)

**P0 before any money**
1. Run `pump-scan.ts` on the VPS; reconcile real PumpPortal events with `PortalEvent`/`PumpTracker` (field names, units, supply, `pool` values for migration).
2. Helius reads: holders, authorities, deployer history; replace assumed fields.
3. Trade log schema + weekly analysis script (veto reasons histogram, pass rate by hour).
4. Replay tests for the rug-exit rule on recorded token sequences (dev/top-holder sells, liquidity drops, sell pressure).

**P1 autonomous paper**
5. Position manager: monitors held token's trades; exit on dev sell, top-10 holder large sell, liquidity drop >20%, 5-min sells >1.5x buys, stop-loss, time stop, TP ladder.
6. Telegram: alerts, `/status`, `/pause`, `/kill`, daily summary; chat-ID whitelist.
7. Jev SDK wiring (after approval); calibration logging is already in place.
8. Replace the placeholder payoff ratio with measured values from paper trades.

**P2 research**
9. Hyperliquid data recorder (L2 book, trades, funding, liquidations) for the top ~8 memecoin perps for 4-8 weeks; then test short-horizon order-flow/funding/liquidation hypotheses with the existing tournament machinery.
10. Pre-register one forward test (e.g. "short a small memecoin-perp basket") with pass criteria written *before* running; run on Hyperliquid testnet. Every config added after seeing results raises the deflated-Sharpe penalty.
11. Market-neutral funding carry (long spot / short perp) as a lower-return, economically grounded alternative.

**P3 live**
12. Signer service with per-trade/per-day caps; micro-trade first; wallet isolation; kill switch tested.

---

## 12. Command cheat sheet

```bash
npm install
npx tsc --noEmit                                   # typecheck (must stay clean)

# Pump.fun / Solana
NODE_USE_ENV_PROXY=1 npx tsx scripts/screen-dex.ts          # HTTP screen + RugCheck (works in the dev sandbox)
NODE_USE_ENV_PROXY=1 npx tsx scripts/trade-sheet.ts <mint> --size-usd 15 --capital 1000 [--demo]
npx tsx scripts/pump-scan.ts 150                   # live scanner; needs websocket (run on the VPS)
npx tsx scripts/paper-trade.ts <pool> [network] [cash]      # strategy paper trader (single pool)
npx tsx scripts/nightly-review.ts <pool> [network]          # calibration report

# Hyperliquid research
NODE_USE_ENV_PROXY=1 npx tsx scripts/fetch-hl.ts 20 2023-06-01
NODE_USE_ENV_PROXY=1 npx tsx scripts/fetch-hl.ts --coins PUMP,DOGE,kPEPE,FARTCOIN,kBONK,PENGU,TRUMP,WIF,SPX,kSHIB,POPCAT --dir .trading-state/hl-meme
npx tsx scripts/tournament.ts                                              # top-20 perps
npx tsx scripts/tournament.ts --dir .trading-state/hl-meme --slip 15 --tag meme
```
`NODE_USE_ENV_PROXY=1` is only needed when running behind an HTTPS proxy (as in the dev sandbox). State/cache lives in `.trading-state/` (gitignored).

---

## 13. Prompt for the next Claude session

> You are continuing work on `cloudynirvana/simplifyr`, branch `claude/dexscreener-jev-api-on69u1`. Read `docs/HANDOFF.md` first. Hard rules: paper trading only; `TRADING_MODE=live` stays unimplemented until the go-live gates in section 7 are met and the user approves in writing; fail closed; code owns thresholds and the risk layer, the judgment model only supplies typed answers; never print, log, store in git, or ask for secrets (keys go in a server env file); never run or install third-party agent harnesses or add trade-scoped third-party connectors. Be honest about uncertainty: every claim about PumpPortal/Jupiter/Hyperliquid terms must be verified against live responses or docs. Next tasks are the P0 backlog items in section 11. Report results faithfully, including failures.

---

## 14. Honest limits

- No edge has been demonstrated. The most likely outcome of the early phases is that the filters pass very few tokens and the paper results are flat or negative.
- Backtests cannot capture bonding-curve fills, MEV/sandwiching, failed transactions, or insider behaviour that reacts to bots; paper results will flatter live results.
- Rug-exit logic reduces damage; it cannot make rugs safe. Coordinated dumps can land within one block, so expect many exits at a loss.
- Speed advantage over a human is real (seconds versus minutes) but small next to slot-landing variance (~400 ms) and competition from faster bots.
- Past gates failing is information, not a bug. Do not loosen the gates to get a pass.
