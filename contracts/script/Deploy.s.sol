// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ProtocolBet} from "../src/ProtocolBet.sol";

/// @notice Deploys ProtocolBet and seeds 3 demo markets, each with a +2h deadline.
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);

        ProtocolBet pb = new ProtocolBet();

        // Baseline Drama Scores (0-100, higher = more cooked). HODL wins if the
        // final score drops below the baseline; RIP wins if it stays high/rises.
        // These are TOKENLESS entities — you couldn't short them before pDDI.
        // Long horizon ("will it survive the quarter") — positions are tradeable,
        // so you exit via the AMM any time without waiting for resolution.
        // Each market is seeded with liquidity (owner is the LP).
        uint256 deadline = block.timestamp + 90 days;
        pb.createMarket{value: 1 ether}("Bybit", 60, deadline); // CEX reserves — "next FTX"
        pb.createMarket{value: 1 ether}("Gauntlet", 50, deadline); // tokenless risk curator
        pb.createMarket{value: 1 ether}("USDD", 70, deadline); // Tron CDP stablecoin — depeg risk

        vm.stopBroadcast();

        console2.log("ProtocolBet deployed at:", address(pb));
        console2.log("Owner:", pb.owner());
        console2.log("Seeded markets:", pb.marketCount());
    }
}
