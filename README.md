# 📉 pDDI — Protocol Drama Data Index

> Turn your opinion on a DeFi protocol's health into a **tradeable** onchain position.

<p align="center">
  🏆 Built at <b>Monad Blitz Buenos Aires 2026</b> · ⚡ Runs entirely on Monad testnet
</p>

---

## 💡 The idea

In DeFi there's no way to profit from your read on a protocol. You see a project
dying — but you can't short it (no token), can't bet on it. You just post a thread
on Twitter. **pDDI turns opinions into positions.**

Every market tracks a protocol's **Drama Score** (0–100, higher = more cooked),
fed live by an oracle from real DeFiLlama metrics. You buy **🤝 HODL** (it survives)
or **💀 RIP** (it's cooked) shares, **priced by an AMM** so they trade continuously
between 0–100¢. The price *is* the implied probability — and since positions are
tradeable, you can **sell back to the pool and exit any time** before resolution,
locking in profit when the index moves your way.

The kicker: markets work for **tokenless entities** (CEXes, bridges, risk curators)
you could *never short before*. Couldn't short FTX. Now you can short the next one.

---

## 🟢 Live on Monad testnet

| | |
|---|---|
| **Contract** | [`0x9Db4AC25C3241690d807be816046a14da57DEae4`](https://testnet.monadexplorer.com/address/0x9Db4AC25C3241690d807be816046a14da57DEae4) |
| **Network** | Monad Testnet · chainId `10143` |
| **RPC** | `https://testnet-rpc.monad.xyz` |
| **Seed markets** | 🟠 Bybit (CEX, baseline 60) · 🟣 Gauntlet (risk curator, 50) · 🔴 USDD (Tron stable, 70) |

---

## 🗂️ Repo structure (monorepo)

```
pddi/
├── contracts/   🔩 Foundry — ProtocolBet.sol (FPMM market), tests, deploy script
├── oracle/      🛰️  Node + ethers.js — composite Drama Score feeder (DeFiLlama)
├── frontend/    🖥️  Vite + React + Wagmi dapp (pitch deck, trade UI, demo mode)
└── README.md    👋 you are here
```

---

## ⚙️ How it works

1. **Owner creates & seeds a market** — `createMarket(name, dramaScore, deadline)`
   payable. The MON sent seeds the AMM (owner is the LP); price starts 50/50.
   `dramaScore` (0–100) is the baseline the market resolves against.
2. **Oracle feeds the live score** — `updateDramaScore(marketId, score)` every 30s.
3. **Anyone trades** — `buy(marketId, side, minShares)` mints shares via the FPMM;
   `sell(marketId, side, shares, minReturn)` sells them back for MON. Buying a side
   pushes its price up; **exit any time before the deadline**.
4. **Owner resolves after the deadline** — `resolve(marketId, finalScore)`.
   **HODL wins if `finalScore < baseline`** (drama dropped → survived);
   **RIP wins if `finalScore >= baseline`** (stayed high → cooked).
5. **Winners redeem** — `redeem(marketId)` pays 1 MON per winning share; losing
   shares are worth 0. The owner reclaims the pool's winning-side residual via
   `withdrawLiquidity`. A 2% fee is taken on every trade.

### 🛰️ The Drama Index (oracle)

The feeder builds a composite 0–100 score from live DeFiLlama data — weighted and
renormalized over whatever metrics are available — plus a hardcoded social-panic bonus:

| component | weight | signal |
|---|---|---|
| **liquidity** | .35 | low TVL vs the protocol's reference peak |
| **outflow** | .25 | 7-day TVL change — money leaving fast |
| **revenue** | .15 | 1-day revenue change — protocol earning less |
| **valuation** | .15 | mcap / TVL ratio (drops out for tokenless entities) |
| **users** | .10 | active-address trend (DeFiLlama Pro; mock fallback) |
| + **panic bonus** | — | hardcoded per protocol |

```
dramaScore = clamp( weightedAvg(components) + panicBonus , 0 , 100 )
```

Everything comes from DeFiLlama's **free** API except active users (Pro key; a
deterministic mock is used otherwise).

---

## 🖥️ Frontend features

- **Pitch deck** — fullscreen intro on load (arrows/dots to navigate, `Enter pDDI →`
  or Esc to close; `▶ Replay pitch` in the footer).
- **Markets** — live **Drama Score gauge** (baseline marked), HODL/RIP **prices in ¢**,
  liquidity, countdown, and a buy box with a live shares/avg-price preview.
- **My Positions** — your shares, a live **Sell / exit** value, and **Redeem** once a
  market resolves your way.
- **Owner panel** — create & seed markets, push the live score, resolve, withdraw LP.
- **Demo mode** — the whole buy → price moves → sell → resolve → redeem flow with zero gas.

---

## 🧰 Tech stack

Solidity ^0.8.24 · Foundry · Node + ethers.js · React + TypeScript · Vite ·
Wagmi v2 · viem · TanStack Query · Monad testnet.

---

## 🧑‍💻 Team

**Alex** — the engineer behind pDDI. 8 years building DeFi infrastructure: lending
protocols, yield vaults, account abstraction. Previously at Clearpool, Protofire,
Partitura. Open to co-founder / smart-contract / research roles at a protocol that ships.

---

> ⚠️ Hackathon MVP. Owner/oracle-resolved (trusted), unaudited — **testnet only**.
