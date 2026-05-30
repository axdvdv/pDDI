#!/usr/bin/env bash
# Deploy ProtocolBet + seed 3 demo markets to Monad testnet.
# Usage:  PRIVATE_KEY=0x... ./deploy.sh
#   or put PRIVATE_KEY in contracts/.env and run ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] && set -a && source .env && set +a

: "${PRIVATE_KEY:?Set PRIVATE_KEY (0x-prefixed, funded with testnet MON)}"
RPC="${MONAD_RPC_URL:-https://testnet-rpc.monad.xyz}"

echo "Deploying to $RPC ..."
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC" \
  --broadcast \
  --legacy \
  -vvv

echo
echo "Done. Copy the 'ProtocolBet deployed at' address into frontend/.env as VITE_CONTRACT_ADDRESS."
