import { useEffect, useState } from "react";
import { parseEther } from "viem";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { protocolBet, Side } from "../config/contract";
import { useMarkets, type IndexedMarket } from "../hooks/useMarkets";

export function OwnerPanel() {
  const { markets, refetch } = useMarkets();

  return (
    <div className="owner">
      <CreateMarketForm onCreated={refetch} />
      <section className="panel">
        <h2>Manage markets</h2>
        {markets.length === 0 && <p className="muted">No markets yet.</p>}
        <div className="grid">
          {markets.map((m) => (
            <ManageCard key={m.id} market={m} onChanged={refetch} />
          ))}
        </div>
      </section>
    </div>
  );
}

function CreateMarketForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [score, setScore] = useState("");
  const [days, setDays] = useState("90");
  const [liq, setLiq] = useState("5");

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess) {
      onCreated();
      setName("");
      setScore("");
    }
  }, [isSuccess, onCreated]);

  const submit = () => {
    const s = BigInt(Math.floor(Number(score) || 0));
    const deadline = BigInt(
      Math.floor(Date.now() / 1000) + Math.floor(Number(days) * 86400)
    );
    let value = 0n;
    try {
      value = parseEther(liq || "0");
    } catch {
      return;
    }
    if (!name || s > 100n || value <= 0n) return;
    writeContract({
      ...protocolBet,
      functionName: "createMarket",
      args: [name, s, deadline],
      value,
    });
  };

  return (
    <section className="panel">
      <h2>Create market (you are the LP)</h2>
      <div className="form">
        <label>
          Protocol name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bybit" />
        </label>
        <label>
          Baseline Drama Score (0–100)
          <input
            type="number"
            min="0"
            max="100"
            value={score}
            onChange={(e) => setScore(e.target.value)}
            placeholder="60"
          />
        </label>
        <label>
          Deadline (days from now)
          <input type="number" value={days} onChange={(e) => setDays(e.target.value)} />
        </label>
        <label>
          Seed liquidity (MON)
          <input
            type="number"
            step="0.1"
            value={liq}
            onChange={(e) => setLiq(e.target.value)}
            placeholder="5"
          />
        </label>
        <button className="primary" disabled={isPending || confirming} onClick={submit}>
          {isPending || confirming ? "Confirming…" : "Create & seed market"}
        </button>
        {error && <p className="error small">{error.message.split("\n")[0]}</p>}
        {isSuccess && <p className="ok small">Market created ✓</p>}
      </div>
    </section>
  );
}

function ManageCard({
  market,
  onChanged,
}: {
  market: IndexedMarket;
  onChanged: () => void;
}) {
  const [score, setScore] = useState("");
  const [finalScore, setFinalScore] = useState("");

  const update = useWriteContract();
  const updateRcpt = useWaitForTransactionReceipt({ hash: update.data });
  const resolve = useWriteContract();
  const resolveRcpt = useWaitForTransactionReceipt({ hash: resolve.data });
  const withdraw = useWriteContract();
  const withdrawRcpt = useWaitForTransactionReceipt({ hash: withdraw.data });

  useEffect(() => {
    if (updateRcpt.isSuccess || resolveRcpt.isSuccess || withdrawRcpt.isSuccess) onChanged();
  }, [updateRcpt.isSuccess, resolveRcpt.isSuccess, withdrawRcpt.isSuccess, onChanged]);

  const ended = Number(market.deadline) * 1000 <= Date.now();

  return (
    <div className="card">
      <div className="card-head">
        <h3>
          #{market.id} {market.protocolName}
        </h3>
        {market.resolved && (
          <span className="pill resolved">
            {market.winningSide === Side.HODL ? "HODL" : "RIP"} won
          </span>
        )}
      </div>
      <p className="threshold">
        Baseline <strong>{Number(market.startScore)}</strong> · live{" "}
        <strong>{Number(market.currentScore)}</strong>
      </p>

      {!market.resolved && (
        <div className="form">
          <label>
            Push live Drama Score (0–100)
            <input
              type="number"
              min="0"
              max="100"
              value={score}
              onChange={(e) => setScore(e.target.value)}
              placeholder="e.g. 72"
            />
          </label>
          <button
            className="ghost"
            disabled={score === "" || update.isPending || updateRcpt.isLoading}
            onClick={() =>
              update.writeContract({
                ...protocolBet,
                functionName: "updateDramaScore",
                args: [BigInt(market.id), BigInt(Math.floor(Number(score) || 0))],
              })
            }
          >
            {update.isPending || updateRcpt.isLoading ? "Pushing…" : "Update score"}
          </button>
          {update.error && (
            <p className="error small">{update.error.message.split("\n")[0]}</p>
          )}
        </div>
      )}

      {market.resolved ? (
        <div className="form">
          <p className="muted small">Resolved · final score {Number(market.finalScore)}.</p>
          <button
            className="ghost"
            disabled={withdraw.isPending || withdrawRcpt.isLoading}
            onClick={() =>
              withdraw.writeContract({
                ...protocolBet,
                functionName: "withdrawLiquidity",
                args: [BigInt(market.id)],
              })
            }
          >
            {withdraw.isPending || withdrawRcpt.isLoading ? "…" : "Withdraw LP residual"}
          </button>
        </div>
      ) : !ended ? (
        <p className="muted small">Deadline not reached — resolve unlocks after it.</p>
      ) : (
        <div className="form">
          <label>
            Final Drama Score (0–100)
            <input
              type="number"
              min="0"
              max="100"
              value={finalScore}
              onChange={(e) => setFinalScore(e.target.value)}
              placeholder="e.g. 30"
            />
          </label>
          <button
            className="primary"
            disabled={finalScore === "" || resolve.isPending || resolveRcpt.isLoading}
            onClick={() =>
              resolve.writeContract({
                ...protocolBet,
                functionName: "resolve",
                args: [BigInt(market.id), BigInt(Math.floor(Number(finalScore) || 0))],
              })
            }
          >
            {resolve.isPending || resolveRcpt.isLoading ? "Confirming…" : "Resolve"}
          </button>
          <p className="muted small">
            HODL wins if final &lt; {Number(market.startScore)}, else RIP.
          </p>
          {resolve.error && (
            <p className="error small">{resolve.error.message.split("\n")[0]}</p>
          )}
        </div>
      )}
    </div>
  );
}
