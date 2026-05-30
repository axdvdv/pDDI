import { useAccount, useConnect, useDisconnect, useChainId, useSwitchChain } from "wagmi";
import { monadTestnet } from "../config/chain";

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Minimal wallet connect/disconnect control using the injected connector. */
export function ConnectWallet() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  if (!isConnected) {
    const injected = connectors[0];
    return (
      <button
        className="primary"
        disabled={isPending}
        onClick={() => injected && connect({ connector: injected })}
      >
        {isPending ? "Connecting…" : "Connect Wallet"}
      </button>
    );
  }

  const wrongChain = chainId !== monadTestnet.id;

  return (
    <div className="wallet">
      {wrongChain && (
        <button className="warn-btn" onClick={() => switchChain({ chainId: monadTestnet.id })}>
          Switch to Monad
        </button>
      )}
      <span className="addr">{address && short(address)}</span>
      <button className="ghost" onClick={() => disconnect()}>
        Disconnect
      </button>
    </div>
  );
}
