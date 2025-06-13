# 📜 Pre-Market Trading Scripts Documentation

## 🎯 Tổng quan

Bộ scripts này cung cấp đầy đủ chức năng để tương tác với hệ thống Pre-Market Trading smart contract. Gồm 4 scripts chính và 1 script demo tổng hợp.

## 📋 Danh sách Scripts

| Script | Chức năng | File |
|--------|-----------|------|
| 🏪 | Tạo Token Market | `1-create-token-market.ts` |
| 🤝 | Khớp Orders (Buy/Sell) | `2-match-orders.ts` |
| ✅ | Settle Trades | `3-settle-trades.ts` |
| ❌ | Cancel Trades/Orders | `4-cancel-trades.ts` |
| 💰 | Deposit vào Vault | `5-deposit-vault.ts` |
| 💸 | Withdraw từ Vault | `6-withdraw-vault.ts` |
| 🎬 | Demo Complete Workflow | `demo-complete-workflow.ts` |

## 🛠️ Thiết lập ban đầu

### 1. Environment Variables

Tạo file `.env` trong root project:

```bash
# Contract addresses
PREMARKET_CONTRACT=0x1234567890123456789012345678901234567890
VAULT_CONTRACT=0x2345678901234567890123456789012345678901
USDC_ADDRESS=0xA0b86a33E6426c8bf8fB4b6E2b78BB9db20CEaE3
USDT_ADDRESS=0xdAC17F958D2ee523a2206206994597C13D831ec7

# Demo settings
RUN_MULTIPLE_SCENARIOS=false

# Network settings
PRIVATE_KEY=your_private_key_here
INFURA_KEY=your_infura_key_here
```

### 2. Dependencies

Đảm bảo đã cài đặt:

```bash
npm install
npx hardhat compile
```

## 📚 Hướng dẫn sử dụng từng Script

### 🏪 Script 1: Create Token Market

**Mục đích:** Tạo thị trường mới cho token chưa phát hành

```bash
# Chạy script
npx hardhat run scripts/1-create-token-market.ts --network localhost

# Hoặc với network khác
npx hardhat run scripts/1-create-token-market.ts --network goerli
```

**Cấu hình trong script:**

```typescript
const config: TokenMarketConfig = {
  symbol: "NEW-TOKEN",           // Symbol của token
  name: "New Token Protocol",    // Tên đầy đủ
  settleTimeLimitDays: 30       // Thời gian settle (ngày)
};
```

**Output:**
- Token ID được tạo
- Thông tin token market
- Transaction hash

### 🤝 Script 2: Match Orders

**Mục đích:** Khớp lệnh buy/sell với EIP-712 signatures

```bash
npx hardhat run scripts/2-match-orders.ts --network localhost
```

**Yêu cầu trước khi chạy:**
1. Token market đã được tạo (Script 1)
2. Cập nhật `targetTokenId` trong config
3. Buyer và Seller có đủ collateral

**Cấu hình orders:**

```typescript
const example: MatchOrdersConfig = {
  buyOrder: {
    trader: buyer.address,
    collateralToken: usdcAddress,
    targetTokenId: "0x...", // Từ script 1
    amount: ethers.parseEther("1000").toString(),
    price: ethers.parseEther("0.5").toString(),
    isBuy: true,
    nonce: "1",
    deadline: deadline.toString()
  },
  sellOrder: {
    // Tương tự buy order nhưng isBuy: false
  },
  fillAmount: ethers.parseEther("500").toString() // Optional
};
```

**Output:**
- Trade ID được tạo
- Thông tin matching
- Collateral amounts

### ✅ Script 3: Settle Trades

**Mục đích:** Hoàn tất giao dịch sau khi token real được phát hành

```bash
npx hardhat run scripts/3-settle-trades.ts --network localhost
```

**Yêu cầu:**
1. Trade đã được match (Script 2)
2. Token real đã được phát hành và mapped
3. Seller có đủ token real
4. Seller đã approve token cho contract

**Cấu hình:**

