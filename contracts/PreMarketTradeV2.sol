// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "./PreMarketTrade.sol";

/**
 * @title PreMarketTradeV2
 * @notice Version 2 của PreMarketTrade với các tính năng mới
 * @dev Demonstrates how to upgrade contracts safely
 */
contract PreMarketTradeV2 is PreMarketTrade {
    
    // ============ New State Variables ============
    /**
     * @notice Fee cho mỗi giao dịch (basis points)
     * @dev Thêm vào cuối storage để tránh collision
     */
    uint256 public tradingFeeBps;
    
    /**
     * @notice Treasury address để nhận fees
     */
    address public treasury;
    
    /**
     * @notice Maximum number of fills per order
     */
    uint256 public maxFillsPerOrder;
    
    /**
     * @notice Track number of fills for each order
     */
    mapping(bytes32 => uint256) public orderFillCount;
    
    // ============ New Events ============
    event TradingFeeUpdated(uint256 oldFee, uint256 newFee);
    event TreasuryUpdated(address oldTreasury, address newTreasury);
    event TradingFeeCollected(address indexed token, uint256 amount);
    event MaxFillsPerOrderUpdated(uint256 oldMax, uint256 newMax);
    
    // ============ New Errors ============
    error InvalidFee();
    error InvalidTreasury();
    error MaxFillsExceeded();
    
    // ============ Initialize V2 ============
    
    /**
     * @notice Initialize các tính năng mới cho V2
     * @dev Gọi sau khi upgrade để setup new state variables
     * @param _tradingFeeBps Fee giao dịch (basis points, max 100 = 1%)
     * @param _treasury Address để nhận fees
     * @param _maxFillsPerOrder Maximum fills per order
     */
    function initializeV2(
        uint256 _tradingFeeBps,
        address _treasury,
        uint256 _maxFillsPerOrder
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(tradingFeeBps == 0, "V2 already initialized"); // Prevent re-initialization
        
        if (_tradingFeeBps > 100) revert InvalidFee(); // Max 1%
        if (_treasury == address(0)) revert InvalidTreasury();
        if (_maxFillsPerOrder == 0) revert MaxFillsExceeded();
        
        tradingFeeBps = _tradingFeeBps;
        treasury = _treasury;
        maxFillsPerOrder = _maxFillsPerOrder;
    }
    
    // ============ New Functions ============
    
    /**
     * @notice Set trading fee - V2 FEATURE
     * @param newFeeBps New fee in basis points
     */
    function setTradingFee(uint256 newFeeBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newFeeBps > 100) revert InvalidFee(); // Max 1%
        
        uint256 oldFee = tradingFeeBps;
        tradingFeeBps = newFeeBps;
        
        emit TradingFeeUpdated(oldFee, newFeeBps);
    }
    
    /**
     * @notice Set treasury address - V2 FEATURE
     * @param newTreasury New treasury address
     */
    function setTreasury(address newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newTreasury == address(0)) revert InvalidTreasury();
        
        address oldTreasury = treasury;
        treasury = newTreasury;
        
        emit TreasuryUpdated(oldTreasury, newTreasury);
    }
    
    /**
     * @notice Set max fills per order - V2 FEATURE
     * @param newMax New maximum fills per order
     */
    function setMaxFillsPerOrder(uint256 newMax) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newMax == 0) revert MaxFillsExceeded();
        
        uint256 oldMax = maxFillsPerOrder;
        maxFillsPerOrder = newMax;
        
        emit MaxFillsPerOrderUpdated(oldMax, newMax);
    }
    
    // ============ Override Functions ============
    
    /**
     * @notice Override _processFill để thêm fee logic và fill tracking
     */
    function _processFill(
        PreOrder calldata buyOrder,
        PreOrder calldata sellOrder,
        uint256 actualFillAmount
    ) internal override returns (uint256 tradeId) {
        // Check max fills per order (V2 feature)
        bytes32 buyOrderHash = _hashTypedDataV4(_getOrderStructHash(buyOrder));
        bytes32 sellOrderHash = _hashTypedDataV4(_getOrderStructHash(sellOrder));
        
        if (maxFillsPerOrder > 0) {
            if (orderFillCount[buyOrderHash] >= maxFillsPerOrder) revert MaxFillsExceeded();
            if (orderFillCount[sellOrderHash] >= maxFillsPerOrder) revert MaxFillsExceeded();
        }
        
        // Increment fill count
        orderFillCount[buyOrderHash]++;
        orderFillCount[sellOrderHash]++;
        
        // Calculate trading fee (V2 feature)
        uint256 tradeValue = actualFillAmount * buyOrder.price;
        uint256 tradingFee = (tradeValue * tradingFeeBps) / 10000;
        
        // Call parent _processFill
        tradeId = super._processFill(buyOrder, sellOrder, actualFillAmount);
        
        // Collect trading fee if enabled
        if (tradingFee > 0 && treasury != address(0)) {
            vault.slashBalance(buyOrder.trader, buyOrder.collateralToken, tradingFee);
            vault.transferOut(buyOrder.collateralToken, treasury, tradingFee);
            
            emit TradingFeeCollected(buyOrder.collateralToken, tradingFee);
        }
        
        return tradeId;
    }
    
    /**
     * @notice Get version của contract
     * @return version Current version string
     */
    function getVersion() external pure returns (string memory version) {
        return "2.0.0";
    }
    
    /**
     * @notice Get number of fills for an order - V2 FEATURE
     * @param orderHash Hash của order
     * @return fills Number of fills
     */
    function getOrderFillCount(bytes32 orderHash) external view returns (uint256 fills) {
        return orderFillCount[orderHash];
    }
    
    // ============ Storage Gap Update ============
    /**
     * @notice Updated storage gap for V2
     * @dev Reduced by 4 slots for new state variables
     * Previous: 50 slots, Used: 4 new slots, Remaining: 46 slots
     */
    uint256[46] private __gapV2;
} 