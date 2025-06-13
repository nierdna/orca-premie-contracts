// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "./EscrowVault.sol";

/**
 * @title PreMarketTrade
 * @notice Hợp đồng cho phép giao dịch token chưa phát hành với cơ chế collateral bảo mật
 * @dev Sử dụng EIP-712 signatures và collateral locking để đảm bảo an toàn giao dịch
 * @author Blockchain Expert
 */
contract PreMarketTrade is AccessControl, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // ============ Constants ============
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant PREORDER_TYPEHASH = keccak256(
        "PreOrder(address trader,address collateralToken,bytes32 targetTokenId,uint256 amount,uint256 price,bool isBuy,uint256 nonce,uint256 deadline)"
    );

    // ============ State Variables ============
    uint256 public tradeCounter;
    
    /**
     * @notice Reference đến EscrowVault contract
     * @dev Vault quản lý balance nội bộ thay vì transferFrom trực tiếp
     */
    EscrowVault public immutable vault;
    
    // ============ Token Market ============
    struct TokenInfo {
        bytes32 tokenId;
        string symbol;
        string name;
        address realAddress; // address(0) nếu chưa map
        uint256 mappingTime;
        uint256 settleTimeLimit; // seconds
    }

    mapping(bytes32 => TokenInfo) public tokens;

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
        bytes32 targetTokenId; // Thay vì address
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
     */
    struct MatchedTrade {
        PreOrder buyer;
        PreOrder seller;
        address targetToken;
        uint256 matchTime;
        bool settled;
        uint256 filledAmount;
    }

    // ============ Storage ============
    mapping(uint256 => MatchedTrade) public trades;
    mapping(address => mapping(uint256 => bool)) public usedNonces;
    mapping(address => uint256) public lockedCollateral;
    
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

    // ============ Events ============
    
    /**
     * @notice Phát ra khi có lệnh được khớp thành công
     * @param tradeId ID của giao dịch
     * @param buyer Địa chỉ buyer
     * @param seller Địa chỉ seller
     * @param amount Số lượng token
     * @param price Giá giao dịch
     * @param collateralToken Token thế chấp
     * @param filledAmount Số lượng được fill trong lần match này
     * @param buyerTotalFilled Tổng số lượng buyer đã fill
     * @param sellerTotalFilled Tổng số lượng seller đã fill
     */
    event OrdersMatched(
        uint256 indexed tradeId,
        address indexed buyer,
        address indexed seller,
        uint256 amount,
        uint256 price,
        address collateralToken,
        uint256 filledAmount,
        uint256 buyerTotalFilled,
        uint256 sellerTotalFilled
    );

    /**
     * @notice Phát ra khi giao dịch được settle
     * @param tradeId ID của giao dịch
     * @param targetToken Token thật được giao
     */
    event TradeSettled(uint256 indexed tradeId, address targetToken);

    /**
     * @notice Phát ra khi buyer cancel giao dịch do seller không fulfill
     * @param tradeId ID của giao dịch
     * @param buyer Địa chỉ buyer nhận penalty
     */
    event TradeCancelled(uint256 indexed tradeId, address buyer);

    event TokenMarketCreated(bytes32 indexed tokenId, string symbol, string name, uint256 settleTimeLimit);
    event SettleTimeUpdated(bytes32 indexed tokenId, uint256 oldSettleTime, uint256 newSettleTime);

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

    // ============ Constructor ============
    
    /**
     * @notice Khởi tạo contract với domain separator cho EIP-712 và vault address
     * @param _vault Địa chỉ của EscrowVault contract
     */
    constructor(address _vault) EIP712("PreMarketTrade", "1") {
        vault = EscrowVault(_vault);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(RELAYER_ROLE, msg.sender);
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
    function matchOrdersWithAmount(
        PreOrder calldata buyOrder,
        PreOrder calldata sellOrder,
        bytes calldata sigBuy,
        bytes calldata sigSell,
        uint256 fillAmount
    ) external onlyRole(RELAYER_ROLE) nonReentrant returns (uint256 tradeId) {
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
     * @dev Internal function to process the actual fill
     */
    function _processFill(
        PreOrder calldata buyOrder,
        PreOrder calldata sellOrder,
        uint256 actualFillAmount
    ) internal returns (uint256 tradeId) {
        // Update filled tracking
        bytes32 buyOrderHash = _hashTypedDataV4(_getOrderStructHash(buyOrder));
        bytes32 sellOrderHash = _hashTypedDataV4(_getOrderStructHash(sellOrder));
        
        orderFilled[buyOrderHash] += actualFillAmount;
        orderFilled[sellOrderHash] += actualFillAmount;
        
        // Check if orders are fully filled, then mark nonce as used
        if (orderFilled[buyOrderHash] == buyOrder.amount) {
            usedNonces[buyOrder.trader][buyOrder.nonce] = true;
        }
        if (orderFilled[sellOrderHash] == sellOrder.amount) {
            usedNonces[sellOrder.trader][sellOrder.nonce] = true;
        }
        
        // Lock collateral for this fill
        uint256 collateralAmount = actualFillAmount * buyOrder.price;
        vault.slashBalance(buyOrder.trader, buyOrder.collateralToken, collateralAmount);
        vault.slashBalance(sellOrder.trader, sellOrder.collateralToken, collateralAmount);
        lockedCollateral[buyOrder.collateralToken] += collateralAmount * 2;
        
        // Create trade record
        tradeId = ++tradeCounter;
        trades[tradeId] = MatchedTrade({
            buyer: buyOrder,
            seller: sellOrder,
            targetToken: address(0),
            matchTime: block.timestamp,
            settled: false,
            filledAmount: actualFillAmount
        });
        
        emit OrdersMatched(
            tradeId, 
            buyOrder.trader, 
            sellOrder.trader, 
            buyOrder.amount, 
            buyOrder.price, 
            buyOrder.collateralToken,
            actualFillAmount,
            orderFilled[buyOrderHash],
            orderFilled[sellOrderHash]
        );
    }

    /**
     * @notice Backward compatibility - khớp với toàn bộ amount
     * @dev Wrapper function cho relayer cũ
     */  
    function matchOrders(
        PreOrder calldata buyOrder,
        PreOrder calldata sellOrder,
        bytes calldata sigBuy,
        bytes calldata sigSell
    ) external onlyRole(RELAYER_ROLE) nonReentrant returns (uint256 tradeId) {
        // Basic validations
        _validateOrdersCompatibility(buyOrder, sellOrder);
        _verifySignature(buyOrder, sigBuy);
        _verifySignature(sellOrder, sigSell);
        
        // Calculate actual fill amount for full match
        uint256 actualFillAmount = _calculateFillAmount(buyOrder, sellOrder, 0);
        
        // Validate fill amount
        if (actualFillAmount == 0) revert InvalidFillAmount();
        if (actualFillAmount < minimumFillAmount) revert BelowMinimumFill();
        
        // Update filled tracking
        bytes32 buyOrderHash = _hashTypedDataV4(_getOrderStructHash(buyOrder));
        bytes32 sellOrderHash = _hashTypedDataV4(_getOrderStructHash(sellOrder));
        
        orderFilled[buyOrderHash] += actualFillAmount;
        orderFilled[sellOrderHash] += actualFillAmount;
        
        // Check if orders are fully filled, then mark nonce as used
        if (orderFilled[buyOrderHash] == buyOrder.amount) {
            usedNonces[buyOrder.trader][buyOrder.nonce] = true;
        }
        if (orderFilled[sellOrderHash] == sellOrder.amount) {
            usedNonces[sellOrder.trader][sellOrder.nonce] = true;
        }
        
        // Lock collateral for this fill
        uint256 collateralAmount = actualFillAmount * buyOrder.price;
        vault.slashBalance(buyOrder.trader, buyOrder.collateralToken, collateralAmount);
        vault.slashBalance(sellOrder.trader, sellOrder.collateralToken, collateralAmount);
        lockedCollateral[buyOrder.collateralToken] += collateralAmount * 2;
        
        // Create trade record
        tradeId = ++tradeCounter;
        trades[tradeId] = MatchedTrade({
            buyer: buyOrder,
            seller: sellOrder,
            targetToken: address(0),
            matchTime: block.timestamp,
            settled: false,
            filledAmount: actualFillAmount
        });
        
        emit OrdersMatched(
            tradeId, 
            buyOrder.trader, 
            sellOrder.trader, 
            buyOrder.amount, 
            buyOrder.price, 
            buyOrder.collateralToken,
            actualFillAmount,
            orderFilled[buyOrderHash],
            orderFilled[sellOrderHash]
        );
    }

    /**
     * @notice Settle giao dịch bằng cách giao token thật
     * @dev Chỉ seller mới có thể settle trong grace period
     * @param tradeId ID của giao dịch cần settle
     * @param targetToken Địa chỉ token thật được giao
     */
    function settle(uint256 tradeId, address targetToken) external nonReentrant {
        MatchedTrade storage trade = trades[tradeId];
        if (trade.buyer.trader == address(0)) revert TradeNotFound();
        if (trade.settled) revert TradeAlreadySettled();
        if (msg.sender != trade.seller.trader) revert OnlySellerCanSettle();
        
        bytes32 tokenId = trade.buyer.targetTokenId;
        require(tokens[tokenId].settleTimeLimit > 0, "Token not exists");
        
        uint256 settleTimeLimit = tokens[tokenId].settleTimeLimit;
        if (block.timestamp > trade.matchTime + settleTimeLimit) {
            revert GracePeriodNotExpired();
        }
        
        // Use actual filled amount instead of full order amount  
        uint256 collateralAmount = trade.filledAmount * trade.buyer.price;
        
        // Transfer actual filled amount
        IERC20(targetToken).safeTransferFrom(
            trade.seller.trader, 
            trade.buyer.trader, 
            trade.filledAmount
        );
        
        // Release collateral
        vault.transferOut(trade.buyer.collateralToken, trade.seller.trader, collateralAmount * 2);
        
        trade.settled = true;
        trade.targetToken = targetToken;
        lockedCollateral[trade.buyer.collateralToken] -= collateralAmount * 2;
        
        emit TradeSettled(tradeId, targetToken);
    }

    /**
     * @notice Hủy giao dịch sau grace period nếu seller không fulfill
     * @dev Chỉ buyer mới có thể cancel và chỉ sau khi grace period hết hạn
     * @param tradeId ID của giao dịch cần cancel
     */
    function cancelAfterGracePeriod(uint256 tradeId) external nonReentrant {
        MatchedTrade storage trade = trades[tradeId];
        if (trade.buyer.trader == address(0)) revert TradeNotFound();
        if (trade.settled) revert TradeAlreadySettled();
        if (msg.sender != trade.buyer.trader) revert OnlyBuyerCanCancel();
        
        bytes32 tokenId = trade.buyer.targetTokenId;
        require(tokens[tokenId].settleTimeLimit > 0, "Token not exists");
        
        uint256 settleTimeLimit = tokens[tokenId].settleTimeLimit;
        if (block.timestamp <= trade.matchTime + settleTimeLimit) {
            revert GracePeriodNotExpired();
        }
        
        // Use actual filled amount
        uint256 collateralAmount = trade.filledAmount * trade.buyer.price;
        vault.transferOut(trade.buyer.collateralToken, trade.buyer.trader, collateralAmount * 2);
        
        trade.settled = true;
        lockedCollateral[trade.buyer.collateralToken] -= collateralAmount * 2;
        
        emit TradeCancelled(tradeId, trade.buyer.trader);
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
     * @notice Kiểm tra xem nonce đã được sử dụng chưa
     * @param trader Địa chỉ trader
     * @param nonce Nonce cần kiểm tra
     * @return used true nếu đã sử dụng
     */
    function isNonceUsed(address trader, uint256 nonce) 
        external 
        view 
        returns (bool used) 
    {
        return usedNonces[trader][nonce];
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

    // ============ Internal Functions ============

    /**
     * @dev Validate tính tương thích của hai orders (updated for partial fill)
     */
    function _validateOrdersCompatibility(
        PreOrder calldata buyOrder,
        PreOrder calldata sellOrder
    ) internal view {
        if (!buyOrder.isBuy || sellOrder.isBuy) revert IncompatibleOrders();
        if (buyOrder.price != sellOrder.price) revert IncompatibleOrders();
        if (buyOrder.collateralToken != sellOrder.collateralToken) {
            revert IncompatibleOrders();
        }
        if (buyOrder.targetTokenId != sellOrder.targetTokenId) {
            revert IncompatibleOrders();
        }
        if (block.timestamp > buyOrder.deadline) revert OrderExpired();
        if (block.timestamp > sellOrder.deadline) revert OrderExpired();
    }

    /**
     * @dev Calculate actual fill amount based on remaining amounts
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
     * @dev Verify chữ ký của order (updated for partial fill)
     */
    function _verifySignature(
        PreOrder calldata order,
        bytes calldata signature
    ) internal view {
        // Check if order is fully filled (nonce used)
        if (usedNonces[order.trader][order.nonce]) revert OrderAlreadyUsed();
        
        // Check if order still has remaining amount
        bytes32 orderHash = _hashTypedDataV4(_getOrderStructHash(order));
        if (orderFilled[orderHash] >= order.amount) revert OrderAlreadyUsed();
        
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
     * @notice Emergency function để rút token bị kẹt (chỉ dùng khi cần thiết)
     * @param token Địa chỉ token
     * @param amount Số lượng cần rút
     */
    function emergencyWithdraw(address token, uint256 amount) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        IERC20(token).safeTransfer(msg.sender, amount);
    }

    function createTokenMarket(
        string calldata symbol,
        string calldata name,
        uint256 settleTimeLimit
    ) external onlyRole(DEFAULT_ADMIN_ROLE) returns (bytes32 tokenId) {
        require(settleTimeLimit >= 1 hours && settleTimeLimit <= 30 days, "Invalid settle time");
        tokenId = keccak256(abi.encodePacked(symbol, name, block.chainid, msg.sender, block.timestamp));
        require(tokens[tokenId].settleTimeLimit == 0, "TokenId exists");
        tokens[tokenId] = TokenInfo({
            tokenId: tokenId,
            symbol: symbol,
            name: name,
            realAddress: address(0),
            mappingTime: 0,
            settleTimeLimit: settleTimeLimit
        });
        emit TokenMarketCreated(tokenId, symbol, name, settleTimeLimit);
    }

    function updateSettleTime(bytes32 tokenId, uint256 newSettleTime) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(tokens[tokenId].settleTimeLimit > 0, "Token not exists");
        require(newSettleTime >= 1 hours && newSettleTime <= 30 days, "Invalid settle time");
        require(tokens[tokenId].realAddress == address(0), "Cannot update mapped token");
        uint256 oldSettleTime = tokens[tokenId].settleTimeLimit;
        tokens[tokenId].settleTimeLimit = newSettleTime;
        emit SettleTimeUpdated(tokenId, oldSettleTime, newSettleTime);
    }
} 