```typescript
const config: SettleTradeConfig = {
  tradeId: "1",                                    // Từ script 2
  targetTokenAddress: "0x..."                     // Real token address
};
```

**Lưu ý quan trọng:**
- Seller cần approve token trước: `targetToken.approve(preMarketContract, amount)`
- Phải trong thời gian settle limit

### ❌ Script 4: Cancel Trades/Orders

**Mục đích:** Hủy trades hoặc orders

```bash
npx hardhat run scripts/4-cancel-trades.ts --network localhost
```

### 💰 Script 5: Deposit vào Vault

**Mục đích:** Deposit tokens vào EscrowVault để làm collateral

```bash
npx hardhat run scripts/5-deposit-vault.ts --network localhost
```

**Yêu cầu:**
1. User có đủ token balance
2. User đã approve token cho vault contract

**Cấu hình:**

```typescript
const config: DepositConfig = {
  token: "0x...",                              // Token address
  amount: ethers.parseUnits("1000", 6).toString(), // Amount (6 decimals for USDC)
  symbol: "USDC",                              // Symbol for display
  decimals: 6                                  // Token decimals
};
```

**Features:**
- Auto check và approve token
- Single và batch deposits
- Balance validation
- Vault reconciliation

### 💸 Script 6: Withdraw từ Vault

**Mục đích:** Withdraw tokens từ EscrowVault về wallet

```bash
npx hardhat run scripts/6-withdraw-vault.ts --network localhost
```

**Yêu cầu:**
1. User có đủ balance trong vault
2. Không có active orders đang lock collateral

**Cấu hình:**

```typescript
const config: WithdrawConfig = {
  token: "0x...",                              // Token address
  amount: ethers.parseUnits("500", 6).toString(), // Amount to withdraw
  symbol: "USDC",                              // Symbol for display
  decimals: 6                                  // Token decimals
};
```

**Features:**
- Single và batch withdrawals
- Withdraw max balance
- Withdraw all balances
- Emergency withdrawal

**2 loại cancellation:**

#### A. Cancel Trade After Grace Period
- Chỉ buyer có thể cancel
- Sau khi grace period hết hạn
- Seller sẽ bị penalty

#### B. Cancel Order  
- Trader có thể cancel order của mình
- Bất kỳ lúc nào (partial hoặc full)
- Trước khi order bị fill hoàn toàn

**Cấu hình:**

```typescript
// Trade cancellation
const tradeConfig: CancelTradeConfig = {
  tradeId: "1",
  reason: "Seller failed to deliver on time"
};

// Order cancellation  
const orderConfig: CancelOrderConfig = {
  orderHash: "0x...",
  cancelAmount: ethers.parseEther("500").toString(),
  reason: "Market conditions changed"
};
```

### 🎬 Script Demo Complete Workflow

**Mục đích:** Demo toàn bộ workflow từ đầu đến cuối

```bash
# Single scenario
npx hardhat run scripts/demo-complete-workflow.ts --network localhost

# Multiple scenarios
RUN_MULTIPLE_SCENARIOS=true npx hardhat run scripts/demo-complete-workflow.ts --network localhost
```

**Workflow steps:**
1. Tạo token market
2. Match buy/sell orders  
3. Settle trade (hoặc cancel nếu cần)
4. Hiển thị summary

## 🔧 Các Script Utility

### Package.json Scripts

Thêm vào `package.json`:

```json
{
  "scripts": {
    "create-market": "hardhat run scripts/1-create-token-market.ts",
    "match-orders": "hardhat run scripts/2-match-orders.ts", 
    "settle-trades": "hardhat run scripts/3-settle-trades.ts",
    "cancel-trades": "hardhat run scripts/4-cancel-trades.ts",
    "deposit-vault": "hardhat run scripts/5-deposit-vault.ts",
    "withdraw-vault": "hardhat run scripts/6-withdraw-vault.ts",
    "demo-workflow": "hardhat run scripts/demo-complete-workflow.ts"
  }
}
```

### Quick Commands

