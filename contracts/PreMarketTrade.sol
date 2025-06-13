// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./EscrowVault.sol";

/**
 * @title PreMarketTrade
 * @notice Hợp đồng cho phép giao dịch token chưa phát hành với cơ chế collateral bảo mật
 * @dev Sử dụng EIP-712 signatures và collateral locking để đảm bảo an toàn giao dịch
 * @author Blockchain Expert
 * @custom:security-contact security@premarket.trade
 */
contract PreMarketTrade is AccessControl, ReentrancyGuard, EIP712, Pausable {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // ============ Constants ============
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    bytes32 public constant PREORDER_TYPEHASH = keccak256(
        "PreOrder(address trader,address collateralToken,bytes32 targetTokenId,uint256 amount,uint256 price,bool isBuy,uint256 nonce,uint256 deadline)"
    );

    // ============ State Variables ============
    uint256 public tradeCounter;
    uint256 public tokenIdCounter; // Prevent hash collision
    
    /**
     * @notice Reference đến EscrowVault contract
     * @dev Vault quản lý balance nội bộ thay vì transferFrom trực tiếp
     */
    EscrowVault public immutable vault;
    
    // ============ Price Bounds ============
    uint256 public constant MIN_PRICE = 1e12; // 0.000001 token (6 decimals)
    uint256 public constant MAX_PRICE = 1e30; // Very high but reasonable
    
    // ============ Economic Parameters ============
    uint256 public buyerCollateralRatio = 100; // 100% of trade value
    uint256 public sellerCollateralRatio = 100;  // 100% of trade value (asymmetric)
    uint256 public sellerRewardBps = 0;        // 0% reward for fulfilling
    uint256 public latePenaltyBps = 10000;        // 100% penalty for late settlement
    
    // ============ Token Market ============
    struct TokenInfo {
        bytes32 tokenId;
        string symbol;
        string name;
        address realAddress; // address(0) nếu chưa map
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
     * @param amount Số lượng token thật sẽ giao dịch
     * @param price Giá per unit (trong collateral token)
     * @param isBuy true = BUY order, false = SELL order
     * @param nonce Số sequence để tránh replay attack
     * @param deadline Thời hạn của order
     */
    struct PreOrder {
        address trader;
        address collateralToken;
        bytes32 targetTokenId;
        uint256 amount;
        uint256 price;
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
     * @param filledAmount Số lượng đã được fill trong trade này
     * @param buyerCollateral Số collateral buyer đã lock
     * @param sellerCollateral Số collateral seller đã lock
     */
    struct MatchedTrade {
        PreOrder buyer;
        PreOrder seller;
        address targetToken;
        uint256 matchTime;
        bool settled;
        uint256 filledAmount;
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
    uint256 public minimumFillAmount = 1e15; // 0.001 token default
    
    /**
     * @notice Track locked collateral per user per token
     */
    mapping(address => mapping(address => uint256)) public userLockedCollateral;
    
    /**
     * @notice Track total locked collateral per token
     */
    mapping(address => uint256) public totalLockedCollateral;

    // ============ Events ============
    
    /**
     * @notice Phát ra khi có lệnh được khớp thành công
     */
    event OrdersMatched(
        uint256 indexed tradeId,
        address indexed buyer,
        address indexed seller,
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
        uint256 penaltyAmount
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

    event TokenMapped(
        bytes32 indexed tokenId,
        address indexed realAddress
    );
    
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

    // ============ Constructor ============
    
    /**
     * @notice Khởi tạo contract với domain separator cho EIP-712 và vault address
     * @param _vault Địa chỉ của EscrowVault contract
     */
    constructor(address _vault) EIP712("PreMarketTrade", "1") {
        if (_vault == address(0)) revert InvalidTokenAddress();
        vault = EscrowVault(_vault);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(RELAYER_ROLE, msg.sender);
        _grantRole(EMERGENCY_ROLE, msg.sender);
    }

    // ============ External Functions ============

    /**
     * @notice Khớp hai lệnh buy/sell hợp lệ với partial fill support
     * @dev Chỉ relayer được phép gọi function này
     * @param buyOrder Order của buyer
     * @param sellOrder Order của seller  
     * @param sigBuy Chữ ký của buyer
     * @param sigSell Chữ ký của seller
     * @param fillAmount Số lượng muốn fill (0 = auto calculate max possible)
     * @return tradeId ID của giao dịch mới tạo
     */
    function matchOrders(
        PreOrder calldata buyOrder,
        PreOrder calldata sellOrder,
        bytes calldata sigBuy,
        bytes calldata sigSell,
        uint256 fillAmount
    ) external onlyRole(RELAYER_ROLE) nonReentrant whenNotPaused returns (uint256 tradeId) {
        // Basic validations
        _validateOrdersCompatibility(buyOrder, sellOrder);
        _verifySignature(buyOrder, sigBuy);
        _verifySignature(sellOrder, sigSell);
        
        // Calculate and validate fill amount
        uint256 actualFillAmount = _calculateFillAmount(buyOrder, sellOrder, fillAmount);
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
    ) internal returns (uint256 tradeId) {
        // Cache order hashes to save gas
        bytes32 buyOrderHash = _hashTypedDataV4(_getOrderStructHash(buyOrder));
        bytes32 sellOrderHash = _hashTypedDataV4(_getOrderStructHash(sellOrder));
        
        // Calculate collateral amounts with new economic model
        uint256 tradeValue = actualFillAmount * buyOrder.price;
        uint256 buyerCollateralAmount = (tradeValue * buyerCollateralRatio) / 100;
        uint256 sellerCollateralAmount = (tradeValue * sellerCollateralRatio) / 100;
        
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
        
        // Update collateral tracking
        userLockedCollateral[buyOrder.trader][buyOrder.collateralToken] += buyerCollateralAmount;
        userLockedCollateral[sellOrder.trader][sellOrder.collateralToken] += sellerCollateralAmount;
        totalLockedCollateral[buyOrder.collateralToken] += buyerCollateralAmount + sellerCollateralAmount;
        
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
        vault.slashBalance(buyOrder.trader, buyOrder.collateralToken, buyerCollateralAmount);
        vault.slashBalance(sellOrder.trader, sellOrder.collateralToken, sellerCollateralAmount);
        
        // Emit events
        emit CollateralLocked(buyOrder.trader, buyOrder.collateralToken, buyerCollateralAmount, tradeId);
        emit CollateralLocked(sellOrder.trader, sellOrder.collateralToken, sellerCollateralAmount, tradeId);
        
        emit OrdersMatched(
            tradeId, 
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
        
        if (isLate) {
            revert GracePeriodNotExpired();
        }
        
        // Calculate rewards and penalties
        uint256 sellerReward = (trade.filledAmount * trade.buyer.price * sellerRewardBps) / 10000;
        
        // UPDATE STATE FIRST (Reentrancy protection)
        trades[tradeId].settled = true;
        trades[tradeId].targetToken = targetToken;
        
        // Update collateral tracking
        userLockedCollateral[trade.buyer.trader][trade.buyer.collateralToken] -= trade.buyerCollateral;
        userLockedCollateral[trade.seller.trader][trade.buyer.collateralToken] -= trade.sellerCollateral;
        totalLockedCollateral[trade.buyer.collateralToken] -= (trade.buyerCollateral + trade.sellerCollateral);
        
        // EXTERNAL CALLS LAST
        // Transfer target token from seller to buyer
        IERC20(targetToken).safeTransferFrom(
            trade.seller.trader, 
            trade.buyer.trader, 
            trade.filledAmount
        );
        
        // Release collateral and pay rewards
        uint256 totalRelease = trade.buyerCollateral + trade.sellerCollateral + sellerReward;
        vault.transferOut(trade.buyer.collateralToken, trade.seller.trader, totalRelease);
        
        // Emit events
        emit CollateralUnlocked(trade.buyer.trader, trade.buyer.collateralToken, trade.buyerCollateral, tradeId);
        emit CollateralUnlocked(trade.seller.trader, trade.buyer.collateralToken, trade.sellerCollateral, tradeId);
        emit TradeSettled(tradeId, targetToken, sellerReward, isLate);
    }



    /**
     * @notice Hủy giao dịch sau grace period nếu seller không fulfill - IMPROVED
     * @dev Chỉ buyer mới có thể cancel và chỉ sau khi grace period hết hạn
     * @param tradeId ID của giao dịch cần cancel
     */
    function cancelAfterGracePeriod(uint256 tradeId) external nonReentrant whenNotPaused {
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
        
        // Calculate penalty for seller
        uint256 sellerPenalty = (trade.filledAmount * trade.buyer.price * latePenaltyBps) / 10000;
        uint256 penaltyAmount = sellerPenalty > trade.sellerCollateral ? trade.sellerCollateral : sellerPenalty;
        
        // UPDATE STATE FIRST
        trades[tradeId].settled = true;
        
        // Update collateral tracking
        userLockedCollateral[trade.buyer.trader][trade.buyer.collateralToken] -= trade.buyerCollateral;
        userLockedCollateral[trade.seller.trader][trade.buyer.collateralToken] -= trade.sellerCollateral;
        totalLockedCollateral[trade.buyer.collateralToken] -= (trade.buyerCollateral + trade.sellerCollateral);
        
        // EXTERNAL CALLS LAST
        // Return buyer collateral + penalty from seller
        vault.transferOut(trade.buyer.collateralToken, trade.buyer.trader, trade.buyerCollateral + penaltyAmount);
        
        // Return remaining seller collateral (if any)
        if (trade.sellerCollateral > penaltyAmount) {
            vault.transferOut(trade.buyer.collateralToken, trade.seller.trader, trade.sellerCollateral - penaltyAmount);
        }
        
        // Emit events
        emit CollateralUnlocked(trade.buyer.trader, trade.buyer.collateralToken, trade.buyerCollateral, tradeId);
        emit CollateralUnlocked(trade.seller.trader, trade.buyer.collateralToken, trade.sellerCollateral, tradeId);
        emit TradeCancelled(tradeId, trade.buyer.trader, penaltyAmount);
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
    function getTrade(uint256 tradeId) 
        external 
        view 
        returns (MatchedTrade memory trade) 
    {
        return trades[tradeId];
    }

    /**
     * @notice Kiểm tra xem order hash đã được sử dụng chưa
     * @param orderHash Hash của order cần kiểm tra
     * @return used true nếu đã sử dụng
     */
    function isOrderHashUsed(bytes32 orderHash) 
        external 
        view 
        returns (bool used) 
    {
        return usedOrderHashes[orderHash];
    }

    /**
     * @notice Tính hash của order để verify signature
     * @param order Order cần hash
     * @return hash Hash theo chuẩn EIP-712
     */
    function getOrderHash(PreOrder calldata order) 
        external 
        view 
        returns (bytes32 hash) 
    {
        return _hashTypedDataV4(_getOrderStructHash(order));
    }
    
    /**
     * @notice Lấy số lượng đã fill của một order
     * @param orderHash Hash của order
     * @return filled Số lượng đã fill
     */
    function getOrderFilledAmount(bytes32 orderHash) 
        external 
        view 
        returns (uint256 filled) 
    {
        return orderFilled[orderHash];
    }
    
    /**
     * @notice Lấy số lượng còn lại có thể fill của một order
     * @param order Order cần check
     * @return remaining Số lượng còn lại
     */
    function getRemainingAmount(PreOrder calldata order) 
        external 
        view 
        returns (uint256 remaining) 
    {
        bytes32 orderHash = _hashTypedDataV4(_getOrderStructHash(order));
        return order.amount - orderFilled[orderHash];
    }

    /**
     * @notice Get user's locked collateral amount - NEW VIEW FUNCTION
     */
    function getUserLockedCollateral(address user, address token) 
        external 
        view 
        returns (uint256 locked) 
    {
        return userLockedCollateral[user][token];
    }

    /**
     * @notice Get token info by ID
     */
    function getTokenInfo(bytes32 tokenId) 
        external 
        view 
        returns (TokenInfo memory) 
    {
        return tokens[tokenId];
    }

    /**
     * @notice Get token ID by symbol
     */
    function getTokenIdBySymbol(string calldata symbol) 
        external 
        view 
        returns (bytes32) 
    {
        return symbolToTokenId[symbol];
    }

    /**
     * @notice Check if order is valid and can be filled
     */
    function isOrderValid(PreOrder calldata order) 
        external 
        view 
        returns (bool valid, string memory reason) 
    {
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
        
        if (!tokens[order.targetTokenId].exists) {
            return (false, "Token not exists");
        }
        
        if (order.price < MIN_PRICE || order.price > MAX_PRICE) {
            return (false, "Price out of bounds");
        }
        
        return (true, "");
    }

    // ============ Internal Functions ============

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
        if (buyOrder.price < MIN_PRICE || buyOrder.price > MAX_PRICE) revert PriceOutOfBounds();
        
        // Token validation
        if (buyOrder.collateralToken != sellOrder.collateralToken) revert IncompatibleOrders();
        if (buyOrder.targetTokenId != sellOrder.targetTokenId) revert IncompatibleOrders();
        
        // Time validation
        if (block.timestamp > buyOrder.deadline || block.timestamp > sellOrder.deadline) {
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
        bytes32 sellOrderHash = _hashTypedDataV4(_getOrderStructHash(sellOrder));
        
        uint256 buyRemaining = buyOrder.amount - orderFilled[buyOrderHash];
        uint256 sellRemaining = sellOrder.amount - orderFilled[sellOrderHash];
        
        if (buyRemaining == 0 || sellRemaining == 0) {
            return 0;
        }
        
        uint256 maxFillAmount = buyRemaining < sellRemaining ? buyRemaining : sellRemaining;
        
        if (requestedFillAmount == 0) {
            // Auto calculate max possible
            actualFillAmount = maxFillAmount;
        } else {
            // Use requested amount but not exceed max
            actualFillAmount = requestedFillAmount > maxFillAmount ? maxFillAmount : requestedFillAmount;
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
    function _getOrderStructHash(PreOrder calldata order) 
        internal 
        pure 
        returns (bytes32) 
    {
        return keccak256(abi.encode(
            PREORDER_TYPEHASH,
            order.trader,
            order.collateralToken,
            order.targetTokenId,
            order.amount,
            order.price,
            order.isBuy,
            order.nonce,
            order.deadline
        ));
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
    function removeRelayer(address relayer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(RELAYER_ROLE, relayer);
    }
    
    /**
     * @notice Update minimum fill amount
     * @param newMinimum New minimum fill amount
     */
    function setMinimumFillAmount(uint256 newMinimum) external onlyRole(DEFAULT_ADMIN_ROLE) {
        minimumFillAmount = newMinimum;
    }

    /**
     * @notice Update collateral ratios - FIXED VALIDATION BOUNDS
     */
    function updateCollateralRatios(
        uint256 newBuyerRatio,
        uint256 newSellerRatio
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newBuyerRatio == 0 || newBuyerRatio > 200) revert InvalidCollateralRatio(); // Max 200%
        if (newSellerRatio == 0 || newSellerRatio > 200) revert InvalidCollateralRatio(); // Max 200% - FIXED
        
        emit CollateralRatioUpdated(buyerCollateralRatio, newBuyerRatio, sellerCollateralRatio, newSellerRatio);
        
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
    function emergencyWithdraw(address token, uint256 amount) 
        external 
        onlyRole(EMERGENCY_ROLE) 
        whenPaused
    {
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
        require(settleTimeLimit >= 1 hours && settleTimeLimit <= 30 days, "Invalid settle time");
        require(bytes(symbol).length > 0 && bytes(name).length > 0, "Empty symbol or name");
        
        // Check for duplicate symbol
        if (symbolToTokenId[symbol] != bytes32(0)) revert DuplicateSymbol();
        
        // Generate unique tokenId with counter to prevent collision
        tokenId = keccak256(abi.encodePacked(
            symbol, 
            name, 
            block.chainid, 
            msg.sender, 
            block.timestamp,
            ++tokenIdCounter
        ));
        
        require(!tokens[tokenId].exists, "TokenId exists");
        
        tokens[tokenId] = TokenInfo({
            tokenId: tokenId,
            symbol: symbol,
            name: name,
            realAddress: address(0),
            mappingTime: 0,
            settleTimeLimit: settleTimeLimit,
            createdAt: block.timestamp,
            exists: true
        });
        
        symbolToTokenId[symbol] = tokenId;
        
        emit TokenMarketCreated(tokenId, symbol, name, settleTimeLimit);
    }

    /**
     * @notice Update settle time với improved validation
     */
    function updateSettleTime(bytes32 tokenId, uint256 newSettleTime) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!tokens[tokenId].exists) revert TokenNotExists();
        require(newSettleTime >= 1 hours && newSettleTime <= 30 days, "Invalid settle time");
        if (tokens[tokenId].realAddress != address(0)) revert TokenAlreadyMapped();
        
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
    function mapToken(bytes32 tokenId, address realAddress) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!tokens[tokenId].exists) revert TokenNotExists();
        if (realAddress == address(0)) revert InvalidTokenAddress();
        if (tokens[tokenId].realAddress != address(0)) revert TokenAlreadyMapped();
        
        tokens[tokenId].realAddress = realAddress;
        tokens[tokenId].mappingTime = block.timestamp;
        
        emit TokenMapped(tokenId, realAddress);
    }

    /**
     * @notice Check if token is mapped and ready for settlement
     * @param tokenId ID của token cần check
     * @return mapped true nếu đã mapped
     * @return tokenAddress địa chỉ token thật
     */
    function isTokenMapped(bytes32 tokenId) 
        external 
        view 
        returns (bool mapped, address tokenAddress) 
    {
        TokenInfo memory tokenInfo = tokens[tokenId];
        return (tokenInfo.realAddress != address(0), tokenInfo.realAddress);
    }
} 