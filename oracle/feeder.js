#!/usr/bin/env node
/**
 * pDDI Drama Score oracle feeder.
 *
 * Every 30s, for each market on the deployed ProtocolBet contract, it builds a
 * composite Drama Score (0-100, higher = more cooked) from several live
 * DeFiLlama metrics plus a hardcoded "social panic" bonus, then pushes it
 * on-chain via updateDramaScore(marketId, score).
 *
 * ── The Drama Index ──────────────────────────────────────────────────────────
 * Each component is normalized to a 0..100 sub-score (higher = more drama) and
 * combined as a weighted average; missing components are dropped and the
 * remaining weights renormalized. The social panic bonus is added on top.
 *
 *   liquidity   w .35   100 - normalize(TVL)      low TVL relative to peak = drama
 *   outflow     w .25   from 7d TVL change        money leaving fast = drama
 *   revenue     w .15   from 1d revenue change     protocol earning less = drama
 *   valuation   w .15   mcap / TVL ratio           token froth vs locked value = drama
 *   users       w .10   from active-address trend  (DeFiLlama Pro; mock fallback)
 *   + panicBonus        hardcoded per protocol (Aave=5, Curve=25, LIDO=10)
 *
 * All metrics come from DeFiLlama's free API except active users, which requires
 * a Pro key (set DEFILLAMA_PRO_API_KEY to enable; otherwise a mock is used).
 *
 * Env:
 *   PRIVATE_KEY            owner/oracle key (0x...), must match the contract owner
 *   CONTRACT_ADDRESS       deployed ProtocolBet address
 *   MONAD_RPC_URL          defaults to https://testnet-rpc.monad.xyz
 *   INTERVAL_MS            defaults to 30000
 *   DEFILLAMA_PRO_API_KEY  optional, enables real active-user data
 *
 * Run:  node oracle/feeder.js     (after `npm install` in oracle/)
 */
import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ABI = JSON.parse(readFileSync(join(__dirname, "abi.json"), "utf8"));

const RPC = process.env.MONAD_RPC_URL || "https://testnet-rpc.monad.xyz";
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 30_000);
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const PRO_KEY = process.env.DEFILLAMA_PRO_API_KEY || null;

if (!PRIVATE_KEY || !CONTRACT_ADDRESS) {
  console.error(
    "Missing env. Set PRIVATE_KEY and CONTRACT_ADDRESS (and optionally MONAD_RPC_URL)."
  );
  process.exit(1);
}

// Per-protocol config: DeFiLlama slugs (TVL + fees can differ), a reference TVL
// cap used to normalize health to 0..100, and a hardcoded social panic bonus.
// These are TOKENLESS entities (no token to short) — the whole point of pDDI.
const PROTOCOL_CONFIG = {
  bybit: { tvlSlug: "bybit", feesSlug: null, refTvlUsd: 25e9, panicBonus: 20 }, // CEX, post-hack FUD
  gauntlet: { tvlSlug: "gauntlet", feesSlug: "gauntlet", refTvlUsd: 3e9, panicBonus: 8 }, // risk curator
  usdd: { tvlSlug: "usdd", feesSlug: null, refTvlUsd: 2e9, panicBonus: 30 }, // Tron CDP stablecoin, depeg risk
};
const DEFAULT_CONFIG = { tvlSlug: null, feesSlug: null, refTvlUsd: 10e9, panicBonus: 15 };

// Drama Index component weights (sum to 1.0 over available components).
const WEIGHTS = { liquidity: 0.35, outflow: 0.25, revenue: 0.15, valuation: 0.15, users: 0.1 };

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);

