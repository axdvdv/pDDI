import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { monadTestnet } from "./chain";

// Plain wagmi config using the browser-injected wallet (MetaMask, Rabby, …).
// No WalletConnect projectId required — keeps the hackathon setup zero-config.
// To add WalletConnect later, swap in RainbowKit's getDefaultConfig with a
// real projectId from https://cloud.reown.com.
export const wagmiConfig = createConfig({
  chains: [monadTestnet],
  connectors: [injected()],
  transports: {
    [monadTestnet.id]: http("https://testnet-rpc.monad.xyz"),
  },
  ssr: false,
});
