// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./EscrowVault.sol";

/**
 * @title PreMarketTradeV2
 * @notice Ultra-simplified pre-market trading contract - all logic moved offchain
 * @dev Only 2 main functions: settle() and cancel() - everything else is offchain
 * @author Blockchain Expert
 * @custom:security-contact security@premarket.trade
 * @custom:version 2.0.0-ultra-simple
 */
contract PreMarketTradeV2 is
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    EIP712Upgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ============ Constants ============
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    
    // EIP-712 type hashes for operator signatures
    bytes32 public constant SETTLEMENT_TYPEHASH = 
        keccak256("Settlement(bytes32[] orderIds,address[] buyers,uint256[] amounts,address collateralToken,address targetToken,uint256 totalPayment,uint256 deadline,uint256 nonce)");
    
    bytes32 public constant CANCELLATION_TYPEHASH = 
        keccak256("Cancellation(bytes32[] orderIds,address buyer,address collateralToken,uint256 amount,uint256 deadline,uint256 nonce)");

    // ============ State Variables ============
    
    /**
     * @notice EscrowVault reference for collateral management
     */
    EscrowVault public vault;
    
    /**
     * @notice Contract version
     */
    string public constant VERSION = "2.0.0-ultra-simple";
    
    /**
     * @notice Protocol fee in basis points (0.5% default)
     */
    uint256 public protocolFeeBps;
    
    /**
     * @notice Treasury address for protocol fees
     */
    address public treasury;
    
    /**
     * @notice Nonce tracking for operator signatures
     */
    uint256 public operatorNonce;

    // ============ Structs ============

    /**
     * @notice Settlement data for batch operations
     * @dev All verification happens offchain, operator signature ensures legitimacy
     */
    struct SettlementData {
        bytes32[] orderIds;         // Array of order IDs for offchain sync
        address[] buyers;           // Array of buyer addresses
        uint256[] amounts;          // Array of target token amounts for each buyer
        address collateralToken;    // Token used for payment
        address targetToken;        // Token being settled
        uint256 totalPayment;       // Total payment amount from buyers
        uint256 deadline;           // Settlement deadline
        uint256 nonce;              // Unique nonce for this settlement
        bytes operatorSignature;    // Operator's EIP-712 signature authorizing settlement
    }

    /**
     * @notice Cancellation data for buyer refunds
     */
    struct CancellationData {
        bytes32[] orderIds;         // Array of order IDs for offchain sync
        address buyer;
        address collateralToken;
        uint256 amount;
        uint256 deadline;
        uint256 nonce;              // Unique nonce for this cancellation
        bytes operatorSignature;    // Operator's EIP-712 signature authorizing cancellation
    }

    // ============ Storage ============
    
    /**
     * @notice Track processed settlements to prevent replay
     */
    mapping(bytes32 => bool) public processedSettlements;
    
    /**
     * @notice Track processed cancellations to prevent replay
     */
    mapping(bytes32 => bool) public processedCancellations;

    // ============ Events ============
    
    event Settlement(
        bytes32 indexed settlementHash,
        bytes32[] orderIds,
        address indexed seller,
        address indexed targetToken,
        address[] buyers,
        uint256[] amounts,
        uint256 totalPayment,
        uint256 protocolFee
    );
    
    event Cancellation(
        bytes32 indexed cancellationHash,
        bytes32[] orderIds,
        address indexed buyer,
        address indexed collateralToken,
        uint256 amount,
        uint256 protocolFee
    );
    
    event ProtocolFeeUpdated(uint256 oldFee, uint256 newFee);
    event TreasuryUpdated(address oldTreasury, address newTreasury);

    // ============ Errors ============
    error InvalidSettlementData();
    error SettlementExpired();
    error SettlementAlreadyProcessed();
    error CancellationExpired();
    error CancellationAlreadyProcessed();
    error InvalidOperatorSignature();
    error InvalidNonce();
    error UnauthorizedOperator();

    error ArrayLengthMismatch();
    error ZeroAmount();
    error InvalidAddress();

    // ============ Initializer ============

    /**
     * @notice Initialize contract with minimal parameters
     */
    function initialize(
        address _vault,
        address _admin,
        address _treasury,
        address _initialOperator
    ) public initializer {
        require(_vault != address(0), "Invalid vault");
        require(_admin != address(0), "Invalid admin");
        require(_initialOperator != address(0), "Invalid operator");

        // Initialize parent contracts
        __AccessControl_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        __EIP712_init("PreMarketTradeV2", "2.0.0");
        __UUPSUpgradeable_init();

        // Set core addresses
        vault = EscrowVault(_vault);
        treasury = _treasury;
        protocolFeeBps = 50; // 0.5% default
        operatorNonce = 0;

        // Grant roles
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(EMERGENCY_ROLE, _admin);
        _grantRole(OPERATOR_ROLE, _initialOperator);
    }

    // ============ Core Functions ============

    /**
     * @notice Settle trades: seller transfers tokens to multiple buyers and receives payment
     * @dev All matching/verification logic is offchain, operator signature ensures legitimacy
     * @param data Settlement data containing orderId, buyers, amounts, and operator authorization
     */
    function settle(SettlementData calldata data) external nonReentrant whenNotPaused {
        // Basic validations
        require(data.orderIds.length > 0, "No order IDs");
        require(data.buyers.length > 0, "No buyers");
        require(data.buyers.length == data.amounts.length, "Array length mismatch");
        require(data.orderIds.length == data.buyers.length, "OrderIds and buyers length mismatch");
        require(data.totalPayment > 0, "Zero payment");
        require(data.deadline >= block.timestamp, "Settlement expired");
        require(data.targetToken != address(0), "Invalid target token");
        require(data.collateralToken != address(0), "Invalid collateral token");

        // Verify operator signature
        bytes32 structHash = _verifySettlementSignature(data);

        // Generate settlement hash
        require(!processedSettlements[structHash], "Settlement already processed");

        // Mark as processed
        processedSettlements[structHash] = true;

        // Calculate protocol fee
        uint256 protocolFee = (data.totalPayment * protocolFeeBps) / 10000;
        uint256 sellerReceives = data.totalPayment - protocolFee;

        // Transfer target tokens from seller to buyers
        uint256 totalTargetAmount = 0;
        for (uint256 i = 0; i < data.buyers.length; i++) {
            require(data.buyers[i] != address(0), "Invalid buyer address");
            require(data.amounts[i] > 0, "Zero amount");
            
            // Calculate buyer fee (deducted from target token)
            uint256 buyerFee = (data.amounts[i] * protocolFeeBps) / 10000;
            uint256 buyerReceives = data.amounts[i] - buyerFee;
            
            // Transfer to buyer
            IERC20(data.targetToken).safeTransferFrom(
                msg.sender,
                data.buyers[i],
                buyerReceives
            );
            
            // Transfer buyer fee to treasury
            if (buyerFee > 0 && treasury != address(0)) {
                IERC20(data.targetToken).safeTransferFrom(
                    msg.sender,
                    treasury,
                    buyerFee
                );
            }
            
            totalTargetAmount += data.amounts[i];
        }

        // Transfer payment from vault to seller
        vault.transferOut(data.collateralToken, msg.sender, sellerReceives);

        // Transfer protocol fee to treasury
        if (protocolFee > 0 && treasury != address(0)) {
            vault.transferOut(data.collateralToken, treasury, protocolFee);
        }

        emit Settlement(
            structHash,
            data.orderIds,
            msg.sender,
            data.targetToken,
            data.buyers,
            data.amounts,
            data.totalPayment,
            protocolFee
        );
    }

    /**
     * @notice Cancel trade: buyer withdraws collateral from vault
     * @dev All cancellation logic/validation is offchain, operator signature ensures legitimacy  
     * @param data Cancellation data containing orderId, amount and operator authorization
     */
    function cancel(CancellationData calldata data) external nonReentrant whenNotPaused {
        // Basic validations
        require(data.orderIds.length > 0, "No order IDs");
        require(data.buyer == msg.sender, "Only buyer can cancel");
        require(data.amount > 0, "Zero amount");
        require(data.deadline >= block.timestamp, "Cancellation expired");
        require(data.collateralToken != address(0), "Invalid collateral token");

        // Verify operator signature
        bytes32 structHash = _verifyCancellationSignature(data);

        require(!processedCancellations[structHash], "Cancellation already processed");

        // Mark as processed
        processedCancellations[structHash] = true;

        // Calculate protocol fee from cancellation amount
        uint256 protocolFee = (data.amount * protocolFeeBps) / 10000;
        uint256 buyerReceives = data.amount - protocolFee;

        // Transfer collateral back to buyer (less fee)
        if (buyerReceives > 0) {
            vault.transferOut(data.collateralToken, data.buyer, buyerReceives);
        }

        // Transfer protocol fee to treasury
        if (protocolFee > 0 && treasury != address(0)) {
            vault.transferOut(data.collateralToken, treasury, protocolFee);
        }

        emit Cancellation(
            structHash,
            data.orderIds,
            data.buyer,
            data.collateralToken,
            data.amount,
            protocolFee
        );
    }

    // ============ Internal Functions ============

    /**
     * @notice Verify operator signature for settlement
     * @dev Uses EIP-712 to verify signature from authorized operator
     */
    function _verifySettlementSignature(
        SettlementData calldata data
    ) internal view returns (bytes32) {
        // Build EIP-712 structured data hash
        bytes32 structHash = keccak256(abi.encode(
            SETTLEMENT_TYPEHASH,
            keccak256(abi.encodePacked(data.orderIds)),
            keccak256(abi.encodePacked(data.buyers)),
            keccak256(abi.encodePacked(data.amounts)),
            data.collateralToken,
            data.targetToken,
            data.totalPayment,
            data.deadline,
            data.nonce
        ));

        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = digest.recover(data.operatorSignature);
        
        require(hasRole(OPERATOR_ROLE, signer), "Invalid operator signature");
        return structHash;
    }

    /**
     * @notice Verify operator signature for cancellation
     * @dev Uses EIP-712 to verify signature from authorized operator
     */
    function _verifyCancellationSignature(
        CancellationData calldata data
    ) internal view returns (bytes32) {
        // Build EIP-712 structured data hash
        bytes32 structHash = keccak256(abi.encode(
            CANCELLATION_TYPEHASH,
            keccak256(abi.encodePacked(data.orderIds)),
            data.buyer,
            data.collateralToken,
            data.amount,
            data.deadline,
            data.nonce
        ));

        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = digest.recover(data.operatorSignature);
        
        require(hasRole(OPERATOR_ROLE, signer), "Invalid operator signature");
        return structHash;
    }

    // ============ Admin Functions ============

    /**
     * @notice Update protocol fee
     */
    function setProtocolFee(uint256 newFeeBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newFeeBps <= 1000, "Fee too high"); // Max 10%
        uint256 oldFee = protocolFeeBps;
        protocolFeeBps = newFeeBps;
        emit ProtocolFeeUpdated(oldFee, newFeeBps);
    }

    /**
     * @notice Update treasury address
     */
    function setTreasury(address newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        address oldTreasury = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(oldTreasury, newTreasury);
    }

    /**
     * @notice Grant operator role to new address
     */
    function addOperator(address operator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(operator != address(0), "Invalid operator");
        _grantRole(OPERATOR_ROLE, operator);
    }

    /**
     * @notice Revoke operator role from address
     */
    function removeOperator(address operator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(OPERATOR_ROLE, operator);
    }

    /**
     * @notice Increment operator nonce (in case of emergency)
     */
    function incrementOperatorNonce() external onlyRole(DEFAULT_ADMIN_ROLE) {
        operatorNonce++;
    }

    /**
     * @notice Pause contract
     */
    function pause() external onlyRole(EMERGENCY_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause contract
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /**
     * @notice Emergency withdraw (only when paused)
     */
    function emergencyWithdraw(
        address token,
        uint256 amount,
        address to
    ) external onlyRole(EMERGENCY_ROLE) whenPaused {
        require(to != address(0), "Invalid recipient");
        IERC20(token).safeTransfer(to, amount);
    }

    // ============ View Functions ============

    /**
     * @notice Check if settlement was processed
     */
    function isSettlementProcessed(bytes32 settlementHash) external view returns (bool) {
        return processedSettlements[settlementHash];
    }

    /**
     * @notice Check if cancellation was processed
     */
    function isCancellationProcessed(bytes32 cancellationHash) external view returns (bool) {
        return processedCancellations[cancellationHash];
    }

    /**
     * @notice Get settlement hash for given data
     */
    function getSettlementHash(
        SettlementData calldata data,
        address seller
    ) external view returns (bytes32) {
        return keccak256(abi.encode(data, seller, block.chainid));
    }

    /**
     * @notice Get cancellation hash for given data
     */
    function getCancellationHash(
        CancellationData calldata data
    ) external view returns (bytes32) {
        return keccak256(abi.encode(data, block.chainid));
    }

    // ============ Upgrade Authorization ============

    /**
     * @notice Authorize upgrade
     */
    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newImplementation != address(0), "Invalid implementation");
        require(newImplementation != address(this), "Cannot upgrade to self");
    }

    // ============ Storage Gap ============
    uint256[50] private __gap;
} 