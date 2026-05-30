import { useSyncExternalStore } from "react";
import { parseEther } from "viem";
import type { IndexedMarket } from "../hooks/useMarkets";

// In-memory mock of the FPMM ProtocolBet so the whole flow (buy → price moves →
// sell to exit → resolve → redeem) is clickable without deploying. Math mirrors
// the contract: 2% fee, constant-product reserves, complete-set mint/burn. The
// connected demo account is also the owner/LP. A fake oracle drifts the live
// Drama Score and gently pulls each market's price toward it, so you can buy RIP,
// watch drama rise, and sell back at a profit — solo, no counterparties needed.

const FEE_BPS = 200n;
const BPS = 10_000n;

export const DEMO_ACCOUNT =
  "0xDem0000000000000000000000000000000000001" as `0x${string}`;

type Shares = { hodl: bigint; rip: bigint };

type State = {
  account: `0x${string}` | null;
  markets: IndexedMarket[];
  shares: Record<number, Record<string, Shares>>;
};

function bigSqrt(v: bigint): bigint {
  if (v < 2n) return v < 0n ? 0n : v;
  let x0 = v / 2n;
  let x1 = (x0 + v / x0) / 2n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x0 + v / x0) / 2n;
  }
  return x0;
}

function seed(): State {
  const now = Math.floor(Date.now() / 1000);
  const deadline = BigInt(now + 90 * 86400);
  const mk = (id: number, name: string, start: bigint, liq: bigint): IndexedMarket => ({
    id,
    protocolName: name,
    startScore: start,
    currentScore: start,
    deadline,
    reserveHodl: liq,
    reserveRip: liq,
    collateral: liq,
    resolved: false,
    winningSide: 0,
    finalScore: 0n,
  });

  // Tokenless entities — you couldn't short these before pDDI.
  const markets: IndexedMarket[] = [
    mk(0, "Bybit", 60n, parseEther("5")), // CEX, post-hack FUD
    mk(1, "Gauntlet", 50n, parseEther("5")), // risk curator
    mk(2, "USDD", 70n, parseEther("5")), // Tron CDP stablecoin — depeg risk
  ];
  // Skew initial prices toward each baseline so they don't all start 50/50.
  for (const m of markets) pegPrice(m, Number(m.startScore) / 100, 1);
  return { account: null, markets, shares: {} };
}

/** Pull a market's reserves so price_RIP ≈ q (blend factor 0..1). */
function pegPrice(m: IndexedMarket, q: number, blend: number) {
  const total = m.reserveHodl + m.reserveRip;
  if (total === 0n) return;
  const qc = Math.max(0.05, Math.min(0.95, q));
  // price_RIP = reserveHodl / total  ⇒  reserveHodl = qc * total
  const targetHodl = (total * BigInt(Math.round(qc * 1e6))) / 1_000_000n;
  const b = BigInt(Math.round(blend * 1e6));
  m.reserveHodl = (m.reserveHodl * (1_000_000n - b) + targetHodl * b) / 1_000_000n;
  m.reserveRip = total - m.reserveHodl;
}

let state: State = seed();
const listeners = new Set<() => void>();

