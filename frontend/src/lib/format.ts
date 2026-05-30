import { formatEther } from "viem";

/** Format wei as a trimmed MON amount. */
export function formatMon(wei: bigint, maxFrac = 4): string {
  const s = formatEther(wei);
  const [int, frac = ""] = s.split(".");
  const trimmed = frac.slice(0, maxFrac).replace(/0+$/, "");
  return trimmed ? `${int}.${trimmed}` : int;
}

/** Countdown string from now until a unix-second deadline. */
export function countdown(deadlineSec: bigint, nowMs: number): string {
  const diff = Number(deadlineSec) * 1000 - nowMs;
  if (diff <= 0) return "ended";
  const s = Math.floor(diff / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/**
 * FPMM price of the HODL outcome (0..1), i.e. its implied probability.
 * price_HODL = reserveRip / (reserveHodl + reserveRip).
 */
export function hodlPrice(reserveHodl: bigint, reserveRip: bigint): number {
  const total = reserveHodl + reserveRip;
  if (total === 0n) return 0.5;
  return Number((reserveRip * 1_000_000n) / total) / 1_000_000;
}

/** Format a 0..1 price as cents (e.g. 0.42 → "42¢"). */
export function priceCents(p: number): string {
  return `${Math.round(p * 100)}¢`;
}

/** A short word + color for a Drama Score (0-100, higher = more cooked). */
export function dramaLabel(score: number): { text: string; color: string } {
  if (score >= 75) return { text: "COOKED", color: "#ff5c7c" };
  if (score >= 50) return { text: "SPICY", color: "#ff9f43" };
  if (score >= 30) return { text: "WATCH", color: "#ffd479" };
  return { text: "CALM", color: "#2fbf71" };
}

/** Interpolated color along calm→cooked for the gauge fill. */
export function dramaColor(score: number): string {
  if (score >= 75) return "#ff5c7c";
  if (score >= 50) return "#ff9f43";
  if (score >= 30) return "#ffd479";
  return "#2fbf71";
}
