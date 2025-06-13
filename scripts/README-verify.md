# 🔍 Contract Verification Scripts

Hướng dẫn sử dụng các script để verify contracts đã deploy trên blockchain explorers.

## 📁 Files Overview

- **`verify.ts`**: Script verify tự động với địa chỉ hardcoded
- **`verify-custom.ts`**: Script verify linh hoạt với nhiều options
- **`README-verify.md`**: File hướng dẫn này

## 🚀 Quick Start

### 1. Chuẩn bị Environment

Tạo/cập nhật file `.env`:

```bash
# API Keys cho các blockchain explorers
ETHERSCAN_API_KEY=your_etherscan_api_key_here
BASE_SEPOLIA_API_KEY=your_basescan_api_key_here

# RPC URLs
SEPOLIA_URL=https://sepolia.infura.io/v3/your-key
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
```

### 2. Verify với Script đơn giản

```bash
# Verify với địa chỉ mặc định đã hardcoded
npx hardhat run scripts/verify.ts --network base-sepolia
```

### 3. Verify với Script nâng cao

```bash
# Option 1: Sử dụng địa chỉ mặc định
npx hardhat run scripts/verify-custom.ts --network base-sepolia

# Option 2: Nhập địa chỉ custom từ command line
npx hardhat run scripts/verify-custom.ts --network base-sepolia -- \
  0x6B4792a57caBEbE6363ce3C0354D1494e63d0320 \
  0x4E18BdA62EDb10000408a783f3e58ca2bADA8b5C \
  0xE1c604dC0b73A750b6D476CA7592aE26336A402f \
  0x6c4363Bc7d0888Ec19F71f845A73f41e37d2ab3a

# Option 3: Sử dụng file JSON
npx hardhat run scripts/verify-custom.ts --network base-sepolia -- deployment.json
```

## 📋 Script Details

### verify.ts - Simple Verification

**Mục đích**: Verify nhanh với địa chỉ contracts đã biết trước

**Features**:
- ✅ Hardcoded addresses cho deployment gần nhất
- ✅ Auto error handling cho "Already Verified"
- ✅ Progress tracking với emojis
- ✅ Explorer links summary
- ✅ Clear success/failure reporting

**Output Example**:
```
🔍 Starting contract verification process...

📋 [1/3] Verifying EscrowVault...
    Address: 0x6B4792a57caBEbE6363ce3C0354D1494e63d0320
    ✅ EscrowVault verified successfully!

📋 [2/3] Verifying PreMarketTrade Implementation...
    Address: 0xE1c604dC0b73A750b6D476CA7592aE26336A402f
    ✅ PreMarketTrade Implementation verified successfully!

📋 [3/3] Verifying Proxy Contract...
    Address: 0x4E18BdA62EDb10000408a783f3e58ca2bADA8b5C
    ✅ Proxy Contract already verified!

🎉 Verification Summary:
    Total contracts: 3
    Successfully verified: 3
    Failed: 0

✅ All contracts verified successfully!
```

### verify-custom.ts - Advanced Verification

**Mục đích**: Verification tool linh hoạt cho nhiều deployment khác nhau

**Features**:
- ✅ Multiple input methods (CLI args, JSON file, defaults)
- ✅ Address validation với ethers.js
- ✅ Detailed reporting với network info
- ✅ Explorer URL generation cho nhiều networks
- ✅ Error collection và reporting
- ✅ Extensible cho future networks

**Input Methods**:

1. **Default addresses** (no arguments):
   ```bash
   npx hardhat run scripts/verify-custom.ts --network base-sepolia
   ```

2. **Command line addresses**:
   ```bash
   npx hardhat run scripts/verify-custom.ts --network base-sepolia -- \
     <vault_address> <proxy_address> <implementation_address> [admin_address]
   ```

3. **JSON file**:
   ```bash
   npx hardhat run scripts/verify-custom.ts --network base-sepolia -- deployment.json
   ```

## 📄 JSON File Format

Tạo file `deployment.json` với format:

```json
{
  "vault": "0x6B4792a57caBEbE6363ce3C0354D1494e63d0320",
  "proxy": "0x4E18BdA62EDb10000408a783f3e58ca2bADA8b5C", 
  "implementation": "0xE1c604dC0b73A750b6D476CA7592aE26336A402f",
  "admin": "0x6c4363Bc7d0888Ec19F71f845A73f41e37d2ab3a",
  "network": "base-sepolia",
  "timestamp": 1700000000000
}
```

