# Handoff: GMGN + Jev + Claude Code memecoin research and paper-trading system

Repo `cloudynirvana/simplifyr`, branch `claude/dexscreener-jev-api-on69u1`. Rewritten 2026-10-02 after the decision to go **GMGN-exclusive** (no PumpPortal, no Telegram). Read section 1 first.

---

## 1. Bottom line

- **The system is a research and paper-trading platform. Nothing has shown a profitable edge yet.** Short live paper runs so far are a handful of trades and net slightly negative. That is too little data to conclude anything either way.
- **Direction:** GMGN is the only data source (and, later, the only execution venue). Jev gives fast, logged judgments. Claude Code designs, reviews and operates. Deterministic code owns every money decision.
- **Current mode:** paper only, with a **read-only** GMGN key. Live trading needs a separate GMGN trading key, created only after the go-live gates in section 7 pass and you approve in writing.
- **"It works profitably"** will only be claimed when the record meets the pre-registered rule in `docs/EXPERIMENTS.md`: at least 100 trades, positive after costs, and positive in at least 3 of 4 weeks.

---

## 2. Roles

| Piece | Role | Speed | Notes |
|---|---|---|---|
| GMGN OpenAPI | Data now (trending, security, holders, token info, quotes); execution later (swaps with server-side TP/SL/trailing) | ~200–700 ms per call; ~10 req/s limit | Read-only key = no trading possible |
| Jev (TypeSafe System One) | Fast typed judgments on tokens that passed every filter: rug risk, direction, setup quality | ~200 ms median (measured) | **Log-only.** Gates nothing until it beats the base-rate Brier score on ≥100 outcomes |
| Bot code (`gmgn-sim`) | The "hands": 24/7 loop, filters, sizing, exits, ledger | Seconds | Runs in Docker on the VPS |
| Claude Code | The "brain", offline: builds code, reviews research, proposes pre-registered changes, operates the server via skills | Hours/days | Never in the per-trade path; never holds keys |

---

## 3. What runs (GMGN pipeline)

```
GMGN /v1/market/rank (sol, 1h & 5m, 100 tokens, every ~60 s)
  -> gmgnScreen (field filters)            src/trading/gmgnFilter.ts
  -> GMGN /v1/token/security               src/trading/gmgnChecks.ts  securityScreen
  -> GMGN /v1/market/token_top_holders     src/trading/gmgnChecks.ts  holderScreen
  -> Jev (log only)                        src/trading/memeJev.ts
  -> paper entry in 3 exit profiles        src/trading/paperBook.ts  (same entries, different exits)
SCOUT: GMGN /v1/trenches (near_completion + completed) every ~3 min -> same pipeline
LEDGER: GMGN /v1/user/smartmoney + /v1/user/kol -> wallet_stats eligibility -> >=2-wallet cluster -> WARDEN (chase, liquidity, security, holders) -> 'copy' profile; mirror exit when copied wallets sell   src/trading/copyTrade.ts
marks: GMGN /v1/token/info every 20 s      src/trading/gmgnEngine.ts markOpen
labels: real return at +60 m and +240 m for every checked candidate (+10% sample of screen rejects)
```

