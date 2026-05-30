import { useEffect, useState } from "react";
import { formatEther, parseEther } from "viem";
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { protocolBet, Side, type SideValue } from "../config/contract";
import { useMarkets, type IndexedMarket } from "../hooks/useMarkets";
import { countdown, hodlPrice, priceCents } from "../lib/format";
import { DramaGauge } from "../components/DramaGauge";

export function Markets() {
  const { markets, isLoading, error, refetch } = useMarkets();

  if (isLoading) return <p className="muted">Loading markets…</p>;
  if (error) return <p className="error">Failed to load markets: {error.message}</p>;
  if (markets.length === 0) return <p className="muted">No markets yet.</p>;

  return (
    <div className="grid">
      {markets.map((m) => (
        <MarketCard key={m.id} market={m} onAction={refetch} />
      ))}
    </div>
  );
}

function MarketCard({
  market,
  onAction,
}: {
  market: IndexedMarket;
  onAction: () => void;
}) {
  const { isConnected } = useAccount();
  const [now, setNow] = useState(Date.now());
  const [side, setSide] = useState<SideValue>(Side.RIP);
  const [amount, setAmount] = useState("0.5");

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  // Live preview of shares received for the current amount/side.
  let amountWei = 0n;
  try {
    amountWei = parseEther(amount || "0");
  } catch {
    amountWei = 0n;
  }
  const { data: previewShares } = useReadContract({
    ...protocolBet,
    functionName: "previewBuy",
    args: [BigInt(market.id), side, amountWei],
    query: { enabled: amountWei > 0n && !market.resolved },
  });

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (isSuccess) onAction();
  }, [isSuccess, onAction]);

  const ended = Number(market.deadline) * 1000 <= now;
  const pHodl = hodlPrice(market.reserveHodl, market.reserveRip);
  const pRip = 1 - pHodl;
  const buyPrice = side === Side.HODL ? pHodl : pRip;
  const sharesOut = (previewShares as bigint | undefined) ?? 0n;
  const avgPrice = sharesOut > 0n ? Number(amountWei) / Number(sharesOut) : buyPrice;

  const placeBuy = () => {
    if (amountWei <= 0n) return;
    writeContract({
      ...protocolBet,
      functionName: "buy",
      args: [BigInt(market.id), side, 0n],
      value: amountWei,
    });
  };

  return (
    <div className="card">
      <div className="card-head">
        <h3>{market.protocolName}</h3>
        {market.resolved ? (
          <span className="pill resolved">
            Resolved · {market.winningSide === Side.HODL ? "HODL" : "RIP"} won
          </span>
        ) : ended ? (
          <span className="pill ended">Awaiting resolution</span>
        ) : (
          <span className="pill live">⏳ {countdown(market.deadline, now)}</span>
        )}
      </div>

      <DramaGauge
        score={Number(market.resolved ? market.finalScore : market.currentScore)}
        baseline={Number(market.startScore)}
      />

      <div className="prices">
        <div className="price above">
          <span className="plabel">🤝 HODL</span>
          <span className="pval">{priceCents(pHodl)}</span>
        </div>
        <div className="price below">
          <span className="plabel">💀 RIP</span>
          <span className="pval">{priceCents(pRip)}</span>
        </div>
      </div>
      <p className="muted small">
        Liquidity: {Number(formatEther(market.collateral)).toFixed(2)} MON · prices
        move as people trade
      </p>

      {market.resolved ? (
        <p className="muted small">
          Final Drama Score {Number(market.finalScore)} →{" "}
          {market.winningSide === Side.HODL ? "HODL" : "RIP"} shares redeem 1:1 on “My
          Positions”.
        </p>
      ) : ended ? (
        <p className="muted small">Trading closed. Waiting for owner to resolve.</p>
      ) : (
        <div className="bet-box">
          <div className="side-toggle">
            <button
              className={side === Side.HODL ? "above active" : "above"}
              onClick={() => setSide(Side.HODL)}
            >
              🤝 HODL {priceCents(pHodl)}
            </button>
            <button
              className={side === Side.RIP ? "below active" : "below"}
              onClick={() => setSide(Side.RIP)}
            >
              💀 RIP {priceCents(pRip)}
            </button>
          </div>
          <div className="bet-row">
            <input
              type="number"
              min="0"
              step="0.1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="MON"
            />
            <button
              className="primary"
              disabled={!isConnected || isPending || confirming || amountWei <= 0n}
              onClick={placeBuy}
            >
              {isPending || confirming ? "Confirming…" : "Buy"}
            </button>
          </div>
          {sharesOut > 0n && (
            <p className="muted small">
              ≈ {Number(formatEther(sharesOut)).toFixed(3)} shares @ avg{" "}
              {priceCents(avgPrice)} · max payout{" "}
              {Number(formatEther(sharesOut)).toFixed(3)} MON if it wins
            </p>
          )}
          {!isConnected && <p className="muted small">Connect a wallet to trade.</p>}
          {error && <p className="error small">{error.message.split("\n")[0]}</p>}
          {isSuccess && <p className="ok small">Filled! ✓ (manage on “My Positions”)</p>}
        </div>
      )}
    </div>
  );
}
