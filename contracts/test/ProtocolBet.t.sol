// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ProtocolBet} from "../src/ProtocolBet.sol";

contract ProtocolBetTest is Test {
    ProtocolBet internal pb;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        pb = new ProtocolBet();
        vm.deal(address(this), 1000 ether);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    // Bybit, baseline 60, 90-day deadline, 10 MON seed liquidity.
    function _market() internal returns (uint256 id) {
        id = pb.createMarket{value: 10 ether}("Bybit", 60, block.timestamp + 90 days);
    }

    function test_CreateSeedsFiftyFifty() public {
        uint256 id = _market();
        assertEq(pb.priceHodlBps(id), 5_000); // 50/50 at seed
        ProtocolBet.Market memory m = pb.getMarket(id);
        assertEq(m.reserveHodl, 10 ether);
        assertEq(m.reserveRip, 10 ether);
    }

    function test_BuyMovesPrice() public {
        uint256 id = _market();
        vm.prank(alice);
        uint256 shares = pb.buy{value: 5 ether}(id, ProtocolBet.Side.RIP, 0);
        assertGt(shares, 0);
        // Buying RIP makes RIP more expensive => HODL price (bps) drops below 50%.
        assertLt(pb.priceHodlBps(id), 5_000);
        (, uint256 rip) = pb.getShares(id, alice);
        assertEq(rip, shares);
    }

    function test_SellExitBeforeResolve() public {
        uint256 id = _market();
        // Alice buys RIP; drama then rises (others pile into RIP) so she exits up.
        vm.prank(alice);
        uint256 aShares = pb.buy{value: 2 ether}(id, ProtocolBet.Side.RIP, 0);
        vm.prank(bob);
        pb.buy{value: 8 ether}(id, ProtocolBet.Side.RIP, 0); // pushes RIP price up

        uint256 before = alice.balance;
        vm.prank(alice);
        uint256 proceeds = pb.sell(id, ProtocolBet.Side.RIP, aShares, 0);
        assertEq(alice.balance - before, proceeds);
        // She entered at ~0.5 and the crowd pushed RIP up, so exit > entry cost.
        assertGt(proceeds, 2 ether * 98 / 100); // at least clears the round-trip fee floor
        (, uint256 ripLeft) = pb.getShares(id, alice);
        assertEq(ripLeft, 0);
    }

    function test_ResolveRedeemAndSolvency() public {
        uint256 id = _market();
        vm.prank(alice);
        uint256 aH = pb.buy{value: 4 ether}(id, ProtocolBet.Side.HODL, 0);
        vm.prank(bob);
        pb.buy{value: 4 ether}(id, ProtocolBet.Side.RIP, 0);

        vm.warp(block.timestamp + 91 days);
        pb.resolve(id, 30); // 30 < 60 => HODL wins

        // Alice (HODL) redeems 1:1; Bob (RIP) gets nothing.
        uint256 before = alice.balance;
        vm.prank(alice);
        uint256 payout = pb.redeem(id);
        assertEq(payout, aH);
        assertEq(alice.balance - before, aH);

        vm.prank(bob);
        vm.expectRevert(ProtocolBet.NothingToRedeem.selector);
        pb.redeem(id);

        // Owner recovers the winning-side pool reserve; contract stays solvent.
        pb.withdrawLiquidity(id);
        ProtocolBet.Market memory m = pb.getMarket(id);
        assertEq(m.collateral, 0); // all market collateral accounted for
    }

    function test_TradingClosedAfterDeadline() public {
        uint256 id = _market();
        vm.warp(block.timestamp + 91 days);
        vm.prank(alice);
        vm.expectRevert(ProtocolBet.TradingClosed.selector);
        pb.buy{value: 1 ether}(id, ProtocolBet.Side.HODL, 0);
    }

    function test_OnlyOwnerCreatesAndNeedsLiquidity() public {
        vm.prank(alice);
        vm.expectRevert(ProtocolBet.NotOwner.selector);
        pb.createMarket{value: 1 ether}("X", 50, block.timestamp + 1 days);

        vm.expectRevert(ProtocolBet.NoLiquidity.selector);
        pb.createMarket{value: 0}("X", 50, block.timestamp + 1 days);
    }

    function test_UpdateDramaScore() public {
        uint256 id = _market();
        pb.updateDramaScore(id, 82);
        assertEq(pb.currentDramaScore(id), 82);
    }

    receive() external payable {}
}
