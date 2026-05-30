import { useEffect, useState } from "react";
import { formatEther } from "viem";
import { demo, useDemoStore, DEMO_ACCOUNT } from "./store";
import type { IndexedMarket } from "../hooks/useMarkets";
import { Side, type SideValue } from "../config/contract";
import { countdown, hodlPrice, priceCents } from "../lib/format";
import { DramaGauge } from "../components/DramaGauge";

function short(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
const fmt = (w: bigint, d = 3) => Number(formatEther(w)).toFixed(d);

/* ----------------------------- Wallet ----------------------------- */
export function DemoWallet() {
  const { account } = useDemoStore();
  if (!account)
    return (
      <button className="primary" onClick={() => demo.connect()}>
        Connect Wallet (demo)
      </button>
    );
  return (
    <div className="wallet">
      <span className="addr">{short(account)}</span>
      <button className="ghost" onClick={() => demo.disconnect()}>
        Disconnect
      </button>
    </div>
  );
}

/* ----------------------------- Markets ---------------------------- */
export function DemoMarkets() {
  const { markets } = useDemoStore();
  return (
    <div className="grid">
      {markets.map((m) => (
        <DemoMarketCard key={m.id} market={m} />
      ))}
    </div>
  );
}

function DemoMarketCard({ market }: { market: IndexedMarket }) {
  const { account } = useDemoStore();
  const [now, setNow] = useState(Date.now());
  const [side, setSide] = useState<SideValue>(Side.RIP);
  const [amount, setAmount] = useState("0.5");
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const ended = Number(market.deadline) * 1000 <= now;
  const pHodl = hodlPrice(market.reserveHodl, market.reserveRip);
  const pRip = 1 - pHodl;
  const sharesOut = demo.previewBuy(market.id, side as 0 | 1, amount);
  const avg = sharesOut > 0n ? Number(amount) / Number(formatEther(sharesOut)) : 0;

  const buy = () => {
    demo.buy(market.id, side as 0 | 1, amount);
    setFlash(true);
    setTimeout(() => setFlash(false), 1500);
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
        Liquidity: {fmt(market.collateral, 2)} MON · price tracks the Drama Score
      </p>

      {market.resolved ? (
        <p className="muted small">
          Final Drama Score {Number(market.finalScore)} →{" "}
          {market.winningSide === Side.HODL ? "HODL" : "RIP"} shares redeem 1:1 on “My
          Positions”.
        </p>
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
            />
            <button className="primary" disabled={!account} onClick={buy}>
              Buy
            </button>
          </div>
          {sharesOut > 0n && (
            <p className="muted small">
              ≈ {fmt(sharesOut)} shares @ avg {priceCents(avg)} · max payout {fmt(sharesOut)}{" "}
              MON
            </p>
          )}
          {!account && <p className="muted small">Connect the demo wallet to trade.</p>}
          {flash && <p className="ok small">Filled! ✓ (see “My Positions”)</p>}
        </div>
      )}
    </div>
  );
}

/* -------------------------- My Positions -------------------------- */
export function DemoMyBets() {
  const { account, markets } = useDemoStore();
  if (!account)
    return <p className="muted">Connect the demo wallet to see your positions.</p>;

  const positions = markets
    .map((m) => {
      const [hodl, rip] = demo.getShares(m.id, account);
      return { m, hodl, rip };
    })
    .filter((p) => p.hodl > 0n || p.rip > 0n);

  if (positions.length === 0)
    return <p className="muted">No positions yet. Go trade a market!</p>;

  return (
    <div className="grid">
      {positions.map(({ m, hodl, rip }) => (
        <DemoPositionCard key={m.id} market={m} hodl={hodl} rip={rip} />
      ))}
    </div>
  );
}

function DemoPositionCard({
  market,
  hodl,
  rip,
}: {
  market: IndexedMarket;
  hodl: bigint;
  rip: bigint;
}) {
  const ended = Number(market.deadline) * 1000 <= Date.now();
  const tradeable = !market.resolved && !ended;
  const pHodl = hodlPrice(market.reserveHodl, market.reserveRip);
  const won =
    market.resolved &&
    ((market.winningSide === Side.HODL && hodl > 0n) ||
      (market.winningSide === Side.RIP && rip > 0n));

  const legs: { side: SideValue; shares: bigint }[] = [];
  if (hodl > 0n) legs.push({ side: Side.HODL, shares: hodl });
  if (rip > 0n) legs.push({ side: Side.RIP, shares: rip });

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

      {legs.map(({ side, shares }) => {
        const isWinner = market.winningSide === side;
        const exit = demo.previewSell(market.id, side as 0 | 1, shares);
        return (
          <div className="leg" key={side}>
            <div className="leg-head">
              <span className={side === Side.HODL ? "above" : "below"}>
                {side === Side.HODL ? "🤝 HODL" : "💀 RIP"}
              </span>
              <span>{fmt(shares)} shares</span>
            </div>
            {tradeable && (
              <div className="leg-row">
                <span className="muted small">exit now ≈ {fmt(exit)} MON</span>
                <button
                  className="ghost"
                  onClick={() => demo.sell(market.id, side as 0 | 1, shares)}
                >
                  Sell / exit
                </button>
              </div>
            )}
            {market.resolved && isWinner && (
              <div className="leg-row">
                <span className="ok small">redeems {fmt(shares)} MON</span>
                <button className="primary" onClick={() => demo.redeem(market.id)}>
                  Redeem
                </button>
              </div>
            )}
          </div>
        );
      })}

      {market.resolved && !won && (
        <p className="muted small">Resolved against you — losing shares are worth 0.</p>
      )}
      {!market.resolved && ended && (
        <p className="muted small">Trading closed — wait for the owner to resolve.</p>
      )}
    </div>
  );
}

/* --------------------------- Owner panel -------------------------- */
export function DemoOwnerPanel() {
  const { markets } = useDemoStore();
  const [name, setName] = useState("");
  const [score, setScore] = useState("");
  const [days, setDays] = useState("90");
  const [liq, setLiq] = useState("5");

  const create = () => {
    const s = BigInt(Math.floor(Number(score) || 0));
    if (!name || s > 100n) return;
    demo.createMarket(name, s, Number(days) || 90, liq);
    setName("");
    setScore("");
  };

  return (
    <div className="owner">
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
            <input type="number" step="0.1" value={liq} onChange={(e) => setLiq(e.target.value)} />
          </label>
          <button className="primary" onClick={create}>
            Create & seed market
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Manage markets</h2>
        <p className="muted small">
          Demo note: push the live Drama Score (price follows it), and the deadline
          check is skipped so you can resolve instantly.
        </p>
        <div className="grid">
          {markets.map((m) => (
            <DemoManageCard key={m.id} market={m} />
          ))}
        </div>
      </section>
    </div>
  );
}

function DemoManageCard({ market }: { market: IndexedMarket }) {
  const [score, setScore] = useState("");
  const [finalScore, setFinalScore] = useState("");
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
            disabled={score === ""}
            onClick={() => demo.updateDramaScore(market.id, Number(score) || 0)}
          >
            Update score
          </button>
        </div>
      )}

      {market.resolved ? (
        <p className="muted small">Resolved · final score {Number(market.finalScore)}.</p>
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
            disabled={finalScore === ""}
            onClick={() => demo.resolve(market.id, BigInt(Math.floor(Number(finalScore) || 0)))}
          >
            Resolve
          </button>
          <p className="muted small">
            HODL wins if final &lt; {Number(market.startScore)}, else RIP.
          </p>
        </div>
      )}
    </div>
  );
}

export { DEMO_ACCOUNT };
