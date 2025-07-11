// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import "./EscrowVault.sol";

/**
 * @title PreMarketTrade
 * @notice Hợp đồng cho phép giao dịch token chưa phát hành với cơ chế collateral bảo mật
 * @dev Sử dụng EIP-712 signatures và collateral locking để đảm bảo an toàn giao dịch
 * @author Blockchain Expert
 * @custom:security-contact security@premarket.trade
 */
contract PreMarketTrade is
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    EIP712Upgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ============ Constants ============
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    bytes32 public constant PREORDER_TYPEHASH =
        keccak256(
            "PreOrder(address trader,address collateralToken,bytes32 targetTokenId,uint256 amount,uint256 price,bool isBuy,uint256 nonce,uint256 deadline)"
        );

    // ============ State Variables ============
    uint256 public tradeCounter;
    uint256 public tokenIdCounter; // Prevent hash collision

    /**
     * @notice Reference đến EscrowVault contract
     * @dev Vault quản lý balance nội bộ thay vì transferFrom trực tiếp
     * @dev Không thể dùng immutable trong upgradeable contracts
     */
    EscrowVault public vault;

    /**
     * @notice Contract version for upgrade tracking
     * @dev Increment này mỗi lần upgrade
     */
    string public constant VERSION = "1.0.0";

    // ============ Amount & Price Decimals ============
    uint256 public constant AMOUNT_DECIMALS = 6; // Amount được normalize về 6 decimals
    uint256 public constant AMOUNT_SCALE = 10 ** AMOUNT_DECIMALS; // 1e6
    uint256 public constant MIN_PRICE_RATIO = 1e3; // Minimum price ratio (normalized)
    uint256 public constant MAX_PRICE_RATIO = 1e30; // Maximum price ratio (normalized)

    // ============ Economic Parameters ============
    uint256 public buyerCollateralRatio; // Will be set in initializer: 100% of trade value
    uint256 public sellerCollateralRatio; // Will be set in initializer: 100% of trade value (asymmetric)
    uint256 public sellerRewardBps; // Will be set in initializer: 0% reward for fulfilling
    uint256 public latePenaltyBps; // Will be set in initializer: 100% penalty for late settlement

    // ============ Token Market ============
    struct TokenInfo {
        bytes32 tokenId;
        string symbol;
        string name;
        address realAddress; // address(0) nếu chưa map
        uint8 decimals; // Target token decimals (stored when mapped)
        uint256 mappingTime;
        uint256 settleTimeLimit; // seconds
        uint256 createdAt;
        bool exists;
    }

    mapping(bytes32 => TokenInfo) public tokens;
    mapping(string => bytes32) public symbolToTokenId; // Prevent duplicate symbols

    // ============ Structs ============

    /**
     * @notice Cấu trúc đơn hàng pre-market
     * @param trader Địa chỉ người giao dịch
     * @param collateralToken Token dùng làm tài sản thế chấp
     * @param targetTokenId ID của token thật sẽ được giao
     * @param amount Số lượng token được normalize về 6 decimals
     * @param price Giá per unit với decimals của collateral token - VD: 1.5 USDC = 1500000, 1.5 DAI = 1500000000000000000
     * @param isBuy true = BUY order, false = SELL order
     * @param nonce Số sequence để tránh replay attack
     * @param deadline Thời hạn của order
     */
    struct PreOrder {
        address trader;
        address collateralToken;
        bytes32 targetTokenId;
        uint256 amount; // 6 decimals (normalized)
        uint256 price; // Decimals của collateral token
        bool isBuy;
        uint256 nonce;
        uint256 deadline;
    }

    /**
     * @notice Cấu trúc lưu trữ giao dịch đã khớp
     * @param buyer Thông tin order của buyer
     * @param seller Thông tin order của seller
     * @param targetToken Địa chỉ token thật sẽ được giao
     * @param matchTime Thời điểm khớp lệnh
     * @param settled Trạng thái đã settle hay chưa
     * @param filledAmount Số lượng đã được fill trong trade này (6 decimals normalized)
     * @param buyerCollateral Số collateral buyer đã lock
     * @param sellerCollateral Số collateral seller đã lock
     */
    struct MatchedTrade {
        PreOrder buyer;
        PreOrder seller;
        address targetToken;
        uint256 matchTime;
        bool settled;
        uint256 filledAmount; // 6 decimals (normalized)
        uint256 buyerCollateral;
        uint256 sellerCollateral;
    }

    // ============ Storage ============
    mapping(uint256 => MatchedTrade) public trades;
    mapping(bytes32 => bool) public usedOrderHashes; // Track used order hashes instead of nonces

    // ============ PARTIAL FILL TRACKING ============
    /**
     * @notice Track filled amount cho mỗi order
     * @dev orderHash => filled amount
     */
    mapping(bytes32 => uint256) public orderFilled;

    /**
     * @notice Minimum fill amount để tránh dust orders
     */
    uint256 public minimumFillAmount; // Will be set in initializer: 0.001 token default

    /**
     * @notice Track total locked collateral per token (keep for protocol monitoring)
     */
    mapping(address => uint256) public totalLockedCollateral;

    // ============ FEE PARAMETERS ============
    /**
     * @notice Protocol fee trong basis points (max 100 = 1%)
     * @dev Thu fee từ cả settle và cancel operations
     */
    uint256 public protocolFeeBps; // Will be set in initializer: 50 (0.5%)

    /**
     * @notice Treasury address để nhận protocol fees
     */
    address public treasury; // Will be set in initializer

    // ============ Events ============

    /**
     * @notice Phát ra khi có lệnh được khớp thành công
     */
    event OrdersMatched(
        uint256 indexed tradeId,
        bytes32 indexed buyOrderHash,
        bytes32 indexed sellOrderHash,
        address buyer,
        address seller,
        bytes32 targetTokenId,
        uint256 amount,
        uint256 price,
        address collateralToken,
        uint256 filledAmount,
        uint256 buyerTotalFilled,
        uint256 sellerTotalFilled,
        uint256 buyerCollateral,
        uint256 sellerCollateral
    );

    /**
     * @notice Phát ra khi giao dịch được settle
     */
    event TradeSettled(
        uint256 indexed tradeId,
        address indexed targetToken,
        uint256 sellerReward,
        bool isLate
    );

    /**
     * @notice Phát ra khi buyer cancel giao dịch do seller không fulfill
     */
    event TradeCancelled(
        uint256 indexed tradeId,
        address indexed buyer,
        uint256 penaltyAmount,
        address indexed collateralToken
    );

    /**
     * @notice Phát ra khi partial fill một order
     */
    event OrderPartiallyFilled(
        bytes32 indexed orderHash,
        address indexed trader,
        uint256 filledAmount,
        uint256 remainingAmount
    );

    /**
     * @notice Phát ra khi order được cancel
     */
    event OrderCancelled(
        bytes32 indexed orderHash,
        address indexed trader,
        uint256 cancelledAmount
    );

    event TokenMarketCreated(
        bytes32 indexed tokenId,
        string symbol,
        string name,
        uint256 settleTimeLimit
    );

    event SettleTimeUpdated(
        bytes32 indexed tokenId,
        uint256 oldSettleTime,
        uint256 newSettleTime
    );

    event TokenMapped(bytes32 indexed tokenId, address indexed realAddress);

    event CollateralRatioUpdated(
        uint256 oldBuyerRatio,
        uint256 newBuyerRatio,
        uint256 oldSellerRatio,
        uint256 newSellerRatio
    );

    event EconomicParametersUpdated(
        uint256 sellerRewardBps,
        uint256 latePenaltyBps
    );

    event CollateralLocked(
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 tradeId
    );

    event CollateralUnlocked(
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 tradeId
    );

    event ContractUpgraded(
        address indexed oldImplementation,
        address indexed newImplementation,
        string version
    );

    /**
     * @notice Phát ra khi protocol fee được collect
     */
    event ProtocolFeeCollected(
        uint256 indexed tradeId,
        address indexed collateralToken,
        address indexed treasury,
        uint256 feeAmount,
        string operation
    );

    // ============ Errors ============
    error InvalidSignature();
    error OrderExpired();
    error OrderAlreadyUsed();
    error IncompatibleOrders();
    error InsufficientCollateral();
    error TradeNotFound();
    error TradeAlreadySettled();
    error GracePeriodNotExpired();
    error OnlyBuyerCanCancel();
    error OnlySellerCanSettle();
    error TokenTransferFailed();
    error InvalidFillAmount();
    error ExceedOrderAmount();
    error BelowMinimumFill();
    error PriceOutOfBounds();
    error TokenNotExists();
    error TokenAlreadyMapped();
    error InvalidTokenAddress();
    error DuplicateSymbol();
    error InvalidCollateralRatio();
    error InvalidRewardParameters();
    error ZeroAmount();
    error SelfTrade();

    // ============ Initializer ============

    /**
     * @notice Initialize contract với domain separator cho EIP-712 và vault address
     * @param _vault Địa chỉ của EscrowVault contract
     * @param _admin Địa chỉ admin sẽ nhận các role
     * @param _treasury Địa chỉ treasury để nhận fees (có thể là address(0) để disable fee)
     */
    function initialize(
        address _vault,
        address _admin,
        address _treasury
    ) public initializer {
        if (_vault == address(0)) revert InvalidTokenAddress();
        if (_admin == address(0)) revert InvalidTokenAddress();

        // Initialize parent contracts
        __AccessControl_init();
        __ReentrancyGuard_init();
        __EIP712_init("PreMarketTrade", "1");
        __Pausable_init();
        __UUPSUpgradeable_init();

        // Set vault (can't use immutable in upgradeable contracts)
        vault = EscrowVault(_vault);

        // Initialize economic parameters (moved from declaration to fix upgrade safety)
        buyerCollateralRatio = 100; // 100% of trade value
        sellerCollateralRatio = 100; // 100% of trade value (asymmetric)
        sellerRewardBps = 0; // 0% reward for fulfilling
        latePenaltyBps = 10000; // 100% penalty for late settlement
        minimumFillAmount = 1e3; // 0.001 token default

        // Initialize fee parameters
        protocolFeeBps = 50; // 0.5% default fee
        treasury = _treasury; // Can be address(0) to disable fees

        // Grant roles to admin
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(RELAYER_ROLE, _admin);
        _grantRole(EMERGENCY_ROLE, _admin);
    }

    // ============ External Functions ============

    /**
     * @notice Khớp hai lệnh buy/sell hợp lệ với partial fill support
     * @dev Chỉ relayer được phép gọi function này
     * @param buyOrder Order của buyer
     * @param sellOrder Order của seller
     * @param fillAmount Số lượng muốn fill (0 = auto calculate max possible)
     * @return tradeId ID của giao dịch mới tạo
     */
    function matchOrders(
        PreOrder calldata buyOrder,
        PreOrder calldata sellOrder,
        uint256 fillAmount
    )
        external
        onlyRole(RELAYER_ROLE)
        nonReentrant
        whenNotPaused
        returns (uint256 tradeId)
    {
        // Basic validations
        _validateOrdersCompatibility(buyOrder, sellOrder);
        // _verifySignature(buyOrder, sigBuy);
        // _verifySignature(sellOrder, sigSell);

        // Calculate and validate fill amount
        uint256 actualFillAmount = _calculateFillAmount(
            buyOrder,
            sellOrder,
            fillAmount
        );
        if (actualFillAmount == 0) revert InvalidFillAmount();
        if (actualFillAmount < minimumFillAmount) revert BelowMinimumFill();

        // Process the fill
        return _processFill(buyOrder, sellOrder, actualFillAmount);
    }

    /**
     * @dev Internal function to process the actual fill - FIXED REENTRANCY PATTERN
     */
    function _processFill(
        PreOrder calldata buyOrder,
        PreOrder calldata sellOrder,
        uint256 actualFillAmount
    ) internal virtual returns (uint256 tradeId) {
        // Cache order hashes to save gas
        bytes32 buyOrderHash = _hashTypedDataV4(_getOrderStructHash(buyOrder));
        bytes32 sellOrderHash = _hashTypedDataV4(
            _getOrderStructHash(sellOrder)
        );

        // Calculate collateral amounts with price scaling (price is wei6)
        uint256 tradeValue = _calculateTradeValue(
            actualFillAmount,
            buyOrder.price
        );
        uint256 buyerCollateralAmount = (tradeValue * buyerCollateralRatio) /
            100;
        uint256 sellerCollateralAmount = (tradeValue * sellerCollateralRatio) /
            100;

        // UPDATE STATE FIRST (Reentrancy protection)
        orderFilled[buyOrderHash] += actualFillAmount;
        orderFilled[sellOrderHash] += actualFillAmount;

        // Check if orders are fully filled, then mark as used
        if (orderFilled[buyOrderHash] == buyOrder.amount) {
            usedOrderHashes[buyOrderHash] = true;
        }
        if (orderFilled[sellOrderHash] == sellOrder.amount) {
            usedOrderHashes[sellOrderHash] = true;
        }

        // Update total collateral tracking (keep for protocol monitoring)
        totalLockedCollateral[buyOrder.collateralToken] +=
            buyerCollateralAmount +
            sellerCollateralAmount;

        // Create trade record
        tradeId = ++tradeCounter;
        trades[tradeId] = MatchedTrade({
            buyer: buyOrder,
            seller: sellOrder,
            targetToken: address(0),
            matchTime: block.timestamp,
            settled: false,
            filledAmount: actualFillAmount,
            buyerCollateral: buyerCollateralAmount,
            sellerCollateral: sellerCollateralAmount
        });

        // EXTERNAL CALLS LAST (After state updates)
        vault.slashBalance(
            buyOrder.trader,
            buyOrder.collateralToken,
            buyerCollateralAmount
        );
        vault.slashBalance(
            sellOrder.trader,
            sellOrder.collateralToken,
            sellerCollateralAmount
        );

        // Emit events
        emit CollateralLocked(
            buyOrder.trader,
            buyOrder.collateralToken,
            buyerCollateralAmount,
            tradeId
        );
        emit CollateralLocked(
            sellOrder.trader,
            sellOrder.collateralToken,
            sellerCollateralAmount,
            tradeId
        );

        emit OrdersMatched(
            tradeId,
            buyOrderHash,
            sellOrderHash,
            buyOrder.trader,
            sellOrder.trader,
            buyOrder.targetTokenId,
            buyOrder.amount,
            buyOrder.price,
            buyOrder.collateralToken,
            actualFillAmount,
            orderFilled[buyOrderHash],
            orderFilled[sellOrderHash],
            buyerCollateralAmount,
            sellerCollateralAmount
        );

        // Emit partial fill events if needed
        if (orderFilled[buyOrderHash] < buyOrder.amount) {
            emit OrderPartiallyFilled(
                buyOrderHash,
                buyOrder.trader,
                actualFillAmount,
                buyOrder.amount - orderFilled[buyOrderHash]
            );
        }

        if (orderFilled[sellOrderHash] < sellOrder.amount) {
            emit OrderPartiallyFilled(
                sellOrderHash,
                sellOrder.trader,
                actualFillAmount,
                sellOrder.amount - orderFilled[sellOrderHash]
            );
        }
    }

    /**
     * @notice Settle giao dịch bằng cách giao token thật - SIMPLIFIED VERSION
     * @dev Token phải được mapped trước bởi admin
     * @param tradeId ID của giao dịch cần settle
     */
    function settle(uint256 tradeId) external nonReentrant whenNotPaused {
        // Cache trade to memory for gas optimization
        MatchedTrade memory trade = trades[tradeId];

        // Validations
        if (trade.buyer.trader == address(0)) revert TradeNotFound();
        if (trade.settled) revert TradeAlreadySettled();
        if (msg.sender != trade.seller.trader) revert OnlySellerCanSettle();

        // Get token info và verify đã được mapped
        TokenInfo memory tokenInfo = tokens[trade.buyer.targetTokenId];
        if (!tokenInfo.exists) revert TokenNotExists();
        if (tokenInfo.realAddress == address(0)) revert TokenAlreadyMapped(); // Reuse error, means "not mapped yet"

        address targetToken = tokenInfo.realAddress;

        // Check grace period
        uint256 settleTimeLimit = tokenInfo.settleTimeLimit;
        bool isLate = block.timestamp > trade.matchTime + settleTimeLimit;

        // if (isLate) {
        //     revert GracePeriodNotExpired();
        // }

        // Calculate rewards, penalties and fees
        uint256 sellerReward = _calculateRewardOrPenalty(
            trade.filledAmount,
            trade.buyer.price,
            sellerRewardBps
        );
        uint256 protocolFee = _calculateProtocolFee(
            trade.filledAmount,
            trade.buyer.price
        );
        // Scale filledAmount to target token decimals
        uint256 actualTargetAmount = _scaleAmount(
            trade.filledAmount,
            uint8(AMOUNT_DECIMALS),
            tokenInfo.decimals
        );
        
        uint256 buyerFee = _calculateBuyerFeeOnTargetToken(actualTargetAmount);

        // UPDATE STATE FIRST (Reentrancy protection)
        trades[tradeId].settled = true;
        trades[tradeId].targetToken = targetToken;

        // Update total collateral tracking
        totalLockedCollateral[trade.buyer.collateralToken] -= (trade
            .buyerCollateral + trade.sellerCollateral);

        // EXTERNAL CALLS LAST
        // Transfer target token from seller to buyer (trừ buyer fee)
        uint256 buyerReceives = actualTargetAmount - buyerFee;
        IERC20(targetToken).safeTransferFrom(
            trade.seller.trader,
            trade.buyer.trader,
            buyerReceives
        );

        // Transfer buyer fee to treasury (target token)
        if (buyerFee > 0 && treasury != address(0)) {
            IERC20(targetToken).safeTransferFrom(
                trade.seller.trader,
                treasury,
                buyerFee
            );

            emit ProtocolFeeCollected(
                tradeId,
                targetToken,
                treasury,
                buyerFee,
                "settle_buyer"
            );
        }

        // Release collateral and pay rewards (trừ protocol fee)
        uint256 totalRelease = trade.buyerCollateral +
            trade.sellerCollateral +
            sellerReward -
            protocolFee;
        vault.transferOut(
            trade.buyer.collateralToken,
            trade.seller.trader,
            totalRelease
        );

        // Transfer protocol fee to treasury (collateral token)
        if (protocolFee > 0 && treasury != address(0)) {
            vault.transferOut(
                trade.buyer.collateralToken,
                treasury,
                protocolFee
            );

            emit ProtocolFeeCollected(
                tradeId,
                trade.buyer.collateralToken,
                treasury,
                protocolFee,
                "settle_seller"
            );
        }

        // Emit events
        emit CollateralUnlocked(
            trade.buyer.trader,
            trade.buyer.collateralToken,
            trade.buyerCollateral,
            tradeId
        );
        emit CollateralUnlocked(
            trade.seller.trader,
            trade.buyer.collateralToken,
            trade.sellerCollateral,
            tradeId
        );
        emit TradeSettled(
            tradeId, 
            targetToken, 
            sellerReward, 
            isLate
        );
    }

    /**
     * @notice Hủy giao dịch sau grace period nếu seller không fulfill - IMPROVED
     * @dev Chỉ buyer mới có thể cancel và chỉ sau khi grace period hết hạn
     * @param tradeId ID của giao dịch cần cancel
     */
    function cancelAfterGracePeriod(
        uint256 tradeId
    ) external nonReentrant whenNotPaused {
        // Cache trade to memory
        MatchedTrade memory trade = trades[tradeId];

        // Validations
        if (trade.buyer.trader == address(0)) revert TradeNotFound();
        if (trade.settled) revert TradeAlreadySettled();
        if (msg.sender != trade.buyer.trader) revert OnlyBuyerCanCancel();

        TokenInfo memory tokenInfo = tokens[trade.buyer.targetTokenId];
        if (!tokenInfo.exists) revert TokenNotExists();

        uint256 settleTimeLimit = tokenInfo.settleTimeLimit;
        if (block.timestamp <= trade.matchTime + settleTimeLimit) {
            revert GracePeriodNotExpired();
        }

        // Calculate penalty and fee
        uint256 sellerPenalty = _calculateRewardOrPenalty(
            trade.filledAmount,
            trade.buyer.price,
            latePenaltyBps
        );
        uint256 penaltyAmount = sellerPenalty > trade.sellerCollateral
            ? trade.sellerCollateral
            : sellerPenalty;
        
        // Protocol fee gấp đôi để tương đương economic với settle (seller fee + buyer fee)
        uint256 baseFee = _calculateProtocolFee(
            trade.filledAmount,
            trade.buyer.price
        );
        uint256 totalProtocolFee = baseFee * 2; // 2x để tương đương settle

        // UPDATE STATE FIRST
        trades[tradeId].settled = true;

        // Update total collateral tracking
        totalLockedCollateral[trade.buyer.collateralToken] -= (trade
            .buyerCollateral + trade.sellerCollateral);

        // EXTERNAL CALLS LAST
        // Calculate distributions - protocol fee được lấy từ tổng collateral pool
        uint256 totalCollateral = trade.buyerCollateral + trade.sellerCollateral;
        uint256 availableForDistribution = totalCollateral > totalProtocolFee 
            ? totalCollateral - totalProtocolFee 
            : 0;
        
        // Penalty amount từ available collateral (after protocol fee)
        uint256 maxPenalty = availableForDistribution > trade.buyerCollateral 
            ? availableForDistribution - trade.buyerCollateral 
            : 0;
        uint256 actualPenaltyAmount = penaltyAmount > maxPenalty 
            ? maxPenalty 
            : penaltyAmount;

        // Return buyer collateral + penalty
        vault.transferOut(
            trade.buyer.collateralToken,
            trade.buyer.trader,
            trade.buyerCollateral + actualPenaltyAmount
        );

        // Return remaining seller collateral
        uint256 sellerRemaining = availableForDistribution > (trade.buyerCollateral + actualPenaltyAmount)
            ? availableForDistribution - (trade.buyerCollateral + actualPenaltyAmount)
            : 0;
        if (sellerRemaining > 0) {
            vault.transferOut(
                trade.buyer.collateralToken,
                trade.seller.trader,
                sellerRemaining
            );
        }

        // Transfer protocol fee to treasury
        if (totalProtocolFee > 0 && treasury != address(0)) {
            vault.transferOut(
                trade.buyer.collateralToken,
                treasury,
                totalProtocolFee
            );

            emit ProtocolFeeCollected(
                tradeId,
                trade.buyer.collateralToken,
                treasury,
                totalProtocolFee,
                "cancel"
            );
        }

        // Emit events
        emit CollateralUnlocked(
            trade.buyer.trader,
            trade.buyer.collateralToken,
            trade.buyerCollateral,
            tradeId
        );
        emit CollateralUnlocked(
            trade.seller.trader,
            trade.buyer.collateralToken,
            trade.sellerCollateral,
            tradeId
        );
        emit TradeCancelled(
            tradeId,
            trade.buyer.trader,
            actualPenaltyAmount,
            trade.buyer.collateralToken
        );
    }

    /**
     * @notice Cancel order trước khi được match - NEW FEATURE
     * @param order Order cần cancel
     * @param signature Signature của order
     */
    function cancelOrder(
        PreOrder calldata order,
        bytes calldata signature
    ) external nonReentrant whenNotPaused {
        // Verify signature and ownership
        _verifySignature(order, signature);

        if (msg.sender != order.trader) revert InvalidSignature();

        bytes32 orderHash = _hashTypedDataV4(_getOrderStructHash(order));

        // Check if order still has remaining amount
        uint256 remainingAmount = order.amount - orderFilled[orderHash];
        if (remainingAmount == 0) revert OrderAlreadyUsed();

        // Mark order as fully used
        usedOrderHashes[orderHash] = true;
        orderFilled[orderHash] = order.amount;

        emit OrderCancelled(orderHash, order.trader, remainingAmount);
    }

    // ============ View Functions ============

    /**
     * @notice Lấy thông tin chi tiết của một giao dịch
     * @param tradeId ID của giao dịch
     * @return trade Thông tin giao dịch
     */
    function getTrade(
        uint256 tradeId
    ) external view returns (MatchedTrade memory trade) {
        return trades[tradeId];
    }

    /**
     * @notice Kiểm tra xem order hash đã được sử dụng chưa
     * @param orderHash Hash của order cần kiểm tra
     * @return used true nếu đã sử dụng
     */
    function isOrderHashUsed(
        bytes32 orderHash
    ) external view returns (bool used) {
        return usedOrderHashes[orderHash];
    }

    /**
     * @notice Tính hash của order để verify signature
     * @param order Order cần hash
     * @return hash Hash theo chuẩn EIP-712
     */
    function getOrderHash(
        PreOrder calldata order
    ) external view returns (bytes32 hash) {
        return _hashTypedDataV4(_getOrderStructHash(order));
    }

    /**
     * @notice Lấy số lượng đã fill của một order
     * @param orderHash Hash của order
     * @return filled Số lượng đã fill
     */
    function getOrderFilledAmount(
        bytes32 orderHash
    ) external view returns (uint256 filled) {
        return orderFilled[orderHash];
    }

    /**
     * @notice Lấy số lượng còn lại có thể fill của một order
     * @param order Order cần check
     * @return remaining Số lượng còn lại
     */
    function getRemainingAmount(
        PreOrder calldata order
    ) external view returns (uint256 remaining) {
        bytes32 orderHash = _hashTypedDataV4(_getOrderStructHash(order));
        return order.amount - orderFilled[orderHash];
    }

    /**
     * @notice Get token info by ID
     */
    function getTokenInfo(
        bytes32 tokenId
    ) external view returns (TokenInfo memory) {
        return tokens[tokenId];
    }

    /**
     * @notice Get token ID by symbol
     */
    function getTokenIdBySymbol(
        string calldata symbol
    ) external view returns (bytes32) {
        return symbolToTokenId[symbol];
    }

    /**
     * @notice Enhanced order validation với decimals check
     */
    function isOrderValid(
        PreOrder calldata order
    ) external view returns (bool valid, string memory reason) {
        bytes32 orderHash = _hashTypedDataV4(_getOrderStructHash(order));

        if (usedOrderHashes[orderHash]) {
            return (false, "Order already used");
        }

        if (orderFilled[orderHash] >= order.amount) {
            return (false, "Order fully filled");
        }

        if (block.timestamp > order.deadline) {
            return (false, "Order expired");
        }

        TokenInfo memory tokenInfo = tokens[order.targetTokenId];
        if (!tokenInfo.exists) {
            return (false, "Token not exists");
        }

        if (order.price < MIN_PRICE_RATIO || order.price > MAX_PRICE_RATIO) {
            return (false, "Price out of bounds");
        }

        // Validate if token is mapped and check amount precision
        if (tokenInfo.realAddress != address(0)) {
            uint8 targetDecimals = tokenInfo.decimals;
            
            // Check if scaled amount makes sense
            uint256 actualTargetAmount = _scaleAmount(order.amount, uint8(AMOUNT_DECIMALS), targetDecimals);
            if (actualTargetAmount == 0) {
                return (false, "Amount too small for target token decimals");
            }
            
            // Check for precision loss warning
            uint256 scaledBack = _scaleAmount(actualTargetAmount, targetDecimals, uint8(AMOUNT_DECIMALS));
            if (scaledBack != order.amount) {
                return (false, "Precision loss in amount scaling");
            }
        }

        return (true, "");
    }

    /**
     * @notice Calculate trade value preview cho client - ENHANCED FUNCTION
     * @dev Giúp client estimate trade value trước khi submit order
     * @param amount Số lượng token muốn trade (6 decimals normalized)
     * @param priceInDecimals Giá với decimals của collateral token
     * @return tradeValue Giá trị giao dịch (collateral decimals)
     * @return buyerCollateral Collateral buyer cần
     * @return sellerCollateral Collateral seller cần
     */
    function calculateTradeValuePreview(
        uint256 amount,
        uint256 priceInDecimals
    )
        external
        view
        returns (
            uint256 tradeValue,
            uint256 buyerCollateral,
            uint256 sellerCollateral
        )
    {
        tradeValue = _calculateTradeValue(amount, priceInDecimals);
        buyerCollateral = (tradeValue * buyerCollateralRatio) / 100;
        sellerCollateral = (tradeValue * sellerCollateralRatio) / 100;
    }

    // ============ Internal Functions ============

    /**
     * @notice Calculate trade value với đúng decimals của collateral token
     * @dev Simplified approach: price đã có decimals của collateral token
     * @param amount Amount với 6 decimals (normalized)
     * @param priceInDecimals Price với decimals của collateral token
     * @return tradeValue Trade value với decimals của collateral token
     */
    function _calculateTradeValue(
        uint256 amount,
        uint256 priceInDecimals
    ) internal pure returns (uint256 tradeValue) {
        // Kiểm tra overflow
        require(
            amount <= type(uint256).max / priceInDecimals,
            "Trade value overflow"
        );

        // Calculate trade value:
        // amount (6 decimals) * price (collateral decimals) / AMOUNT_SCALE (6 decimals)
        // = collateral decimals (đúng!)
        tradeValue = amount * priceInDecimals / AMOUNT_SCALE;

        return tradeValue;
    }

    /**
     * @notice Scale amount between different decimals
     * @param amount Amount to scale
     * @param fromDecimals Current decimals
     * @param toDecimals Target decimals
     * @return scaledAmount Scaled amount
     */
    function _scaleAmount(
        uint256 amount,
        uint8 fromDecimals,
        uint8 toDecimals
    ) internal pure returns (uint256 scaledAmount) {
        if (fromDecimals == toDecimals) {
            return amount;
        }
        
        if (toDecimals > fromDecimals) {
            // Scale up
            uint256 scaleFactor = 10 ** (toDecimals - fromDecimals);
            scaledAmount = amount * scaleFactor;
        } else {
            // Scale down  
            uint256 scaleFactor = 10 ** (fromDecimals - toDecimals);
            scaledAmount = amount / scaleFactor;
        }
        
        return scaledAmount;
    }

    /**
     * @notice Calculate reward hoặc penalty với safe math
     * @dev Tránh overflow khi nhân 3 số lớn và handle precision đúng
     * @param filledAmount Số lượng đã fill (6 decimals)
     * @param priceInDecimals Giá với decimals của collateral token
     * @param basisPoints Basis points (0-10000)
     * @return result Kết quả sau khi tính toán (collateral decimals)
     */
    function _calculateRewardOrPenalty(
        uint256 filledAmount,
        uint256 priceInDecimals,
        uint256 basisPoints
    ) internal pure returns (uint256 result) {
        // Nếu basisPoints = 0, không có reward/penalty
        if (basisPoints == 0) {
            return 0;
        }

        // Kiểm tra overflow trước khi tính
        uint256 tradeValue = _calculateTradeValue(filledAmount, priceInDecimals);

        // Safe calculation với basis points - chỉ check khi basisPoints > 0
        require(
            tradeValue <= type(uint256).max / basisPoints,
            "Reward calculation overflow"
        );

        result = (tradeValue * basisPoints) / 10000;
        return result;
    }

    /**
     * @notice Calculate protocol fee based on trade value
     * @dev Internal function để tính fee cho settle và cancel operations
     * @param filledAmount Số lượng token đã fill (6 decimals)
     * @param priceInDecimals Giá với decimals của collateral token
     * @return feeAmount Protocol fee amount (collateral decimals)
     */
    function _calculateProtocolFee(
        uint256 filledAmount,
        uint256 priceInDecimals
    ) internal view returns (uint256 feeAmount) {
        if (protocolFeeBps == 0 || treasury == address(0)) {
            return 0;
        }

        uint256 tradeValue = _calculateTradeValue(filledAmount, priceInDecimals);
        feeAmount = (tradeValue * protocolFeeBps) / 10000;

        return feeAmount;
    }

    /**
     * @notice Calculate buyer fee trên target token
     * @dev Internal function để tính buyer fee bằng target token khi settle
     * @param actualTargetAmount Số lượng token buyer nhận được (target token decimals)
     * @return buyerFeeAmount Buyer fee amount (target token decimals)
     */
    function _calculateBuyerFeeOnTargetToken(
        uint256 actualTargetAmount
    ) internal view returns (uint256 buyerFeeAmount) {
        if (protocolFeeBps == 0 || treasury == address(0)) {
            return 0;
        }

        buyerFeeAmount = (actualTargetAmount * protocolFeeBps) / 10000;
        return buyerFeeAmount;
    }

    /**
     * @dev Validate tính tương thích của hai orders với enhanced checks
     */
    function _validateOrdersCompatibility(
        PreOrder calldata buyOrder,
        PreOrder calldata sellOrder
    ) internal view {
        // Basic order type validation
        if (!buyOrder.isBuy || sellOrder.isBuy) revert IncompatibleOrders();

        // Price validation with bounds
        if (buyOrder.price != sellOrder.price) revert IncompatibleOrders();
        if (buyOrder.price < MIN_PRICE_RATIO || buyOrder.price > MAX_PRICE_RATIO)
            revert PriceOutOfBounds();

        // Token validation
        if (buyOrder.collateralToken != sellOrder.collateralToken)
            revert IncompatibleOrders();
        if (buyOrder.targetTokenId != sellOrder.targetTokenId)
            revert IncompatibleOrders();

        // Time validation
        if (
            block.timestamp > buyOrder.deadline ||
            block.timestamp > sellOrder.deadline
        ) {
            revert OrderExpired();
        }

        // Amount validation
        if (buyOrder.amount == 0 || sellOrder.amount == 0) revert ZeroAmount();

        // Self-trade prevention
        if (buyOrder.trader == sellOrder.trader) revert SelfTrade();

        // Token existence validation
        if (!tokens[buyOrder.targetTokenId].exists) revert TokenNotExists();
    }

    /**
     * @dev Calculate actual fill amount based on remaining amounts - IMPROVED
     */
    function _calculateFillAmount(
        PreOrder calldata buyOrder,
        PreOrder calldata sellOrder,
        uint256 requestedFillAmount
    ) internal view returns (uint256 actualFillAmount) {
        bytes32 buyOrderHash = _hashTypedDataV4(_getOrderStructHash(buyOrder));
        bytes32 sellOrderHash = _hashTypedDataV4(
            _getOrderStructHash(sellOrder)
        );

        uint256 buyRemaining = buyOrder.amount - orderFilled[buyOrderHash];
        uint256 sellRemaining = sellOrder.amount - orderFilled[sellOrderHash];

        if (buyRemaining == 0 || sellRemaining == 0) {
            return 0;
        }

        uint256 maxFillAmount = buyRemaining < sellRemaining
            ? buyRemaining
            : sellRemaining;

        if (requestedFillAmount == 0) {
            // Auto calculate max possible
            actualFillAmount = maxFillAmount;
        } else {
            // Use requested amount but not exceed max
            actualFillAmount = requestedFillAmount > maxFillAmount
                ? maxFillAmount
                : requestedFillAmount;
        }
    }

    /**
     * @dev Verify chữ ký của order với improved validation
     */
    function _verifySignature(
        PreOrder calldata order,
        bytes calldata signature
    ) internal view {
        bytes32 orderHash = _hashTypedDataV4(_getOrderStructHash(order));

        // Check if order hash is already fully used
        if (usedOrderHashes[orderHash]) revert OrderAlreadyUsed();

        // Check if order still has remaining amount
        if (orderFilled[orderHash] >= order.amount) revert OrderAlreadyUsed();

        // Verify signature
        bytes32 digest = _hashTypedDataV4(_getOrderStructHash(order));
        address signer = digest.recover(signature);

        if (signer != order.trader) revert InvalidSignature();
    }

    /**
     * @dev Tạo struct hash cho order theo EIP-712
     */
    function _getOrderStructHash(
        PreOrder calldata order
    ) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    PREORDER_TYPEHASH,
                    order.trader,
                    order.collateralToken,
                    order.targetTokenId,
                    order.amount,
                    order.price,
                    order.isBuy,
                    order.nonce,
                    order.deadline
                )
            );
    }

    // ============ Admin Functions ============

    /**
     * @notice Thêm relayer mới
     * @param relayer Địa chỉ relayer
     */
    function addRelayer(address relayer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(RELAYER_ROLE, relayer);
    }

    /**
     * @notice Xóa relayer
     * @param relayer Địa chỉ relayer
     */
    function removeRelayer(
        address relayer
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(RELAYER_ROLE, relayer);
    }

    /**
     * @notice Update minimum fill amount
     * @param newMinimum New minimum fill amount
     */
    function setMinimumFillAmount(
        uint256 newMinimum
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        minimumFillAmount = newMinimum;
    }

    /**
     * @notice Update collateral ratios - FIXED VALIDATION BOUNDS
     */
    function updateCollateralRatios(
        uint256 newBuyerRatio,
        uint256 newSellerRatio
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newBuyerRatio == 0 || newBuyerRatio > 200)
            revert InvalidCollateralRatio(); // Max 200%
        if (newSellerRatio == 0 || newSellerRatio > 200)
            revert InvalidCollateralRatio(); // Max 200% - FIXED

        emit CollateralRatioUpdated(
            buyerCollateralRatio,
            newBuyerRatio,
            sellerCollateralRatio,
            newSellerRatio
        );

        buyerCollateralRatio = newBuyerRatio;
        sellerCollateralRatio = newSellerRatio;
    }

    /**
     * @notice Update economic parameters - FIXED VALIDATION BOUNDS
     */
    function updateEconomicParameters(
        uint256 newSellerRewardBps,
        uint256 newLatePenaltyBps
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newSellerRewardBps > 1000) revert InvalidRewardParameters(); // Max 10%
        if (newLatePenaltyBps > 10000) revert InvalidRewardParameters(); // Max 100% - FIXED

        sellerRewardBps = newSellerRewardBps;
        latePenaltyBps = newLatePenaltyBps;

        emit EconomicParametersUpdated(newSellerRewardBps, newLatePenaltyBps);
    }

    /**
     * @notice Update protocol fee - NEW ADMIN FUNCTION
     * @dev Áp dụng cho cả collateral fee (seller) và target token fee (buyer)
     * @param newFeeBps New fee in basis points (max 100 = 1%)
     */
    function setProtocolFee(
        uint256 newFeeBps
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newFeeBps > 1000) revert InvalidRewardParameters(); // Max 10%
        protocolFeeBps = newFeeBps;
    }

    /**
     * @notice Update treasury address - NEW ADMIN FUNCTION
     * @param newTreasury New treasury address (address(0) = disable fees)
     */
    function setTreasury(
        address newTreasury
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        treasury = newTreasury;
    }

    /**
     * @notice Pause contract - NEW FUNCTION
     */
    function pause() external onlyRole(EMERGENCY_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause contract - NEW FUNCTION
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /**
     * @notice Emergency function để rút token bị kẹt (chỉ dùng khi cần thiết)
     * @param token Địa chỉ token
     * @param amount Số lượng cần rút
     */
    function emergencyWithdraw(
        address token,
        uint256 amount
    ) external onlyRole(EMERGENCY_ROLE) whenPaused {
        IERC20(token).safeTransfer(msg.sender, amount);
    }

    /**
     * @notice Create token market với improved validation
     */
    function createTokenMarket(
        string calldata symbol,
        string calldata name,
        uint256 settleTimeLimit
    ) external onlyRole(DEFAULT_ADMIN_ROLE) returns (bytes32 tokenId) {
        require(
            settleTimeLimit >= 15 seconds && settleTimeLimit <= 30 days,
            "Invalid settle time"
        );
        require(
            bytes(symbol).length > 0 && bytes(name).length > 0,
            "Empty symbol or name"
        );

        // Check for duplicate symbol
        if (symbolToTokenId[symbol] != bytes32(0)) revert DuplicateSymbol();

        // Generate unique tokenId with counter to prevent collision
        tokenId = keccak256(
            abi.encodePacked(
                symbol,
                name,
                block.chainid,
                msg.sender,
                block.timestamp,
                ++tokenIdCounter
            )
        );

        require(!tokens[tokenId].exists, "TokenId exists");

        tokens[tokenId] = TokenInfo({
            tokenId: tokenId,
            symbol: symbol,
            name: name,
            realAddress: address(0),
            mappingTime: 0,
            settleTimeLimit: settleTimeLimit,
            createdAt: block.timestamp,
            exists: true,
            decimals: 0
        });

        symbolToTokenId[symbol] = tokenId;

        emit TokenMarketCreated(tokenId, symbol, name, settleTimeLimit);
    }

    /**
     * @notice Update settle time với improved validation
     */
    function updateSettleTime(
        bytes32 tokenId,
        uint256 newSettleTime
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!tokens[tokenId].exists) revert TokenNotExists();
        require(
            newSettleTime >= 1 hours && newSettleTime <= 30 days,
            "Invalid settle time"
        );
        if (tokens[tokenId].realAddress != address(0))
            revert TokenAlreadyMapped();

        uint256 oldSettleTime = tokens[tokenId].settleTimeLimit;
        tokens[tokenId].settleTimeLimit = newSettleTime;

        emit SettleTimeUpdated(tokenId, oldSettleTime, newSettleTime);
    }

    /**
     * @notice Map real token address to tokenId - REQUIRED FOR SETTLEMENT
     * @dev Must be called before any settlement can happen
     * @param tokenId ID của token market
     * @param realAddress Địa chỉ token thật đã deploy
     */
    function mapToken(
        bytes32 tokenId,
        address realAddress
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!tokens[tokenId].exists) revert TokenNotExists();
        if (realAddress == address(0)) revert InvalidTokenAddress();
        if (tokens[tokenId].realAddress != address(0))
            revert TokenAlreadyMapped();

        // Get target token decimals
        uint8 targetDecimals;
        try IERC20Metadata(realAddress).decimals() returns (uint8 decimals) {
            targetDecimals = decimals;
        } catch {
            targetDecimals = 18; // Default to 18 decimals
        }

        tokens[tokenId].realAddress = realAddress;
        tokens[tokenId].decimals = targetDecimals;
        tokens[tokenId].mappingTime = block.timestamp;

        emit TokenMapped(tokenId, realAddress);
    }

    /**
     * @notice Check if token is mapped and ready for settlement
     * @param tokenId ID của token cần check
     * @return mapped true nếu đã mapped
     * @return tokenAddress địa chỉ token thật
     */
    function isTokenMapped(
        bytes32 tokenId
    ) external view returns (bool mapped, address tokenAddress) {
        TokenInfo memory tokenInfo = tokens[tokenId];
        return (tokenInfo.realAddress != address(0), tokenInfo.realAddress);
    }

    // ============ Upgrade Authorization ============

    /**
     * @notice Authorize upgrade - chỉ admin mới được upgrade
     * @dev Override từ UUPSUpgradeable để kiểm soát quyền upgrade
     * @param newImplementation Địa chỉ implementation mới
     */
    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(DEFAULT_ADMIN_ROLE) {
        // Enhanced security checks
        require(newImplementation != address(0), "Invalid implementation");
        require(newImplementation != address(this), "Cannot upgrade to self");
        require(
            newImplementation.code.length > 0,
            "Implementation must be contract"
        );

        // Emit upgrade event
        address oldImplementation = ERC1967Utils.getImplementation();
        emit ContractUpgraded(oldImplementation, newImplementation, VERSION);
    }

    /**
     * @notice Get current implementation address
     * @return implementation Current implementation address
     */
    function getImplementation()
        external
        view
        returns (address implementation)
    {
        return ERC1967Utils.getImplementation();
    }

    // ============ Storage Gap ============

    /**
     * @notice Storage gap để tránh collision khi upgrade
     * @dev Giảm số này khi thêm state variables mới
     *
     * Current state variables:
     * - tradeCounter: 1 slot
     * - tokenIdCounter: 1 slot
     * - vault: 1 slot
     * - buyerCollateralRatio: 1 slot
     * - sellerCollateralRatio: 1 slot
     * - sellerRewardBps: 1 slot
     * - latePenaltyBps: 1 slot
     * - protocolFeeBps: 1 slot (NEW)
     * - treasury: 1 slot (NEW)
     * - minimumFillAmount: 1 slot
     * - tokens: 1 slot
     * - symbolToTokenId: 1 slot
     * - trades: 1 slot
     * - usedOrderHashes: 1 slot
     * - orderFilled: 1 slot
     * - totalLockedCollateral: 1 slot
     *
     * Total used: ~16 slots (added 2 new slots)
     * Reserved: 48 slots (reduced from 50)
     */
    uint256[48] private __gap;
}
