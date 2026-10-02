# Pre-registered experiments (GMGN paper trading)

Registered 2026-10-02, before any data from these profiles existed. Do not change a profile in place: add a new one with a new name and date.

## Shared entry rules (all profiles trade the same entries)
GMGN trending (1h/5m, 100 tokens) → `gmgnScreen` field filters → no entry after a ≥10% 5-minute drawdown (GMGN's own hard stop) → GMGN token security → GMGN holder check (top wallet ≤5%, top-10 wallets ≤30%, bundler+rat+sniper ≤10%, creator ≤5%, no identical-balance cluster) → paper entry at the GMGN rank price + 4% cost (1% fee + 3% slippage); exits pay the same 4%.
Jev answers are logged only and never gate entries.

## Profiles
| Name | Stop | Take-profit | Trailing | Time stop | Hypothesis |
|---|---|---|---|---|---|
| base | −12% | sell ½ at +25%, ½ of rest at +60% | — | 120 min | Production default |
| wide | −20% | same | — | 180 min | Many stops in early runs fired within minutes on normal volatility; a wider stop may raise expectancy |
| trail | −15% | none | arms at +20%, exits 15% below peak | 240 min | Letting runners run beats fixed take-profits on memecoins |

## Evaluation rule (decided now)
- A profile "works" only if: ≥100 closed trades; expectancy per trade > 0 after costs; profit factor ≥ 1.3; max drawdown ≤ 15% of deployed capital; and positive net P&L in ≥3 of 4 consecutive ISO weeks.
- Three profiles are tested, so treat a single marginal winner with suspicion; confirm it on a fresh, later period before any live money.
- Paper fills are an upper bound on live results (real fills on thin pools are worse).

## Added 2026-10-02: LEDGER copy-trading worker and SCOUT discovery
Source idea: a promotional post describing a "brain + SCOUT/LEDGER/PULSE/FLUX + WARDEN" bot (its 1000x claim is unverifiable and not a target).

**SCOUT** – GMGN Trenches `near_completion` + `completed` lists feed the same entry pipeline and the same three profiles (every ~3 min).

**LEDGER (`copy` profile)** – trades GMGN Smart Money + KOL feeds, paper only:
- Wallet eligible (GMGN wallet_stats, 7d): 10–400 trades, win rate ≥ 45%, realized profit > 0, average hold ≥ 10 min (copyable at our latency), ≤ 35% of tokens lost > 50%. Bot-speed and sniper wallets are excluded even when profitable.
- Signal: ≥ 2 eligible wallets open/add (≥ $200 each) in the same token within 30 min.
- WARDEN vetoes: price already ≥ 1.3× the wallets' average buy (we would be exit liquidity), liquidity < $25k, GMGN security and holder checks.
- Exits: stop −15%, sell ½ at +50%, trailing 20% below peak after +30%, 6 h time stop, and a mirror exit when ≥ half of the signalling wallets have sold.
- Same "it works" rule as above; compare against the non-copy profiles on the same weeks.

**Not adopted:** "10x or you're done" all-in compounding (maximizes ruin), unverified bots, and any automation that trades without our risk limits.
