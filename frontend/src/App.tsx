import { useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { ConnectWallet } from "./components/ConnectWallet";
import { Pitch } from "./components/Pitch";
import { protocolBet, CONTRACT_ADDRESS } from "./config/contract";
import { Markets } from "./pages/Markets";
import { MyBets } from "./pages/MyBets";
import { OwnerPanel } from "./pages/OwnerPanel";
import {
  DemoWallet,
  DemoMarkets,
  DemoMyBets,
  DemoOwnerPanel,
} from "./demo/DemoPages";
import { useDemoStore } from "./demo/store";
import "./App.css";

type Tab = "markets" | "mybets" | "owner";

export default function App() {
  const [tab, setTab] = useState<Tab>("markets");
  const [showPitch, setShowPitch] = useState(true);
  const { address } = useAccount();
  const { account: demoAccount } = useDemoStore();

  const notDeployed =
    CONTRACT_ADDRESS === "0x0000000000000000000000000000000000000000";

  // Demo mode is on by default until a real contract is wired in.
  const [demoMode, setDemoMode] = useState(notDeployed);

  const { data: owner } = useReadContract({
    ...protocolBet,
    functionName: "owner",
    query: { enabled: !demoMode },
  });

  const isOwner = demoMode
    ? !!demoAccount // in demo, the connected account is the owner
    : !!address && !!owner && address.toLowerCase() === (owner as string).toLowerCase();

  return (
    <div className="app">
      {showPitch && <Pitch onClose={() => setShowPitch(false)} />}

      <header className="header">
        <div className="brand">
          <span className="logo">📉</span>
          <div>
            <h1>pDDI</h1>
            <p className="tagline">Protocol Drama Data Index — bet on the cooked.</p>
          </div>
        </div>
        {demoMode ? <DemoWallet /> : <ConnectWallet />}
      </header>

      {demoMode ? (
        <div className="banner demo">
          🧪 <strong>Demo mode</strong> — mock markets, no chain, no real MON.
          Connect the demo wallet, buy HODL/RIP shares, watch the price move, sell to
          exit early, or resolve in the Owner tab and redeem under “My Positions”.
          {!notDeployed && (
            <button className="linkbtn" onClick={() => setDemoMode(false)}>
              Use live contract →
            </button>
          )}
        </div>
      ) : (
        notDeployed && (
          <div className="banner warn">
            ⚠️ Contract address not set. Deploy and set{" "}
            <code>VITE_CONTRACT_ADDRESS</code> in <code>frontend/.env</code>, or{" "}
            <button className="linkbtn" onClick={() => setDemoMode(true)}>
              switch to demo mode
            </button>
            .
          </div>
        )
      )}

      <nav className="tabs">
        <button
          className={tab === "markets" ? "active" : ""}
          onClick={() => setTab("markets")}
        >
          Markets
        </button>
        <button
          className={tab === "mybets" ? "active" : ""}
          onClick={() => setTab("mybets")}
        >
          My Positions
        </button>
        {isOwner && (
          <button
            className={tab === "owner" ? "active" : ""}
            onClick={() => setTab("owner")}
          >
            Owner ⚙️
          </button>
        )}
      </nav>

      <main className="main">
        {demoMode ? (
          <>
            {tab === "markets" && <DemoMarkets />}
            {tab === "mybets" && <DemoMyBets />}
            {tab === "owner" && isOwner && <DemoOwnerPanel />}
          </>
        ) : (
          <>
            {tab === "markets" && <Markets />}
            {tab === "mybets" && <MyBets />}
            {tab === "owner" && isOwner && <OwnerPanel />}
          </>
        )}
      </main>

      <footer className="footer">
        Monad Testnet (chainId 10143) · pool fee 2% · owner resolves manually
        {" · "}
        <button className="linkbtn" onClick={() => setShowPitch(true)}>
          ▶ Replay pitch
        </button>
      </footer>
    </div>
  );
}
