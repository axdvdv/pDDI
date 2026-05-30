import { protocolBetAbi } from "./abi";

// Deployed ProtocolBet address on Monad testnet.
// Set VITE_CONTRACT_ADDRESS in .env after deploying.
export const CONTRACT_ADDRESS = (import.meta.env.VITE_CONTRACT_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

export const protocolBet = {
  address: CONTRACT_ADDRESS,
  abi: protocolBetAbi,
} as const;

// HODL = protocol survives (final drama score drops below baseline).
// RIP  = protocol is cooked (final score stays high or rises).
export const Side = { HODL: 0, RIP: 1 } as const;
export type SideValue = (typeof Side)[keyof typeof Side];