function emit() {
  state = { ...state };
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
function getShares(id: number, acct: string): Shares {
  return state.shares[id]?.[acct] ?? { hodl: 0n, rip: 0n };
}
function setMarket(id: number, m: IndexedMarket) {
  state.markets = state.markets.map((x) => (x.id === id ? m : x));
}
const clampScore = (n: number) => Math.max(0, Math.min(100, n));

// ── FPMM math (mirrors the contract) ──────────────────────────────────────
function calcBuy(m: IndexedMarket, side: 0 | 1, dx: bigint): bigint {
  const invest = dx - (dx * FEE_BPS) / BPS;
  const [rSide, rOther] = side === 0 ? [m.reserveHodl, m.reserveRip] : [m.reserveRip, m.reserveHodl];
  const k = rSide * rOther;
  return rSide + invest - k / (rOther + invest);
}
function calcSell(m: IndexedMarket, side: 0 | 1, shares: bigint): bigint {
  const rOther = side === 0 ? m.reserveRip : m.reserveHodl;
  const s = m.reserveHodl + m.reserveRip + shares;
  const disc = s * s - 4n * shares * rOther;
  const dy = (s - bigSqrt(disc)) / 2n;
  if (dy >= rOther) return 0n;
  return dy - (dy * FEE_BPS) / BPS;
}

export const demo = {
  subscribe,
  getSnapshot: () => state,

  connect() {
    state.account = DEMO_ACCOUNT;
    emit();
  },
  disconnect() {
    state.account = null;
    emit();
  },

  createMarket(name: string, startScore: bigint, days: number, liqMon: string) {
    const id = state.markets.length;
    let liq: bigint;
    try {
      liq = parseEther(liqMon || "0");
    } catch {
      return;
    }
    if (!name || liq <= 0n || startScore > 100n) return;
    const m: IndexedMarket = {
      id,
      protocolName: name,
      startScore,
      currentScore: startScore,
      deadline: BigInt(Math.floor(Date.now() / 1000) + days * 86400),
      reserveHodl: liq,
      reserveRip: liq,
      collateral: liq,
      resolved: false,
      winningSide: 0,
      finalScore: 0n,
    };
    pegPrice(m, Number(startScore) / 100, 1);
    state.markets = [...state.markets, m];
    emit();
  },

  previewBuy(id: number, side: 0 | 1, monAmount: string): bigint {
    let dx: bigint;
    try {
      dx = parseEther(monAmount || "0");
    } catch {
      return 0n;
    }
    if (dx <= 0n) return 0n;
    return calcBuy(state.markets[id], side, dx);
  },
  previewSell(id: number, side: 0 | 1, shares: bigint): bigint {
    if (shares <= 0n) return 0n;
    return calcSell(state.markets[id], side, shares);
  },

  buy(id: number, side: 0 | 1, monAmount: string) {
    const acct = state.account;
    if (!acct) return;
    let dx: bigint;
    try {
      dx = parseEther(monAmount || "0");
    } catch {
      return;
    }
    if (dx <= 0n) return;
    const m = { ...state.markets[id] };
    if (m.resolved) return;
    const invest = dx - (dx * FEE_BPS) / BPS;
    const out = calcBuy(m, side, dx);
    if (side === 0) {
      m.reserveRip += invest;
      m.reserveHodl = m.reserveHodl + invest - out;
    } else {
      m.reserveHodl += invest;
      m.reserveRip = m.reserveRip + invest - out;
    }
    m.collateral += invest;
    setMarket(id, m);
    const prev = getShares(id, acct);
    const next = side === 0 ? { hodl: prev.hodl + out, rip: prev.rip } : { hodl: prev.hodl, rip: prev.rip + out };
    state.shares = { ...state.shares, [id]: { ...(state.shares[id] ?? {}), [acct]: next } };
    emit();
  },

  sell(id: number, side: 0 | 1, shares: bigint) {
    const acct = state.account;
    if (!acct) return;
    const held = getShares(id, acct);
    const bal = side === 0 ? held.hodl : held.rip;
    if (shares <= 0n || bal < shares) return;
    const m = { ...state.markets[id] };
    const rOther = side === 0 ? m.reserveRip : m.reserveHodl;
    const s = m.reserveHodl + m.reserveRip + shares;
    const dy = (s - bigSqrt(s * s - 4n * shares * rOther)) / 2n;
    if (dy >= rOther) return;
    if (side === 0) {
      m.reserveHodl = m.reserveHodl + shares - dy;
      m.reserveRip -= dy;
    } else {
      m.reserveRip = m.reserveRip + shares - dy;
      m.reserveHodl -= dy;
    }
    m.collateral -= dy;
    setMarket(id, m);
    const next = side === 0 ? { hodl: held.hodl - shares, rip: held.rip } : { hodl: held.hodl, rip: held.rip - shares };
    state.shares = { ...state.shares, [id]: { ...(state.shares[id] ?? {}), [acct]: next } };
    emit();
  },

  updateDramaScore(id: number, score: number) {
    const m = { ...state.markets[id] };
    if (m.resolved) return;
    m.currentScore = BigInt(clampScore(Math.round(score)));
    pegPrice(m, Number(m.currentScore) / 100, 0.5); // nudge price toward drama
    setMarket(id, m);
    emit();
  },

  resolve(id: number, finalScore: bigint) {
    const m = { ...state.markets[id] };
    const fs = finalScore > 100n ? 100n : finalScore;
    m.resolved = true;
    m.finalScore = fs;
    m.currentScore = fs;
    m.winningSide = fs < m.startScore ? 0 : 1;
    setMarket(id, m);
    emit();
  },

  redeem(id: number) {
    const acct = state.account;
    if (!acct) return;
    const m = state.markets[id];
    if (!m.resolved) return;
    const held = getShares(id, acct);
    const next = m.winningSide === 0 ? { hodl: 0n, rip: held.rip } : { hodl: held.hodl, rip: 0n };
    state.shares = { ...state.shares, [id]: { ...(state.shares[id] ?? {}), [acct]: next } };
    emit();
  },

  getShares(id: number, acct: string): [bigint, bigint] {
    const s = getShares(id, acct);
    return [s.hodl, s.rip];
  },
};

// Fake oracle: drift each open market's Drama Score every 4s; price follows.
let started = false;
function startMockOracle() {
  if (started) return;
  started = true;
  setInterval(() => {
    let changed = false;
    for (const m of state.markets) {
      if (m.resolved) continue;
      const drift = Math.round(Math.sin(Date.now() / 9000 + m.id * 2) * 8);
      const next = clampScore(Number(m.startScore) + drift);
      if (BigInt(next) !== m.currentScore) {
        const nm = { ...m, currentScore: BigInt(next) };
        pegPrice(nm, next / 100, 0.25);
        setMarket(m.id, nm);
        changed = true;
      }
    }
    if (changed) emit();
  }, 4000);
}

export function useDemoStore() {
  startMockOracle();
  return useSyncExternalStore(demo.subscribe, demo.getSnapshot);
}