**Filters (all vetoes; thresholds live in one file each):**
- **Field filters:**
  - Liquidity at least $25k, market cap at least $50k, holders at least 300.
  - Age between 30 minutes and 48 hours.
  - Rug ratio at most 0.3, bundlers at most 25%, top 10 at most 30%.
  - Dev at most 5%, rat traders at most 5%, top-70 sniper holdings at most 10%, entrapment at most 0.1.
  - Not a honeypot, not wash-traded, mint and freeze renounced.
  - Not over +300% in 1 hour.
  - No entry after a drop of 10% or more in 5 minutes (GMGN's own hard stop).
  - Buy/sell ratio at most 8.
- **Security:** honeypot, cannot-sell, unrenounced mint or freeze, tax over 10%, blacklist.
- **Holders** (wallets only; pools with `addr_type` 2 and burn addresses with `addr_type` 1 are excluded):
  - Top wallet at most 5% and top 10 wallets at most 30%.
  - Bundler, rat-trader and sniper wallets together at most 10%, creator at most 5%.
  - No cluster of 6 or more wallets with identical balances.

**Exit profiles (pre-registered, `docs/EXPERIMENTS.md`):**

| Profile | Stop-loss | Take-profit | Trailing stop | Time limit |
|---|---|---|---|---|
| base | −12% | ½ at +25%, then ½ at +60% | none | 2 h |
| wide | −20% | ½ at +25%, then ½ at +60% | none | 3 h |
| trail | −15% | none | arms at +20%, exits 15% below the peak | 4 h |
| copy (LEDGER) | −15% | ½ at +50% | arms at +30%, exits 20% below the peak | 6 h, plus a mirror exit when copied wallets sell |

**Rug triggers in every profile:** a liquidity drop of more than 20% from the first mark, or 5-minute sell volume more than 1.5× buy volume. Costs are 1% fee plus 3% slippage per side.

**Ledger:** `/opt/pumpbot/state/gmgn-paper/ledger.jsonl`. It contains snapshots, candidates, fills, outcomes, summaries and a one-time `schema` row.

**Heartbeat:** `/opt/pumpbot/state/heartbeat.json`. It holds the funnel counts, veto counts, `markMiss`, `outcomes` and per-profile summaries. Docker's healthcheck reads it.

---

## 4. Verified vs unverified

**Verified live (2026-10-02):**
- GMGN read-only auth works: `X-APIKEY` header plus `timestamp` and `client_id`. No signing is needed for data.
- `/v1/market/rank` returns 95 fields per token. The default is 10 rows, so the client asks for 100.
- `/v1/token/security` works.
- `/v1/trenches` hit a 429 when called in a burst. The client now spaces calls and waits out `X-RateLimit-Reset`.
- The Jev API works with both keys: 5 typed questions in ~160–300 ms, model `jev-1.13.0`.
- The paper book's exits are tested: TP ladder, stop, trailing stop, time stop, liquidity and sell-pressure rug triggers, and the duplicate guard.
- The GMGN engine is tested end to end with mocked GMGN responses: funnel stages, paired profiles, outcome labelling and the research report.

**Not yet verified (check on the server first):**
- The shape of `/v1/token/info`, which supplies the marks for open positions. `extractMark` assumes `price.price`, `liquidity`, `price.buy_volume_5m` and `price.sell_volume_5m`. The engine logs one `schema` row. **If `markMiss` climbs in the heartbeat, fix `extractMark`.**
- The `/v1/market/token_top_holders` fields `addr_type`, `amount_percentage` and `maker_token_tags`, taken from GMGN's own analyzer code and not yet seen live.
- `/v1/trade/quote`, which needs only the read key but wants a `from_address`. It's not used yet, so paper fills use rank price plus a fixed 4% cost.
- Real fill costs on thin pools. Paper results are an upper bound.
- The response shapes of `/v1/user/smartmoney`, `/v1/user/kol`, `/v1/user/wallet_stats` and `/v1/trenches` are taken from GMGN's skill docs and were tested only with mocks. Check the `wallet` and `candidate` rows in the ledger on the server.

---

## 5. Results so far (honest)

- **Early pre-GMGN runs** (PumpPortal, DexScreener and RugCheck):
  - The strict filters took 0 trades.
  - Relaxed and GMGN-plus-RugCheck profiles produced about 13 paper trades, net slightly negative.
  - Several stop-losses fired within minutes of entry.
- **GMGN trending sample:**
  - Most trending tokens are too young (under 30 minutes) or already up more than 300% in the hour.
  - About 1 in 20 pass the field filters.
  - The RugCheck holder checks then rejected most of those survivors, for insider networks and bundled wallets. The GMGN holder check now has to do that job.
- **Perpetual-futures research** (Hyperliquid tournament, legacy): no strategy passed the gates. Memecoin perps lost 59% on an equal-weight long basket over the test window.

---

## 6. Server runbook (VPS, user `deploy`, repo at `/opt/pumpbot`)

Done already: hardened Ubuntu 24.04 (key-only SSH, root login off, firewall allows port 22 only), Docker, and the repo cloned.

**Switch to GMGN-only (one time):**
1. `cd /opt/pumpbot && git pull`
2. `sudo nano /etc/pumpbot/env`. The file should contain only `GMGN_API_KEY=…` (the read-only key) and optionally `TYPESAFE_API_KEY=…`. Remove the Telegram and PumpPortal lines. The current GMGN key and Jev key were pasted in chat, so create fresh ones and type them here.
3. `bash deploy/finish.sh`. This fixes permissions and builds and starts the single `gmgn` service. It also removes the old PumpPortal containers, disables the retired Telegram watchdog, and prints status.
4. `sudo reboot` once, since a kernel update is pending. The service restarts by itself.

**Daily checks:**
- `docker compose ps` should show `gmgn` as healthy.
- `cat /opt/pumpbot/state/heartbeat.json` shows the funnel, vetoes, `markMiss` and profiles.
- `docker compose exec gmgn tsx scripts/gmgn-research.ts` prints the full research report.

**Claude Code on the server:**
- Start it with `cd /opt/pumpbot && claude`.
- The project skills arrive with `git pull`: `paper-trading-ops`, `paper-review` and `token-due-diligence`.
- **GMGN's official skills plugin:** `/plugin marketplace add GMGNAI/gmgn-skills` then `/plugin install gmgn-cli@gmgn-cli`.
  - These need Node, `npm i -g gmgn-cli`, and `~/.config/gmgn/.env` containing **only** `GMGN_API_KEY=…` (mode 600).
  - Never add `GMGN_PRIVATE_KEY` or `GMGN_ALLOW_AUTOMATED_TRADES` while paper trading.
  - With a read-only key and no private key, the swap, buy and cooking skills cannot trade.

---

## 7. Go-live gates (all required; may never be met)

1. One profile meets the rule in `docs/EXPERIMENTS.md`:
   - At least 100 closed trades, expectancy above 0 after costs, and profit factor at least 1.3.
   - Maximum drawdown at most 15% of deployed capital, and positive in at least 3 of 4 consecutive weeks.
   - The result holds again on a later, fresh period.
2. Rug triggers are observed firing correctly in the ledger, and `markMiss` stays near 0.
3. If Jev is to gate entries: its Brier score beats the base rate on at least 100 outcomes.
4. Your explicit written approval.

**Then, live (separate build, not done yet):**
- **Trading key:** a **new** GMGN key with trading enabled, IP-locked to `216.128.146.99`, bound to a dedicated wallet funded only with the loss budget. The private signing key stays only on the server (mode 600).
- **Order placement:** a GMGN swap with attached strategy orders (stop-loss, take-profit, trailing), which execute server-side even if the bot is down.
- **Hard caps in code:** per trade and per day, plus a kill switch.
- **First live step:** a single micro-trade.

---

## 8. Capital and profit policy

- Size is the survival variable. Positions are $15 on paper. Live, start at $2–5 per trade, no more than 2% of the budget each.
- Scale up by at most 1.5× only after each further 50 trades with positive expectancy after costs. Any halt, or a drawdown past 15%, resets to the smallest size.
- Skim realised profit out of the trading wallet weekly. Never top the wallet up after a losing streak.
- Decide the total loss budget in writing before going live, and stop when it's hit.

---

## 9. Security (urgent items)

- **Keys pasted in chat, treat as exposed and rotate:** GMGN read key, two TypeSafe/Jev keys, a RugCheck-type `oanor_live_` key, PumpPortal strings (one possibly a wallet secret), an older unknown API key. Move funds from any wallet whose secret was ever pasted.
- **Never pasted, keep it that way:** the root password, SSH private key, GMGN signing key and wallet keys.
- **Repo:** it's public and contains no secrets. I checked with `git grep` after every commit.
- **Not allowed on the box:** third-party agent harnesses (AgenKit) and trade-scoped third-party connectors (OpenMarket trade-through-tab).

---

## 10. File map

**Active (GMGN path):**
- `src/lib/gmgn.ts`: read-only client (rank, trenches, security, info, holders, created-tokens, quote).
- `src/trading/gmgnFilter.ts`, `src/trading/gmgnChecks.ts`: filters and checks.
- `src/trading/gmgnEngine.ts`: discover, mark and label.
- `src/trading/paperBook.ts`: positions, exits and the trailing stop.
- `src/trading/memeJev.ts`: Jev questions, log-only.
- `scripts/gmgn-sim.ts`: the service entrypoint.
- `scripts/gmgn-research.ts`: the research report.
- `docs/EXPERIMENTS.md`: pre-registration.
- `Dockerfile`, `docker-compose.yml`: the single `gmgn` service.
- `deploy/setup-server.sh`, `deploy/finish.sh`, `deploy/env.example`: server setup.
- `.claude/skills/*`: project skills.

**Legacy (kept, not running):**
- PumpPortal scanner: `src/lib/pumpportal.ts`, `src/trading/pumpTracker.ts`, `src/trading/discovery*.ts`, `scripts/pump-scan.ts`.
- DexScreener, RugCheck, Jupiter and GeckoTerminal clients and filters.
- `scripts/paper-sim.ts`, `scripts/screen-dex.ts`, `scripts/trade-sheet.ts`.
- Hyperliquid research: `src/research/*`, `scripts/fetch-hl.ts`, `scripts/tournament.ts`.
- Telegram watchdog: `deploy/watchdog.sh` and its timer.
- The older agent and Jev policy (`src/trading/agent.ts`, `jevPolicy.ts`, `jevJudge.ts`, `state.ts`).

---

## 11. Next steps (ordered)

1. On the server, switch to GMGN-only (section 6) and let it run.
2. After about 1 hour, check that `markMiss` is about 0 and the `schema` row looks right. Fix `extractMark` if not. This is the most likely first bug.
3. After about 1 day, run `gmgn-research.ts`: funnel, which rules reject most, whether rejected groups really do worse, and early profile results.
4. Weekly, review against `docs/EXPERIMENTS.md`. Changes become new named, dated profiles, never edits to running ones.
5. Optional: quote-based fills (`/v1/trade/quote` with any public `from_address`) to replace the fixed 4% cost estimate. Use the trenches endpoint as a second discovery source.
6. Only after the gates pass: build the live executor (section 7).

---

## 12. Prompt for the next Claude session

> Continue `cloudynirvana/simplifyr` on branch `claude/dexscreener-jev-api-on69u1`. Read `docs/HANDOFF.md` and `docs/EXPERIMENTS.md` first. GMGN-exclusive: no PumpPortal, no Telegram. Paper only, with a read-only GMGN key. Never add GMGN_PRIVATE_KEY or GMGN_ALLOW_AUTOMATED_TRADES; never print, store in git, or ask for secrets. Jev is log-only until calibrated. Code owns thresholds and risk; Claude never sits in the per-trade path. Never edit a running experiment profile; add a new dated one. Claim profitability only when the pre-registered rule is met. Start with section 11.