```bash
# Tạo market mới
npm run create-market -- --network goerli

# Demo complete workflow  
npm run demo-workflow -- --network localhost

# Match orders với config tùy chỉnh
npm run match-orders -- --network mainnet
```

## 🛡️ Security Best Practices

### 1. Private Keys
- ❌ Không commit private keys vào git
- ✅ Sử dụng environment variables
- ✅ Sử dụng hardware wallet cho mainnet

### 2. Contract Addresses
- ✅ Verify contract addresses trước khi chạy
- ✅ Test trên testnet trước
- ✅ Double check recipient addresses

### 3. Gas Management
- ✅ Set reasonable gas limits
- ✅ Monitor gas prices
- ✅ Use gas estimation

### 4. Testing
- ✅ Test trên localhost/hardhat network trước
- ✅ Test với amounts nhỏ trước
- ✅ Verify contract state sau mỗi operation

## 🔍 Troubleshooting

### Common Issues

#### 1. "Contract not found"
```bash
# Solution: Kiểm tra contract address trong .env
PREMARKET_CONTRACT=0x... # Đảm bảo địa chỉ đúng
```

#### 2. "Insufficient allowance"
```bash
# Solution: Approve token trước khi settle
await targetToken.approve(preMarketContract, amount);
```

#### 3. "Grace period not expired"
```bash
# Solution: Đợi đến sau thời gian settle limit
# Hoặc sử dụng cancelOrder thay vì cancelAfterGracePeriod
```

#### 4. "Invalid signature"
```bash
# Solution: Kiểm tra domain separator và chain ID
# Đảm bảo signer đúng với trader trong order
```

### Debug Tips

#### 1. Enable verbose logging
```typescript
// Thêm vào script
console.log("Debug info:", { variable });
```

#### 2. Check contract state
```typescript
// Kiểm tra trade info
const tradeInfo = await preMarketTrade.trades(tradeId);
console.log("Trade info:", tradeInfo);

// Kiểm tra order status
const filled = await preMarketTrade.orderFilled(orderHash);
console.log("Order filled:", ethers.formatEther(filled));
```

#### 3. Monitor events
```typescript
// Listen for events
preMarketTrade.on("OrdersMatched", (tradeId, buyer, seller) => {
  console.log("New trade matched:", { tradeId, buyer, seller });
});
```

## 📊 Monitoring & Analytics

### Event Tracking
Scripts tự động track các events quan trọng:
- `TokenMarketCreated`
- `OrdersMatched`
- `TradeSettled`
- `TradeCancelled`
- `OrderCancelled`

### Gas Usage
Mỗi script báo cáo:
- Gas estimate trước khi execute
- Actual gas used sau transaction
- Transaction hash để verify trên explorer

### Success Metrics
Demo workflow track:
- Token markets created: ✅/❌
- Orders matched: ✅/❌  
- Trades settled: ✅/❌
- Trades cancelled: ✅/❌

## 🚀 Advanced Usage

### Batch Operations
Scripts hỗ trợ batch operations:

```typescript
// Multiple trades settlement
const configs = [
  { tradeId: "1", targetTokenAddress: "0x..." },
  { tradeId: "2", targetTokenAddress: "0x..." }
];
await settleMultipleTrades(configs);

// Multiple orders cancellation
await cancelMultipleOrders(orderConfigs);
```

### Custom Configurations
Mỗi script có thể customize via environment variables hoặc config objects.

### Integration với Frontend
Scripts có thể được import và sử dụng trong dApp:

```typescript
import { createTokenMarket } from './scripts/1-create-token-market';
import { matchOrders } from './scripts/2-match-orders';

// Sử dụng trong React component hoặc backend API
const result = await createTokenMarket(config);
```

## 📞 Support

Nếu gặp vấn đề khi sử dụng scripts:

1. ✅ Kiểm tra Prerequisites
2. ✅ Test trên localhost trước  
3. ✅ Đọc error messages cẩn thận
4. ✅ Check contract state và logs
5. ✅ Liên hệ team development

---

**Happy Trading! 🚀** 