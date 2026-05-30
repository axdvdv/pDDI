// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ProtocolBet — Protocol Drama Data Index (pDDI)
/// @notice Tradeable prediction markets on protocol health, expressed as a
///         "Drama Score" (0–100, higher = more cooked). Each market is a binary
///         outcome market between HODL (the protocol survives) and RIP (it's
///         cooked), priced by a fixed-product market maker (FPMM, Gnosis-style).
///         Positions are continuously tradeable: buy shares with MON, and sell
///         them back to the pool any time before the deadline — so you can exit
///         a winning (or losing) view without waiting for resolution. After the
///         deadline the owner resolves; winning shares redeem 1:1 for MON.
/// @dev    The market creator seeds liquidity and acts as the LP. An off-chain
///         oracle pushes the live Drama Score via updateDramaScore. No external
///         oracle contract, no upgradability. Monad Blitz hackathon.
contract ProtocolBet {
    /// @notice Outcome side of a market.
    enum Side {
        HODL, // 0 — protocol survives: final score < baseline
        RIP // 1 — protocol is cooked: final score >= baseline
    }

    struct Market {
        string protocolName; // e.g. "Bybit"
        uint256 startScore; // baseline Drama Score at creation (0–100)
        uint256 deadline; // unix timestamp; trading closes here
        uint256 reserveHodl; // FPMM reserve of HODL shares (wei-scale)
        uint256 reserveRip; // FPMM reserve of RIP shares (wei-scale)
        uint256 collateral; // MON (wei) backing this market's outstanding shares
        bool resolved; // true once owner has resolved
        Side winningSide; // valid only when resolved
        uint256 finalScore; // final Drama Score recorded at resolution
    }

    uint256 public constant MAX_SCORE = 100;
    /// @notice 2% trading fee, in basis points.
    uint256 public constant FEE_BPS = 200;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    address public immutable owner;

    /// @notice Accrued trading fees (wei) withdrawable by the owner.
    uint256 public accruedFees;

    Market[] private markets;

    /// @notice Live Drama Score per market, pushed by the oracle feeder.
    mapping(uint256 => uint256) public currentDramaScore;

    /// @dev marketId => holder => side => share balance (wei-scale).
    mapping(uint256 => mapping(address => mapping(Side => uint256))) public shareOf;

    event MarketCreated(
        uint256 indexed marketId,
        string protocolName,
        uint256 startScore,
        uint256 deadline,
        uint256 liquidity
    );
    event DramaScoreUpdated(uint256 indexed marketId, uint256 score);
    event Bought(
        uint256 indexed marketId, address indexed trader, Side side, uint256 cost, uint256 shares
    );
    event Sold(
        uint256 indexed marketId, address indexed trader, Side side, uint256 shares, uint256 proceeds
    );
    event MarketResolved(uint256 indexed marketId, Side winningSide, uint256 finalScore);
    event Redeemed(uint256 indexed marketId, address indexed holder, uint256 payout);
    event LiquidityWithdrawn(uint256 indexed marketId, uint256 amount);
    event FeesWithdrawn(address indexed to, uint256 amount);

    error NotOwner();
    error InvalidDeadline();
    error EmptyName();
    error ScoreOutOfRange();
    error NoLiquidity();
    error MarketNotFound();
    error TradingClosed();
    error ZeroAmount();
    error InsufficientShares();
    error SlippageExceeded();
    error NotYetDeadline();
    error AlreadyResolved();
    error NotResolved();
    error NothingToRedeem();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // --------------------------------------------------------------------- //
    //                              Owner actions                            //
    // --------------------------------------------------------------------- //

    /// @notice Create a market and seed it with liquidity (owner is the LP).
    ///         The sent MON mints an equal amount of HODL and RIP shares into
    ///         the pool reserves, starting the price at 50/50.
    /// @param protocolName  Human-readable protocol name.
    /// @param dramaScore    Baseline Drama Score (0–100). HODL wins if the final
    ///                      score drops below this; RIP wins if it stays >= this.
    /// @param deadline      Unix timestamp after which trading closes.
    /// @return marketId     The id of the newly created market.
    function createMarket(string calldata protocolName, uint256 dramaScore, uint256 deadline)
        external
        payable
        onlyOwner
        returns (uint256 marketId)
    {
        if (bytes(protocolName).length == 0) revert EmptyName();
        if (dramaScore > MAX_SCORE) revert ScoreOutOfRange();
        if (deadline <= block.timestamp) revert InvalidDeadline();
        if (msg.value == 0) revert NoLiquidity();

        marketId = markets.length;
        markets.push(
            Market({
                protocolName: protocolName,
                startScore: dramaScore,
                deadline: deadline,
                reserveHodl: msg.value,
                reserveRip: msg.value,
                collateral: msg.value,
                resolved: false,
                winningSide: Side.HODL,
                finalScore: 0
            })
        );
        currentDramaScore[marketId] = dramaScore;

        emit MarketCreated(marketId, protocolName, dramaScore, deadline, msg.value);
    }

    /// @notice Push the latest live Drama Score for a market. Owner/oracle only.
    /// @dev    Informational (drives the UI/price intuition); resolution uses the
    ///         finalScore passed to resolve(). Allowed any time before resolution.
    function updateDramaScore(uint256 marketId, uint256 score) external onlyOwner {
        if (marketId >= markets.length) revert MarketNotFound();
        if (score > MAX_SCORE) revert ScoreOutOfRange();
        currentDramaScore[marketId] = score;
        emit DramaScoreUpdated(marketId, score);
    }

    /// @notice Resolve a market after its deadline. Owner only.
    function resolve(uint256 marketId, uint256 finalScore) external onlyOwner {
        Market storage m = _market(marketId);
        if (finalScore > MAX_SCORE) revert ScoreOutOfRange();
        if (block.timestamp < m.deadline) revert NotYetDeadline();
        if (m.resolved) revert AlreadyResolved();

        // HODL wins when drama dropped below the baseline; RIP otherwise.
        Side winner = finalScore < m.startScore ? Side.HODL : Side.RIP;
        m.resolved = true;
        m.winningSide = winner;
        m.finalScore = finalScore;
        currentDramaScore[marketId] = finalScore;

        emit MarketResolved(marketId, winner, finalScore);
    }

    /// @notice After resolution, the owner (LP) recovers the pool's winning-side
    ///         reserve as collateral. Losing-side reserve is worth nothing.
    function withdrawLiquidity(uint256 marketId) external onlyOwner {
        Market storage m = _market(marketId);
        if (!m.resolved) revert NotResolved();

        uint256 amount = m.winningSide == Side.HODL ? m.reserveHodl : m.reserveRip;
        m.reserveHodl = 0;
        m.reserveRip = 0;
        if (amount > m.collateral) amount = m.collateral; // safety clamp
        m.collateral -= amount;

        if (amount > 0) {
            (bool ok,) = owner.call{value: amount}("");
            if (!ok) revert TransferFailed();
        }
        emit LiquidityWithdrawn(marketId, amount);
    }

    /// @notice Withdraw accrued trading fees. Owner only.
    function withdrawFees(address to) external onlyOwner {
        uint256 amount = accruedFees;
        accruedFees = 0;
        if (amount > 0) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        }
        emit FeesWithdrawn(to, amount);
    }

    // --------------------------------------------------------------------- //
    //                              Trading                                  //
    // --------------------------------------------------------------------- //

    /// @notice Buy `side` shares with MON via the FPMM. Reverts after deadline.
    /// @param marketId  The market to trade.
    /// @param side      HODL or RIP.
    /// @param minShares Minimum shares out (slippage guard).
    /// @return shares   Shares credited to the buyer.
    function buy(uint256 marketId, Side side, uint256 minShares)
        external
        payable
        returns (uint256 shares)
    {
        Market storage m = _market(marketId);
        if (block.timestamp >= m.deadline || m.resolved) revert TradingClosed();
        if (msg.value == 0) revert ZeroAmount();

        uint256 fee = (msg.value * FEE_BPS) / BPS_DENOMINATOR;
        uint256 invest = msg.value - fee;

        // Mint `invest` complete sets into both reserves, then swap out `side`.
        (uint256 rSide, uint256 rOther) = side == Side.HODL
            ? (m.reserveHodl, m.reserveRip)
            : (m.reserveRip, m.reserveHodl);

        uint256 k = rSide * rOther;
        uint256 rOtherNew = rOther + invest;
        uint256 rSideAfter = k / rOtherNew; // integer division favors solvency
        shares = (rSide + invest) - rSideAfter;
        if (shares < minShares) revert SlippageExceeded();

        if (side == Side.HODL) {
            m.reserveHodl = rSideAfter;
            m.reserveRip = rOtherNew;
        } else {
            m.reserveRip = rSideAfter;
            m.reserveHodl = rOtherNew;
        }
        m.collateral += invest;
        accruedFees += fee;
        shareOf[marketId][msg.sender][side] += shares;

        emit Bought(marketId, msg.sender, side, msg.value, shares);
    }

    /// @notice Sell `shares` of `side` back to the FPMM for MON. Before deadline.
    /// @param marketId  The market to trade.
    /// @param side      HODL or RIP.
    /// @param shares    Shares to sell.
    /// @param minReturn Minimum MON out (slippage guard).
    /// @return proceeds MON paid to the seller (net of fee).
    function sell(uint256 marketId, Side side, uint256 shares, uint256 minReturn)
        external
        returns (uint256 proceeds)
    {
        Market storage m = _market(marketId);
        if (block.timestamp >= m.deadline || m.resolved) revert TradingClosed();
        if (shares == 0) revert ZeroAmount();
        if (shareOf[marketId][msg.sender][side] < shares) revert InsufficientShares();

        // Selling `shares` of `side` and burning `dy` complete sets such that the
        // product of reserves is preserved. dy solves:
        //   dy^2 - (rHodl + rRip + shares)*dy + shares*rOther = 0
        // taking the smaller root.
        uint256 rHodl = m.reserveHodl;
        uint256 rRip = m.reserveRip;
        uint256 rOther = side == Side.HODL ? rRip : rHodl;

        uint256 s = rHodl + rRip + shares;
        uint256 disc = s * s - 4 * shares * rOther;
        uint256 dy = (s - _sqrt(disc)) / 2; // gross collateral returned

        if (dy >= rOther) revert InsufficientShares(); // pool can't cover
        uint256 fee = (dy * FEE_BPS) / BPS_DENOMINATOR;
        proceeds = dy - fee;
        if (proceeds < minReturn) revert SlippageExceeded();

        // Update reserves: +shares on `side`, -dy on both (burning sets).
        if (side == Side.HODL) {
            m.reserveHodl = rHodl + shares - dy;
            m.reserveRip = rRip - dy;
        } else {
            m.reserveRip = rRip + shares - dy;
            m.reserveHodl = rHodl - dy;
        }
        m.collateral -= dy;
        accruedFees += fee;
        shareOf[marketId][msg.sender][side] -= shares;

        (bool ok,) = msg.sender.call{value: proceeds}("");
        if (!ok) revert TransferFailed();

        emit Sold(marketId, msg.sender, side, shares, proceeds);
    }

    /// @notice After resolution, redeem winning shares 1:1 for MON.
    function redeem(uint256 marketId) external returns (uint256 payout) {
        Market storage m = _market(marketId);
        if (!m.resolved) revert NotResolved();

        payout = shareOf[marketId][msg.sender][m.winningSide];
        if (payout == 0) revert NothingToRedeem();

        shareOf[marketId][msg.sender][m.winningSide] = 0;
        if (payout > m.collateral) payout = m.collateral; // safety clamp
        m.collateral -= payout;

        (bool ok,) = msg.sender.call{value: payout}("");
        if (!ok) revert TransferFailed();

        emit Redeemed(marketId, msg.sender, payout);
    }

    // --------------------------------------------------------------------- //
    //                                 Views                                 //
    // --------------------------------------------------------------------- //

    function marketCount() external view returns (uint256) {
        return markets.length;
    }

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return _market(marketId);
    }

    function getAllMarkets() external view returns (Market[] memory) {
        return markets;
    }

    function getCurrentScores() external view returns (uint256[] memory scores) {
        scores = new uint256[](markets.length);
        for (uint256 i = 0; i < markets.length; i++) {
            scores[i] = currentDramaScore[i];
        }
    }

    /// @notice Price of HODL in basis points (0–10000); RIP price = 10000 − this.
    ///         Equals the FPMM-implied probability of the HODL outcome.
    function priceHodlBps(uint256 marketId) public view returns (uint256) {
        Market storage m = _market(marketId);
        uint256 total = m.reserveHodl + m.reserveRip;
        if (total == 0) return 5_000;
        return (m.reserveRip * BPS_DENOMINATOR) / total;
    }

    /// @notice A holder's HODL/RIP share balances on a market.
    function getShares(uint256 marketId, address holder)
        external
        view
        returns (uint256 hodl, uint256 rip)
    {
        hodl = shareOf[marketId][holder][Side.HODL];
        rip = shareOf[marketId][holder][Side.RIP];
    }

    /// @notice Preview shares received for buying `side` with `amountIn` MON.
    function previewBuy(uint256 marketId, Side side, uint256 amountIn)
        external
        view
        returns (uint256 shares)
    {
        Market storage m = _market(marketId);
        if (amountIn == 0) return 0;
        uint256 invest = amountIn - (amountIn * FEE_BPS) / BPS_DENOMINATOR;
        (uint256 rSide, uint256 rOther) = side == Side.HODL
            ? (m.reserveHodl, m.reserveRip)
            : (m.reserveRip, m.reserveHodl);
        uint256 k = rSide * rOther;
        uint256 rOtherNew = rOther + invest;
        shares = (rSide + invest) - k / rOtherNew;
    }

    /// @notice Preview MON received for selling `shares` of `side` (net of fee).
    function previewSell(uint256 marketId, Side side, uint256 shares)
        external
        view
        returns (uint256 proceeds)
    {
        Market storage m = _market(marketId);
        if (shares == 0) return 0;
        uint256 rOther = side == Side.HODL ? m.reserveRip : m.reserveHodl;
        uint256 s = m.reserveHodl + m.reserveRip + shares;
        uint256 disc = s * s - 4 * shares * rOther;
        uint256 dy = (s - _sqrt(disc)) / 2;
        if (dy >= rOther) return 0;
        proceeds = dy - (dy * FEE_BPS) / BPS_DENOMINATOR;
    }

    function _market(uint256 marketId) private view returns (Market storage) {
        if (marketId >= markets.length) revert MarketNotFound();
        return markets[marketId];
    }

    /// @dev Babylonian integer square root.
    function _sqrt(uint256 x) private pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    /// @dev Accept direct transfers (e.g. funding); no trading semantics.
    receive() external payable {}
}