async function getJson(url, headers) {
  try {
    const res = await fetch(url, headers ? { headers } : undefined);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Pull TVL (latest + 7d-ago) and mcap from the protocol endpoint. */
async function fetchTvl(slug) {
  if (!slug) return { tvl: null, tvl7dAgo: null, mcap: null };
  const d = await getJson(`https://api.llama.fi/protocol/${slug}`);
  if (!d) return { tvl: null, tvl7dAgo: null, mcap: null };
  const series = Array.isArray(d.tvl) ? d.tvl : [];
  const last = series.at(-1)?.totalLiquidityUSD ?? null;
  // series is daily; 7 points back ≈ 7 days ago (guard for short series).
  const back = series.length > 7 ? series.at(-8)?.totalLiquidityUSD : series[0]?.totalLiquidityUSD;
  return { tvl: num(last), tvl7dAgo: num(back), mcap: num(d.mcap) };
}

/** Pull 24h revenue and its 1d change from the fees endpoint. */
async function fetchRevenue(slug) {
  if (!slug) return { revenue24h: null, revChange1d: null };
  const d = await getJson(
    `https://api.llama.fi/summary/fees/${slug}?dataType=dailyRevenue`
  );
  if (!d) return { revenue24h: null, revChange1d: null };
  return { revenue24h: num(d.total24h), revChange1d: num(d.change_1d) };
}

/** Active-user trend: real via DeFiLlama Pro if a key is set, else a mock. */
async function fetchUserTrend(name, slug) {
  if (PRO_KEY && slug) {
    const d = await getJson(
      `https://pro-api.llama.fi/${PRO_KEY}/api/activeUsers`
    );
    // shape: { [protocolId]: { users: {value, ...} } } — best-effort, optional.
    const entry = d && Object.values(d).find((v) => v?.name?.toLowerCase() === name.toLowerCase());
    const change = num(entry?.users?.change_1d);
    if (change != null) return change;
  }
  // Mock: deterministic wobble per protocol so the demo still varies.
  const seed = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  return Math.round(Math.sin(Date.now() / 120_000 + seed) * 20); // ~ -20%..+20%
}

/**
 * Combine metrics into a 0..100 Drama Index. Returns { score, parts } where
 * parts is the per-component breakdown for logging.
 */
function computeDramaIndex(name, cfg, m) {
  const parts = {};

  if (m.tvl != null) {
    // Low TVL vs the reference cap = more drama.
    parts.liquidity = clamp(100 - (m.tvl / cfg.refTvlUsd) * 100);
  }
  if (m.tvl != null && m.tvl7dAgo) {
    // 7d outflow: negative change = drama. -25% → ~100, +10% → ~30.
    const change7d = ((m.tvl - m.tvl7dAgo) / m.tvl7dAgo) * 100;
    parts.outflow = clamp(50 - change7d * 2);
  }
  if (m.revChange1d != null) {
    // Revenue dropping = drama. -50% → 100, +20% → 30.
    parts.revenue = clamp(50 - m.revChange1d);
  }
  if (m.mcap != null && m.tvl) {
    // mcap/TVL > 1 means token value outruns locked value (frothy). cap at 100.
    parts.valuation = clamp((m.mcap / m.tvl) * 40);
  }
  if (m.userChange1d != null) {
    // Users leaving = drama. -20% → 70, +20% → 30.
    parts.users = clamp(50 - m.userChange1d);
  }

  // Weighted average over available components, renormalizing weights.
  let wsum = 0;
  let acc = 0;
  for (const [k, v] of Object.entries(parts)) {
    acc += v * WEIGHTS[k];
    wsum += WEIGHTS[k];
  }
  const base = wsum > 0 ? acc / wsum : 50; // neutral if nothing resolved
  const score = clamp(Math.round(base + cfg.panicBonus));
  return { score, base: Math.round(base), parts };
}

async function fetchMetrics(name, cfg) {
  const [tvl, rev, userChange1d] = await Promise.all([
    fetchTvl(cfg.tvlSlug),
    fetchRevenue(cfg.feesSlug),
    fetchUserTrend(name, cfg.tvlSlug),
  ]);
  return { ...tvl, ...rev, userChange1d };
}

async function tick(contract) {
  const count = Number(await contract.marketCount());
  if (count === 0) {
    console.log(`[${new Date().toISOString()}] no markets yet`);
    return;
  }
  const markets = await contract.getAllMarkets();
  for (let id = 0; id < markets.length; id++) {
    const m = markets[id];
    const name = m.protocolName;
    if (m.resolved) {
      console.log(`  #${id} ${name}: resolved, skipping`);
      continue;
    }
    const cfg = PROTOCOL_CONFIG[name.toLowerCase()] || {
      ...DEFAULT_CONFIG,
      tvlSlug: name.toLowerCase(),
      feesSlug: name.toLowerCase(),
    };
    const metrics = await fetchMetrics(name, cfg);
    const { score, base, parts } = computeDramaIndex(name, cfg, metrics);
    const breakdown = Object.entries(parts)
      .map(([k, v]) => `${k}=${Math.round(v)}`)
      .join(" ");
    try {
      const tx = await contract.updateDramaScore(id, score);
      await tx.wait();
      console.log(
        `  #${id} ${name}: drama ${score}/100 (base ${base} +panic ${cfg.panicBonus}) ` +
          `[${breakdown || "no live metrics — neutral"}] tx ${tx.hash.slice(0, 10)}…`
      );
    } catch (e) {
      console.warn(`  #${id} ${name}: updateDramaScore failed: ${e.message.split("\n")[0]}`);
    }
  }
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC, {
    chainId: 10143,
    name: "monad-testnet",
  });
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

  console.log("pDDI oracle feeder — composite Drama Index");
  console.log(`  rpc:      ${RPC}`);
  console.log(`  contract: ${CONTRACT_ADDRESS}`);
  console.log(`  feeder:   ${wallet.address}`);
  console.log(`  interval: ${INTERVAL_MS}ms`);
  console.log(`  users:    ${PRO_KEY ? "DeFiLlama Pro" : "mock (set DEFILLAMA_PRO_API_KEY for real)"}\n`);

  const run = async () => {
    console.log(`[${new Date().toISOString()}] feeding drama scores…`);
    try {
      await tick(contract);
    } catch (e) {
      console.error("tick error:", e.message);
    }
  };

  await run();
  setInterval(run, INTERVAL_MS);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
