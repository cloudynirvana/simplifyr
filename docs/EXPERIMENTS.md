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
