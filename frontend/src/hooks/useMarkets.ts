import { useReadContract } from "wagmi";
import { protocolBet } from "../config/contract";

export type Market = {
  protocolName: string;
  startScore: bigint; // baseline Drama Score (0-100)
  deadline: bigint;
  reserveHodl: bigint; // FPMM reserves (wei-scale shares)
  reserveRip: bigint;
  collateral: bigint;
  resolved: boolean;
  winningSide: number; // 0 HODL, 1 RIP
  finalScore: bigint;
};

export type IndexedMarket = Market & { id: number; currentScore: bigint };

/** Reads all markets + live drama scores from the contract. */
export function useMarkets() {
  const {
    data,
    isLoading,
    error,
    refetch: refetchMarkets,
  } = useReadContract({
    ...protocolBet,
    functionName: "getAllMarkets",
    query: { refetchInterval: 10_000 },
  });

  const { data: scores, refetch: refetchScores } = useReadContract({
    ...protocolBet,
    functionName: "getCurrentScores",
    query: { refetchInterval: 10_000 },
  });

  const scoreArr = (scores as bigint[] | undefined) ?? [];
  const markets: IndexedMarket[] = ((data as Market[] | undefined) ?? []).map(
    (m, id) => ({
      ...m,
      id,
      currentScore: scoreArr[id] ?? m.startScore,
    })
  );

  const refetch = () => {
    refetchMarkets();
    refetchScores();
  };

  return { markets, isLoading, error, refetch };
}
