/** The five typed questions the gate asks Jev (System One), as plain JSON. No SDK: the API is POST /v1/systemone. Keep ALL question text here for review. */
const HELP =
  "The state is a numeric snapshot of one crypto pair at the close of the latest 1-hour candle. ret_*, dist_*, vol_*, range_* are percents; vol_z is volume z-score; " +
  "signal=1 means the validated strategy wants to enter long; inventory/drawdown/day_pnl describe the account; liq_usd_m is pool liquidity in $ millions.";

export const QUESTIONS = {
  regime: { type: "choice", instructions: `${HELP} Which market regime best describes the recent price action?`, criteria: { trending: "Sustained directional moves with orderly pullbacks", mean_reverting: "Choppy, range-bound moves that retrace", high_vol: "Large swings in both directions without clear direction", crisis: "Disorderly, sharp selling or liquidity stress; protect capital" } },
  direction: { type: "choice", instructions: `${HELP} Over the next 6 hours, which outcome is most likely for the price?`, criteria: { long: "Price rises by more than trading costs of about 1.6 percent", short: "Price falls materially", neutral: "No clear move beyond trading costs" } },
  toxic_flow: { type: "noul", instructions: `${HELP} Does the volume and range pattern suggest toxic or manipulated flow (a pump, a dump, or wash-like volume spike) rather than organic trading?` },
  setup_quality: { type: "score", instructions: `${HELP} How good is the long entry setup right now, considering signal, trend, volatility and distance from recent extremes?`, criteria: ["Poor: no edge or chasing an extreme", "Weak: some support but mixed", "Good: several factors align", "Excellent: strong, clean alignment with contained volatility"] },
  risk_state: { type: "choice", instructions: `${HELP} Given drawdown, day PnL and volatility, what is the account risk state?`, criteria: { safe: "Comfortable room within risk limits", near_limit: "Close to a drawdown or daily-loss limit", reduce: "Should cut risk now" } },
} as const;
