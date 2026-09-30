/**
 * Trading research team: PLANNER → RESEARCHER → BUILDER → REVIEWER → ROUTER (Jev).
 * Smallest useful team; each role does one job. Researcher and verification are
 * plain code (cheapest sufficient role); only the builder calls an LLM.
 */

import OpenAI from "openai";
import { DexPair, getPair, getTokenPairs, searchPairs } from "../lib/dexscreener";
import { jevDecide, JevDecision } from "../lib/jev";

export interface ResearchRequest {
  /** Free text ("BONK"), a Solana token mint, or a pair id. */
  query: string;
  chainId?: string;
  /** Treated as a pair id when set (e.g. a DexScreener chart id). */
  pairId?: string;
  maxIterations?: number;
}

export interface PairMetrics {
  symbol: string;
  dex: string;
  pairAddress: string;
  priceUsd: number | null;
  liquidityUsd: number;
  volume24h: number;
  volLiqRatio: number;
  change: { m5?: number; h1?: number; h6?: number; h24?: number };
  buySellRatio24h: number | null;
  ageHours: number | null;
  fdv: number | null;
  flags: string[];
}

export interface ResearchResult {
  decision: JevDecision;
  iterations: number;
  plan: string[];
  metrics: PairMetrics[];
  report: string;
  reviewerIssues: string[];
  trace: Array<{ step: string; note: string }>;
  caveat: string;
}

const CAVEAT =
  "DexScreener provides snapshot data only (no historical OHLC). Strategies here are hypotheses, NOT backtested; do not treat them as validated edge.";

const SYSTEM = `You are an elite, skeptical AI trading research analyst (quant analysis, market microstructure, macro awareness).
Given live DexScreener snapshot metrics for on-chain pairs, propose 3-5 fundamentally different strategies (momentum, mean reversion, liquidity/flow based, event-driven, avoid/short-risk) with thesis, entry/exit, position sizing, and key risks.
Rules: only use the data provided; label every assumption; account for slippage and liquidity impact; never claim a strategy works without backtesting — no historical data is available, so mark each as UNVALIDATED and state how it would be validated; do not use social sentiment as primary evidence; be honest about limitations.
Output sections: Executive Summary, Market Analysis, Strategy Details, Risk Management, Deployment Considerations, What Could Go Wrong.`;

const openai = () =>
  new OpenAI({ apiKey: process.env.NVIDIA_API_KEY, baseURL: "https://integrate.api.nvidia.com/v1" });

// ── ROLES ────────────────────────────────────────────────────────────────────

function planner(req: ResearchRequest): string[] {
  return [
    `Resolve "${req.query}" to DexScreener pairs on ${req.chainId ?? "solana"}`,
    "Compute liquidity, volume, flow, age and risk flags per pair",
    "Draft 3-5 distinct, unvalidated strategies with explicit risks",
    "Review against success criteria: data-grounded, costs/liquidity addressed, no unsupported claims",
  ];
}

async function researcher(req: ResearchRequest): Promise<DexPair[]> {
  const chain = req.chainId ?? "solana";
  if (req.pairId) {
    const p = await getPair(chain, req.pairId);
    return p ? [p] : [];
  }
  const looksLikeMint = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(req.query);
  const pairs = looksLikeMint ? await getTokenPairs(chain, req.query) : await searchPairs(req.query);
  return pairs
    .filter((p) => p.chainId === chain)
    .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))
    .slice(0, 5);
}

export function computeMetrics(p: DexPair, now = Date.now()): PairMetrics {
  const liq = p.liquidity?.usd ?? 0;
  const vol = p.volume?.h24 ?? 0;
  const t = p.txns?.h24;
  const ageHours = p.pairCreatedAt ? (now - p.pairCreatedAt) / 3.6e6 : null;
  const flags: string[] = [];
  if (liq < 25_000) flags.push("LOW_LIQUIDITY");
  if (liq > 0 && vol / liq > 10) flags.push("VOLUME_SPIKE_VS_LIQUIDITY");
  if (ageHours !== null && ageHours < 24) flags.push("NEW_PAIR");
  if (t && t.sells === 0 && t.buys > 20) flags.push("NO_SELLS_POSSIBLE_HONEYPOT");
  return {
    symbol: `${p.baseToken.symbol}/${p.quoteToken.symbol}`,
    dex: p.dexId,
    pairAddress: p.pairAddress,
    priceUsd: p.priceUsd ? Number(p.priceUsd) : null,
    liquidityUsd: liq,
    volume24h: vol,
    volLiqRatio: liq > 0 ? vol / liq : 0,
    change: { m5: p.priceChange?.m5, h1: p.priceChange?.h1, h6: p.priceChange?.h6, h24: p.priceChange?.h24 },
    buySellRatio24h: t && t.sells > 0 ? t.buys / t.sells : null,
    ageHours,
    fdv: p.fdv ?? null,
    flags,
  };
}