**Alternative field names** (tương thích):
- `vault` hoặc `escrowVault`
- `proxy` hoặc `preMarketTradeProxy`
- `implementation` hoặc `preMarketTradeImpl`

## 🌐 Supported Networks

| Network | Explorer | API Key Required |
|---------|----------|------------------|
| `mainnet` | etherscan.io | ETHERSCAN_API_KEY |
| `sepolia` | sepolia.etherscan.io | ETHERSCAN_API_KEY |
| `base` | basescan.org | BASE_API_KEY |
| `base-sepolia` | sepolia.basescan.org | BASE_SEPOLIA_API_KEY |
| `polygon` | polygonscan.com | POLYGON_API_KEY |
| `polygon-mumbai` | mumbai.polygonscan.com | POLYGON_API_KEY |

## 🔧 Customization

### Thêm Network mới

Cập nhật `getExplorerUrl()` function trong `verify-custom.ts`:

```typescript
function getExplorerUrl(network: string): string | null {
    const explorers: Record<string, string> = {
        // ... existing networks
        'arbitrum': 'https://arbiscan.io',
        'optimism': 'https://optimistic.etherscan.io'
    };
    return explorers[network] || null;
}
```

### Thêm Contract mới

Mở rộng verification logic trong `verifyAllContracts()`:

```typescript
// 4. Verify Token Contract (nếu có)
if (data.tokenAddress) {
    console.log("\n🔍 [4/4] Verifying Token Contract...");
    try {
        await run("verify:verify", {
            address: data.tokenAddress,
            constructorArguments: [data.tokenName, data.tokenSymbol, data.tokenDecimals],
            contract: "contracts/MyToken.sol:MyToken"
        });
        console.log("    ✅ Token Contract verified!");
        results.token = true;
    } catch (error: any) {
        // Error handling...
    }
}
```

## 🐛 Troubleshooting

### Common Issues

**1. "Already Verified" Error**
```
✅ Normal - Contract đã được verify trước đó
```

**2. "Constructor arguments mismatch"**
```bash
# Kiểm tra constructor args trong contract
# Thêm args chính xác vào constructorArguments array
```

**3. "Failed to verify contract"**
```bash
# Kiểm tra:
# - API key có hợp lệ không
# - Network có đúng không  
# - Contract address có tồn tại không
# - Solidity version có khớp không
```

**4. "Compilation failed"**
```bash
# Đảm bảo:
# - Solidity version trong hardhat.config.ts khớp với deploy
# - Optimizer settings giống nhau
# - Dependencies đã install đầy đủ
```

### Debug Commands

```bash
# Kiểm tra network hiện tại
npx hardhat run --network base-sepolia scripts/verify.ts

# Chạy với verbose logs
DEBUG=* npx hardhat run scripts/verify.ts --network base-sepolia

# Verify manual cho contract cụ thể
npx hardhat verify --network base-sepolia 0x... "arg1" "arg2"
```

## 📊 Success Indicators

Sau khi verify thành công, bạn sẽ thấy:

1. **✅ Console output**: "Contract verified successfully!"
2. **🔗 Explorer links**: Working links với source code visible
3. **📱 Contract interaction**: Read/Write tabs available trên explorer
4. **🏷️ Contract labels**: Tên contract hiển thị thay vì "Contract" generic

## 🎯 Best Practices

1. **Always backup deployment addresses** trước khi verify
2. **Test verification trên testnet** trước mainnet
3. **Keep API keys secure** và không commit vào git
4. **Document verification status** trong project README
5. **Set up monitoring** cho verified contracts
6. **Use consistent naming** cho contract files và classes

## 🔄 Integration với CI/CD

Tạo GitHub Action cho auto-verification:

```yaml
# .github/workflows/verify.yml
name: Contract Verification
on:
  workflow_dispatch:
    inputs:
      network:
        description: 'Network to verify on'
        required: true
        default: 'base-sepolia'

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npx hardhat run scripts/verify.ts --network ${{ github.event.inputs.network }}
        env:
          ETHERSCAN_API_KEY: ${{ secrets.ETHERSCAN_API_KEY }}
          BASE_SEPOLIA_API_KEY: ${{ secrets.BASE_SEPOLIA_API_KEY }}
```

---

📚 **Need help?** Check [Hardhat Verification Docs](https://hardhat.org/plugins/nomiclabs-hardhat-etherscan.html) 