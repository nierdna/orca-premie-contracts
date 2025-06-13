// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

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
        "PreOrder(address trader,address collateralToken,uint256 amount,uint256 price,bool isBuy,uint256 nonce,uint256 deadline)"
    );

    // ============ State Variables ============
    uint256 public constant GRACE_PERIOD = 3 days;
    uint256 public tradeCounter;
    
    // ============ Structs ============
    
    /**
     * @notice Cấu trúc đơn hàng pre-market
     * @param trader Địa chỉ người giao dịch
     * @param collateralToken Token dùng làm tài sản thế chấp
     * @param amount Số lượng token thật sẽ giao dịch
     * @param price Giá per unit (trong collateral token)
     * @param isBuy true = BUY order, false = SELL order
     * @param nonce Số sequence để tránh replay attack
     * @param deadline Thời hạn của order
     */
    struct PreOrder {
        address trader;
        address collateralToken;
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
     */
    struct MatchedTrade {
        PreOrder buyer;
        PreOrder seller;
        address targetToken;
        uint256 matchTime;
        bool settled;
    }

    // ============ Storage ============
    mapping(uint256 => MatchedTrade) public trades;
    mapping(address => mapping(uint256 => bool)) public usedNonces;
    mapping(address => uint256) public lockedCollateral;

    // ============ Events ============
    
    /**
     * @notice Phát ra khi có lệnh được khớp thành công
     * @param tradeId ID của giao dịch
     * @param buyer Địa chỉ buyer
     * @param seller Địa chỉ seller
     * @param amount Số lượng token
     * @param price Giá giao dịch
     * @param collateralToken Token thế chấp
     */
    event OrdersMatched(
        uint256 indexed tradeId,
        address indexed buyer,
        address indexed seller,
        uint256 amount,
        uint256 price,
        address collateralToken
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

    // ============ Constructor ============
    
    /**
     * @notice Khởi tạo contract với domain separator cho EIP-712
     */
    constructor() EIP712("PreMarketTrade", "1") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(RELAYER_ROLE, msg.sender);
    }

    // ============ External Functions ============

    /**
     * @notice Khớp hai lệnh buy/sell hợp lệ
     * @dev Chỉ relayer được phép gọi function này
     * @param buyOrder Order của buyer
     * @param sellOrder Order của seller
     * @param sigBuy Chữ ký của buyer
     * @param sigSell Chữ ký của seller
     * @return tradeId ID của giao dịch mới tạo
     */
    function matchOrders(
        PreOrder calldata buyOrder,
        PreOrder calldata sellOrder,
        bytes calldata sigBuy,
        bytes calldata sigSell
    ) external onlyRole(RELAYER_ROLE) nonReentrant returns (uint256 tradeId) {
        // Validate orders compatibility
        _validateOrdersCompatibility(buyOrder, sellOrder);
        
        // Verify signatures
        _verifySignature(buyOrder, sigBuy);
        _verifySignature(sellOrder, sigSell);
        
        // Mark nonces as used
        usedNonces[buyOrder.trader][buyOrder.nonce] = true;
        usedNonces[sellOrder.trader][sellOrder.nonce] = true;
        
        // Calculate collateral needed
        uint256 collateralAmount = buyOrder.amount * buyOrder.price;
        
        // Lock collateral from both parties
        IERC20(buyOrder.collateralToken).safeTransferFrom(
            buyOrder.trader,
            address(this),
            collateralAmount
        );
        
        IERC20(sellOrder.collateralToken).safeTransferFrom(
            sellOrder.trader,
            address(this),
            collateralAmount
        );
        
        // Update locked collateral tracking
        lockedCollateral[buyOrder.collateralToken] += collateralAmount * 2;
        
        // Create matched trade
        tradeId = ++tradeCounter;
        trades[tradeId] = MatchedTrade({
            buyer: buyOrder,
            seller: sellOrder,
            targetToken: address(0), // Will be set during settlement
            matchTime: block.timestamp,
            settled: false
        });
        
        emit OrdersMatched(
            tradeId,
            buyOrder.trader,
            sellOrder.trader,
            buyOrder.amount,
            buyOrder.price,
            buyOrder.collateralToken
        );
    }

    /**
     * @notice Settle giao dịch bằng cách giao token thật
     * @dev Chỉ seller mới có thể settle trong grace period
     * @param tradeId ID của giao dịch cần settle
     * @param targetToken Địa chỉ token thật được giao
     */
    function settle(uint256 tradeId, address targetToken) 
        external 
        nonReentrant 
    {
        MatchedTrade storage trade = trades[tradeId];
        
        // Validate settlement conditions
        if (trade.buyer.trader == address(0)) revert TradeNotFound();
        if (trade.settled) revert TradeAlreadySettled();
        if (msg.sender != trade.seller.trader) revert OnlySellerCanSettle();
        if (block.timestamp > trade.matchTime + GRACE_PERIOD) {
            revert GracePeriodNotExpired();
        }
        
        // Calculate amounts
        uint256 collateralAmount = trade.buyer.amount * trade.buyer.price;
        
        // Transfer target token from seller to buyer
        IERC20(targetToken).safeTransferFrom(
            trade.seller.trader,
            trade.buyer.trader,
            trade.buyer.amount
        );
        
        // Release all collateral to seller (including buyer's collateral as payment)
        IERC20(trade.buyer.collateralToken).safeTransfer(
            trade.seller.trader,
            collateralAmount * 2
        );
        
        // Update state
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
    function cancelAfterGracePeriod(uint256 tradeId) 
        external 
        nonReentrant 
    {
        MatchedTrade storage trade = trades[tradeId];
        
        // Validate cancellation conditions
        if (trade.buyer.trader == address(0)) revert TradeNotFound();
        if (trade.settled) revert TradeAlreadySettled();
        if (msg.sender != trade.buyer.trader) revert OnlyBuyerCanCancel();
        if (block.timestamp <= trade.matchTime + GRACE_PERIOD) {
            revert GracePeriodNotExpired();
        }
        
        // Calculate collateral amount
        uint256 collateralAmount = trade.buyer.amount * trade.buyer.price;
        
        // Return all collateral to buyer as penalty for seller
        IERC20(trade.buyer.collateralToken).safeTransfer(
            trade.buyer.trader,
            collateralAmount * 2
        );
        
        // Update state
        trade.settled = true; // Mark as settled to prevent further actions
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

    // ============ Internal Functions ============

    /**
     * @dev Validate tính tương thích của hai orders
     */
    function _validateOrdersCompatibility(
        PreOrder calldata buyOrder,
        PreOrder calldata sellOrder
    ) internal view {
        if (!buyOrder.isBuy || sellOrder.isBuy) revert IncompatibleOrders();
        if (buyOrder.amount != sellOrder.amount) revert IncompatibleOrders();
        if (buyOrder.price != sellOrder.price) revert IncompatibleOrders();
        if (buyOrder.collateralToken != sellOrder.collateralToken) {
            revert IncompatibleOrders();
        }
        if (block.timestamp > buyOrder.deadline) revert OrderExpired();
        if (block.timestamp > sellOrder.deadline) revert OrderExpired();
    }

    /**
     * @dev Verify chữ ký của order
     */
    function _verifySignature(
        PreOrder calldata order,
        bytes calldata signature
    ) internal view {
        if (usedNonces[order.trader][order.nonce]) revert OrderAlreadyUsed();
        
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
} 