async function builder(req: ResearchRequest, metrics: PairMetrics[], feedback: string[]): Promise<string> {
  const res = await openai().chat.completions.create({
    model: "meta/llama-3.1-70b-instruct",
    temperature: 0.3,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content:
          `Query: ${req.query}\nMetrics (live DexScreener snapshot):\n${JSON.stringify(metrics, null, 2)}` +
          (feedback.length ? `\n\nFix these reviewer issues from the previous draft:\n- ${feedback.join("\n- ")}` : ""),
      },
    ],
  });
  return res.choices[0]?.message?.content ?? "";
}

/** Reviewer is deterministic: cheap, reproducible, and direct evidence. */
export function reviewer(report: string, metrics: PairMetrics[]): string[] {
  const issues: string[] = [];
  const lower = report.toLowerCase();
  for (const s of ["executive summary", "strategy", "risk", "what could go wrong"])
    if (!lower.includes(s)) issues.push(`Missing section: ${s}`);
  if (!/unvalidated|not backtested|untested/.test(lower)) issues.push("Strategies not labelled unvalidated/not backtested");
  if (!/slippage|liquidity/.test(lower)) issues.push("No slippage/liquidity-impact discussion");
  if (/guaranteed|risk[- ]free|can't lose|cannot lose/.test(lower)) issues.push("Contains unsupported certainty claims");
  for (const m of metrics.filter((x) => x.flags.length))
    if (!m.flags.some((f) => lower.includes(f.toLowerCase().replace(/_/g, " ")) || lower.includes(f.toLowerCase())) && !/low liquidity|new pair|honeypot|volume spike/.test(lower))
      issues.push(`Risk flags for ${m.symbol} not addressed: ${m.flags.join(", ")}`);
  return issues;
}

// ── LOOP ─────────────────────────────────────────────────────────────────────

export async function runTradingResearch(req: ResearchRequest): Promise<ResearchResult> {
  const max = req.maxIterations ?? 3;
  const trace: ResearchResult["trace"] = [];
  const plan = planner(req);
  trace.push({ step: "planner", note: `${plan.length} steps` });

  let metrics: PairMetrics[] = [];
  let report = "";
  let issues: string[] = [];
  let decision: JevDecision = "RETRY";
  let i = 0;

  while (i < max) {
    i++;
    if (!metrics.length) {
      try {
        metrics = (await researcher(req)).map((p) => computeMetrics(p));
      } catch (e) {
        trace.push({ step: "researcher", note: `failed: ${(e as Error).message}` });
      }
      trace.push({ step: "researcher", note: `${metrics.length} pairs` });
    }
    if (metrics.length) {
      report = await builder(req, metrics, issues);
      issues = reviewer(report, metrics);
      trace.push({ step: "reviewer", note: `${issues.length} issues` });
    }
    const verificationPassed = metrics.length > 0 && report.length > 0 && issues.length === 0;
    const verdict = await jevDecide({
      goal: `Trading research for "${req.query}"`,
      iteration: i,
      maxIterations: max,
      evidence: { dataFetched: metrics.length > 0, pairsAnalysed: metrics.length, reviewerIssues: issues.length, verificationPassed },
    });
    decision = verdict.decision;
    trace.push({ step: "router", note: `${verdict.decision} (${verdict.source}): ${verdict.reason}` });
    if (decision === "COMPLETE" || decision === "ESCALATE") break;
    if (decision === "RETRY" && !metrics.length) continue;
  }

  return { decision, iterations: i, plan, metrics, report, reviewerIssues: issues, trace, caveat: CAVEAT };
}
