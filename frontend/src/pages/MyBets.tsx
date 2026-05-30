import { useEffect } from "react";
import { formatEther } from "viem";
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { protocolBet, Side, type SideValue } from "../config/contract";
import { useMarkets, type IndexedMarket } from "../hooks/useMarkets";
import { priceCents, hodlPrice } from "../lib/format";

export function MyBets() {
  const { address, isConnected } = useAccount();
  const { markets, isLoading, refetch } = useMarkets();

  const { data: sharesData, refetch: refetchShares } = useReadContracts({
    contracts: markets.map((m) => ({
      ...protocolBet,
      functionName: "getShares" as const,
      args: [BigInt(m.id), address!] as const,
    })),
    query: { enabled: isConnected && markets.length > 0 },
  });

  if (!isConnected) return <p className="muted">Connect a wallet to see your positions.</p>;
  if (isLoading) return <p className="muted">Loading…</p>;

  const positions = markets
    .map((m, i) => {
      const s = sharesData?.[i]?.result as [bigint, bigint] | undefined;
      return { market: m, hodl: s?.[0] ?? 0n, rip: s?.[1] ?? 0n };
    })
    .filter((p) => p.hodl > 0n || p.rip > 0n);

  if (positions.length === 0)
    return <p className="muted">No positions yet. Go trade a market!</p>;

  const refresh = () => {
    refetch();
    refetchShares();
  };

  return (
    <div className="grid">
      {positions.map((p) => (
        <PositionCard key={p.market.id} {...p} onChange={refresh} />
      ))}
    </div>
  );
}

function PositionCard({
  market,
  hodl,
  rip,
  onChange,
}: {
  market: IndexedMarket;
  hodl: bigint;
  rip: bigint;
  onChange: () => void;
}) {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess) onChange();
  }, [isSuccess, onChange]);

  const busy = isPending || confirming;
  const ended = Number(market.deadline) * 1000 <= Date.now();
  const tradeable = !market.resolved && !ended;
  const pHodl = hodlPrice(market.reserveHodl, market.reserveRip);

  const won =
    market.resolved &&
    ((market.winningSide === Side.HODL && hodl > 0n) ||
      (market.winningSide === Side.RIP && rip > 0n));
  const lost = market.resolved && !won;

  return (
    <div className="card">
      <div className="card-head">
        <h3>{market.protocolName}</h3>
        {market.resolved ? (
          <span className={`pill ${won ? "live" : "ended"}`}>
            {market.winningSide === Side.HODL ? "HODL" : "RIP"} won
          </span>
        ) : (
          <span className="pill ended">
            HODL {priceCents(pHodl)} · RIP {priceCents(1 - pHodl)}
          </span>
        )}
      </div>

      {hodl > 0n && (
        <Leg
          market={market}
          side={Side.HODL}
          shares={hodl}
          tradeable={tradeable}
          resolved={market.resolved}
          isWinner={market.winningSide === Side.HODL}
          busy={busy}
          write={writeContract}
        />
      )}
      {rip > 0n && (
        <Leg
          market={market}
          side={Side.RIP}
          shares={rip}
          tradeable={tradeable}
          resolved={market.resolved}
          isWinner={market.winningSide === Side.RIP}
          busy={busy}
          write={writeContract}
        />
      )}

      {lost && <p className="muted small">Resolved against you — losing shares are worth 0.</p>}
      {market.resolved && won && (
        <p className="ok small">Redeem your winning shares 1:1 above.</p>
      )}
      {!market.resolved && ended && (
        <p className="muted small">Trading closed — wait for the owner to resolve.</p>
      )}
      {error && <p className="error small">{error.message.split("\n")[0]}</p>}
      {isSuccess && <p className="ok small">Done ✓</p>}
    </div>
  );
}

function Leg({
  market,
  side,
  shares,
  tradeable,
  resolved,
  isWinner,
  busy,
  write,
}: {
  market: IndexedMarket;
  side: SideValue;
  shares: bigint;
  tradeable: boolean;
  resolved: boolean;
  isWinner: boolean;
  busy: boolean;
  write: ReturnType<typeof useWriteContract>["writeContract"];
}) {
  // Live exit value if sold back to the pool now.
  const { data: sellPreview } = useReadContract({
    ...protocolBet,
    functionName: "previewSell",
    args: [BigInt(market.id), side, shares],
    query: { enabled: tradeable && shares > 0n },
  });
  const exitValue = (sellPreview as bigint | undefined) ?? 0n;
  const label = side === Side.HODL ? "🤝 HODL" : "💀 RIP";
  const cls = side === Side.HODL ? "above" : "below";

  return (
    <div className="leg">
      <div className="leg-head">
        <span className={cls}>{label}</span>
        <span>{Number(formatEther(shares)).toFixed(3)} shares</span>
      </div>

      {tradeable && (
        <div className="leg-row">
          <span className="muted small">
            exit now ≈ {Number(formatEther(exitValue)).toFixed(3)} MON
          </span>
          <button
            className="ghost"
            disabled={busy}
            onClick={() =>
              write({
                ...protocolBet,
                functionName: "sell",
                args: [BigInt(market.id), side, shares, 0n],
              })
            }
          >
            {busy ? "…" : "Sell / exit"}
          </button>
        </div>
      )}

      {resolved && isWinner && (
        <div className="leg-row">
          <span className="ok small">
            redeems {Number(formatEther(shares)).toFixed(3)} MON
          </span>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              write({
                ...protocolBet,
                functionName: "redeem",
                args: [BigInt(market.id)],
              })
            }
          >
            {busy ? "…" : "Redeem"}
          </button>
        </div>
      )}
    </div>
  );
}
