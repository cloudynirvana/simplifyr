---
name: token-due-diligence
description: Check one Solana token with GMGN data only (field filters, security, holder structure) and give a pass/no-trade verdict. Use when given a token or mint address to evaluate.
---
# Token due diligence (GMGN only)

- With the GMGN plugin installed (`/plugin install gmgn-cli@gmgn-cli`), use its read-only skills: `gmgn-token` (info/security), `gmgn-holder-analysis`, `gmgn-contract-dd`, `gmgn-dev-score`.
- Apply OUR thresholds, which live in code: `src/trading/gmgnFilter.ts` (field filters) and `src/trading/gmgnChecks.ts` (security + holders: top wallet ≤ 5%, top-10 wallets ≤ 30%, bundler+rat+sniper ≤ 10%, creator ≤ 5%, no identical-balance cluster, no honeypot/tax > 10%/unrenounced authorities, no entry after a ≥ 10% 5-minute drop).
- Verdict: PASS only if every rule passes; otherwise NO TRADE with the failed rules listed. A clean summary score is not a pass.
- Never run gmgn-swap, gmgn-token-buy or gmgn-cooking, never ask for or handle wallet keys; the key on this server is read-only.
