// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title EscrowVault
 * @notice Hệ thống vault quản lý balance nội bộ cho nhiều token của users
 * @dev Cho phép deposit/withdraw và các contract khác (như PreMarketTrade) có thể slash/credit balance
 * @author Blockchain Expert
 */
contract EscrowVault is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Constants ============
    bytes32 public constant TRADER_ROLE = keccak256("TRADER_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // ============ State Variables ============
    
    /**
     * @notice Mapping lưu balance nội bộ: user => token => amount
     * @dev Đây là core storage cho toàn bộ hệ thống vault
     */
    mapping(address => mapping(address => uint256)) public balances;
    
    /**
     * @notice Mapping theo dõi tổng deposit của mỗi token
     * @dev Dùng để reconcile và audit
     */
    mapping(address => uint256) public totalDeposits;

    // ============ Events ============
    
    /**
     * @notice Phát ra khi user deposit token vào vault
     * @param user Địa chỉ user
     * @param token Địa chỉ token
     * @param amount Số lượng deposit
     */
    event Deposited(address indexed user, address indexed token, uint256 amount);

    /**
     * @notice Phát ra khi user withdraw token từ vault
     * @param user Địa chỉ user
     * @param token Địa chỉ token
     * @param amount Số lượng withdraw
     */
    event Withdrawn(address indexed user, address indexed token, uint256 amount);

    /**
     * @notice Phát ra khi balance bị slash (trừ) bởi trader contract
     * @param user Địa chỉ user bị slash
     * @param token Địa chỉ token
     * @param amount Số lượng bị slash
     * @param operator Contract thực hiện slash
     */
    event BalanceSlashed(
        address indexed user,
        address indexed token,
        uint256 amount,
        address indexed operator
    );

    /**
     * @notice Phát ra khi balance được credit (cộng) bởi trader contract
     * @param user Địa chỉ user được credit
     * @param token Địa chỉ token
     * @param amount Số lượng được credit
     * @param operator Contract thực hiện credit
     */
    event BalanceCredited(
        address indexed user,
        address indexed token,
        uint256 amount,
        address indexed operator
    );

    // ============ Errors ============
    error InsufficientBalance();
    error ZeroAmount();
    error TokenTransferFailed();
    error UnauthorizedTrader();

    // ============ Constructor ============
    
    /**
     * @notice Khởi tạo vault với quyền admin
     */
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
    }

    // ============ External Functions ============

    /**
     * @notice Deposit token vào vault và ghi nhận balance nội bộ
     * @dev User cần approve token trước khi gọi function này
     * @param token Địa chỉ token cần deposit
     * @param amount Số lượng token cần deposit
     */
    function deposit(address token, uint256 amount) 
        external 
        nonReentrant 
    {
        if (amount == 0) revert ZeroAmount();
        
        // Transfer token từ user vào vault
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        
        // Cập nhật balance nội bộ
        balances[msg.sender][token] += amount;
        totalDeposits[token] += amount;
        
        emit Deposited(msg.sender, token, amount);
    }

    /**
     * @notice Withdraw token từ vault về địa chỉ user
     * @dev Kiểm tra balance nội bộ trước khi cho phép withdraw
     * @param token Địa chỉ token cần withdraw
     * @param amount Số lượng token cần withdraw
     */
    function withdraw(address token, uint256 amount) 
        external 
        nonReentrant 
    {
        if (amount == 0) revert ZeroAmount();
        if (balances[msg.sender][token] < amount) revert InsufficientBalance();
        
        // Cập nhật balance nội bộ trước
        balances[msg.sender][token] -= amount;
        totalDeposits[token] -= amount;
        
        // Transfer token từ vault về user
        IERC20(token).safeTransfer(msg.sender, amount);
        
        emit Withdrawn(msg.sender, token, amount);
    }

    /**
     * @notice Slash (trừ) balance của user - chỉ dành cho trader contracts
     * @dev Function này được gọi bởi PreMarketTrade khi match orders
     * @param user Địa chỉ user bị slash
     * @param token Địa chỉ token
     * @param amount Số lượng cần slash
     */
    function slashBalance(address user, address token, uint256 amount) 
        external 
        onlyRole(TRADER_ROLE) 
    {
        if (amount == 0) revert ZeroAmount();
        if (balances[user][token] < amount) revert InsufficientBalance();
        
        // Trừ balance của user
        balances[user][token] -= amount;
        
        emit BalanceSlashed(user, token, amount, msg.sender);
    }

    /**
     * @notice Credit (cộng) balance cho user - chỉ dành cho trader contracts
     * @dev Function này được gọi để hoàn trả hoặc thưởng cho user
     * @param user Địa chỉ user được credit
     * @param token Địa chỉ token
     * @param amount Số lượng cần credit
     */
    function creditBalance(address user, address token, uint256 amount) 
        external 
        onlyRole(TRADER_ROLE) 
    {
        if (amount == 0) revert ZeroAmount();
        
        // Cộng balance cho user
        balances[user][token] += amount;
        
        emit BalanceCredited(user, token, amount, msg.sender);
    }

    /**
     * @notice Transfer balance từ user này sang user khác - dành cho trader contracts
     * @dev Dùng cho việc settlement, buyer trả seller
     * @param from Địa chỉ user chuyển
     * @param to Địa chỉ user nhận
     * @param token Địa chỉ token
     * @param amount Số lượng transfer
     */
    function transferBalance(
        address from,
        address to,
        address token,
        uint256 amount
    ) external onlyRole(TRADER_ROLE) {
        if (amount == 0) revert ZeroAmount();
        if (balances[from][token] < amount) revert InsufficientBalance();
        
        // Transfer balance
        balances[from][token] -= amount;
        balances[to][token] += amount;
        
        emit BalanceSlashed(from, token, amount, msg.sender);
        emit BalanceCredited(to, token, amount, msg.sender);
    }

    /**
     * @notice Transfer token trực tiếp từ vault đến user (bypass balance)
     * @dev Chỉ TRADER_ROLE có thể gọi - dùng cho settlement/cancel
     * @param token Địa chỉ token
     * @param to Địa chỉ nhận
     * @param amount Số lượng transfer
     */
    function transferOut(address token, address to, uint256 amount)
        external
        onlyRole(TRADER_ROLE)
    {
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(to, token, amount); // Tái sử dụng event Withdrawn
    }

    // ============ View Functions ============

    /**
     * @notice Lấy balance nội bộ của user cho token cụ thể
     * @param user Địa chỉ user
     * @param token Địa chỉ token
     * @return balance Số dư hiện tại
     */
    function getBalance(address user, address token) 
        external 
        view 
        returns (uint256 balance) 
    {
        return balances[user][token];
    }

    /**
     * @notice Lấy balance của nhiều token cùng lúc cho user
     * @param user Địa chỉ user
     * @param tokens Mảng địa chỉ các token
     * @return userBalances Mảng balance tương ứng
     */
    function getBalances(address user, address[] calldata tokens) 
        external 
        view 
        returns (uint256[] memory userBalances) 
    {
        userBalances = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            userBalances[i] = balances[user][tokens[i]];
        }
    }

    /**
     * @notice Kiểm tra user có đủ balance cho amount cụ thể không
     * @param user Địa chỉ user
     * @param token Địa chỉ token
     * @param amount Số lượng cần kiểm tra
     * @return sufficient true nếu đủ balance
     */
    function hasBalance(address user, address token, uint256 amount) 
        external 
        view 
        returns (bool sufficient) 
    {
        return balances[user][token] >= amount;
    }

    // ============ Admin Functions ============

    /**
     * @notice Thêm trader contract có quyền slash/credit balance
     * @param trader Địa chỉ trader contract (như PreMarketTrade)
     */
    function addTrader(address trader) external onlyRole(ADMIN_ROLE) {
        _grantRole(TRADER_ROLE, trader);
    }

    /**
     * @notice Xóa trader contract
     * @param trader Địa chỉ trader contract
     */
    function removeTrader(address trader) external onlyRole(ADMIN_ROLE) {
        _revokeRole(TRADER_ROLE, trader);
    }

    /**
     * @notice Emergency function để rút token bị kẹt (chỉ dùng khi cần thiết)
     * @dev Chỉ dùng khi có bug critical, cần đảm bảo user funds không bị mất
     * @param token Địa chỉ token
     * @param amount Số lượng cần rút
     */
    function emergencyWithdraw(address token, uint256 amount) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        IERC20(token).safeTransfer(msg.sender, amount);
    }

    /**
     * @notice Reconcile function để audit total deposits vs contract balance
     * @param token Địa chỉ token cần kiểm tra
     * @return contractBalance Balance thật của contract
     * @return recordedDeposits Tổng deposits đã ghi nhận
     * @return isBalanced true nếu khớp nhau
     */
    function reconcileToken(address token) 
        external 
        view 
        returns (
            uint256 contractBalance,
            uint256 recordedDeposits,
            bool isBalanced
        ) 
    {
        contractBalance = IERC20(token).balanceOf(address(this));
        recordedDeposits = totalDeposits[token];
        isBalanced = contractBalance >= recordedDeposits;
    }
} 