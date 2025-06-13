# PreMarketTrade Upgradeable Contract

## Tổng quan

Contract PreMarketTrade đã được chuyển đổi thành **upgradeable contract** sử dụng proxy pattern của OpenZeppelin. Điều này cho phép:

- **Upgrade logic** mà không mất dữ liệu
- **Thêm tính năng mới** trong tương lai
- **Sửa bugs** mà không cần migrate users

## Kiến trúc Upgradeable

### 1. Proxy Pattern
```
User → Proxy Contract → Implementation Contract
```

- **Proxy**: Lưu trữ state và delegate calls
- **Implementation**: Chứa logic code
- **Admin**: Có quyền upgrade implementation

### 2. Key Changes

#### A. Imports thay đổi
```solidity
// Old
import "@openzeppelin/contracts/access/AccessControl.sol";

// New  
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
```

#### B. Constructor → Initializer
```solidity
// Old
constructor(address _vault) EIP712("PreMarketTrade", "1") {
    // initialization logic
}

// New
constructor() {
    _disableInitializers();
}

function initialize(address _vault, address _admin) public initializer {
    // initialization logic
}
```

#### C. Immutable → State Variable
```solidity
// Old
EscrowVault public immutable vault;

// New
EscrowVault public vault;
```

## Cài đặt Dependencies

```bash
npm install --save-dev @openzeppelin/hardhat-upgrades
npm install @openzeppelin/contracts-upgradeable
```

## Deploy Upgradeable Contract

### 1. Deploy lần đầu
```bash
npx hardhat run scripts/deploy-upgradeable.ts --network localhost
```

### 2. Upgrade contract
```typescript
import { ethers, upgrades } from "hardhat";

async function upgrade() {
    const PROXY_ADDRESS = "0x..."; // Địa chỉ proxy đã deploy
    
    const PreMarketTradeV2 = await ethers.getContractFactory("PreMarketTradeV2");
    const upgraded = await upgrades.upgradeProxy(PROXY_ADDRESS, PreMarketTradeV2);
    
    console.log("Contract upgraded!");
    
    // Initialize V2 features
    await upgraded.initializeV2(
        50,  // 0.5% trading fee
        "0x...", // treasury address  
        10   // max 10 fills per order
    );
}
```

## Security Best Practices

### 1. Storage Layout
- **KHÔNG** thay đổi thứ tự state variables
- **KHÔNG** thay đổi type của existing variables
- **CHỈ** thêm variables mới vào cuối
- Sử dụng storage gap để reserve slots

### 2. Initializer Pattern
```solidity
function initializeV2(...) external onlyRole(DEFAULT_ADMIN_ROLE) {
    require(version == 0, "Already initialized"); // Prevent re-init
    version = 2;
    // Initialize new features
}
```

### 3. Authorization
```solidity
function _authorizeUpgrade(address newImplementation) 
    internal 
    override 
    onlyRole(DEFAULT_ADMIN_ROLE) 
{
    require(newImplementation != address(0), "Invalid implementation");
}
```

## Testing Upgrades

### 1. Validate Upgrade
```bash
npx hardhat test test/upgrade-tests.ts
```

### 2. Storage Layout Check
```typescript
// Kiểm tra storage layout trước khi upgrade
await upgrades.validateUpgrade("PreMarketTrade", "PreMarketTradeV2");
```

## Example: Thêm tính năng mới (V2)

### New Features trong V2:
- **Trading Fee**: Phí giao dịch cho protocol
- **Treasury**: Address nhận fees
- **Max Fills**: Giới hạn số lần fill per order
- **Fill Counting**: Track số lần fill

### Code example:
```solidity
contract PreMarketTradeV2 is PreMarketTrade {
    uint256 public tradingFeeBps;
    address public treasury;
    
    function initializeV2(uint256 _fee, address _treasury) external {
        require(tradingFeeBps == 0, "Already initialized");
        tradingFeeBps = _fee;
        treasury = _treasury;
    }
    
    function _processFill(...) internal override returns (uint256) {
        // Add fee logic
        uint256 fee = (tradeValue * tradingFeeBps) / 10000;
        
        // Call parent function
        uint256 tradeId = super._processFill(...);
        
        // Collect fee
        if (fee > 0) {
            vault.transferOut(collateralToken, treasury, fee);
        }
        
        return tradeId;
    }
}
```

## Monitoring & Verification

### 1. Check Implementation Address
```typescript
const implementationAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);
console.log("Current implementation:", implementationAddress);
```

### 2. Verify Version
```typescript
const contract = await ethers.getContractAt("PreMarketTradeV2", proxyAddress);
const version = await contract.getVersion();
console.log("Current version:", version);
```

## Common Pitfalls

### ❌ KHÔNG làm:
1. Thay đổi thứ tự state variables
2. Thay đổi type của existing variables  
3. Sử dụng constructor trong upgradeable contracts
4. Quên gọi parent initializers
5. Để implementation contract uninitialized

### ✅ NÊN làm:
1. Sử dụng storage gaps
2. Validate upgrades trước khi deploy
3. Test kỹ lưỡng upgrade process
4. Document storage changes
5. Use timelock cho production upgrades

## Emergency Procedures

### 1. Pause Contract
```typescript
await contract.pause(); // Emergency stop
```

### 2. Rollback Strategy
- Keep previous implementation address
- Have rollback plan ready
- Test rollback in staging first

## Resources

- [OpenZeppelin Upgrades Plugin](https://docs.openzeppelin.com/upgrades-plugins/1.x/)
- [UUPS vs Transparent Proxy](https://docs.openzeppelin.com/contracts/4.x/api/proxy)
- [Storage Gaps](https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps) 