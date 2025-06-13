# 🚀 Orca Contracts - Pre-Market Trading

Smart contract hệ thống cho phép giao dịch token chưa phát hành với cơ chế collateral bảo mật.

## 📋 Tổng quan

`PreMarketTrade.sol` là một smart contract cho phép người dùng giao dịch token chưa phát hành (pre-market) một cách an toàn thông qua:

- **Collateral locking**: Cả buyer và seller phải đặt tài sản thế chấp
- **Off-chain matching**: Khớp lệnh nhanh chóng 
- **On-chain settlement**: Thực hiện giao dịch minh bạch
- **Grace period**: Thời gian cho seller thực hiện giao hàng
- **Penalty mechanism**: Bảo vệ buyer khỏi seller không giao hàng

## 🏗️ Kiến trúc

```
PreMarketTrade Contract
├── Order Management (EIP-712 signatures)
├── Collateral System (SafeERC20)
├── Access Control (Relayer role)
├── Grace Period & Penalties
└── Event Emission
```

## 📦 Cài đặt

```bash
# Clone repository
git clone <repository-url>
cd orca-contracts

# Cài đặt dependencies
npm install

# Compile contracts
npx hardhat compile

# Chạy tests
npx hardhat test

# Deploy (local)
npx hardhat run scripts/deploy.js --network localhost
```

## 🔧 Cách sử dụng

### 1. Tạo Order (Off-chain)

```javascript
const order = {
  trader: "0x...",
  collateralToken: "0x...", // USDC/USDT/ETH
  amount: ethers.parseUnits("100", 18),
  price: ethers.parseUnits("1", 18), 
  isBuy: true, // true = BUY, false = SELL
  nonce: 1,
  deadline: Math.floor(Date.now() / 1000) + 3600
};

// Ký order bằng EIP-712
const signature = await signer.signTypedData(domain, types, order);
```

### 2. Match Orders (Relayer)

```javascript
// Relayer khớp buy order và sell order
const tradeId = await preMarketTrade.connect(relayer)
  .matchOrders(buyOrder, sellOrder, sigBuy, sigSell);
```

### 3. Settle Trade (Seller)

```javascript
// Seller giao token thật trong grace period (3 ngày)
await targetToken.connect(seller).approve(buyer.address, amount);
await preMarketTrade.connect(seller).settle(tradeId, targetToken.address);
```

### 4. Cancel Trade (Buyer)

```javascript
// Buyer có thể cancel sau grace period nếu seller không giao
await preMarketTrade.connect(buyer).cancelAfterGracePeriod(tradeId);
```

## 🔒 Bảo mật

### Access Control
- **DEFAULT_ADMIN_ROLE**: Deploy và quản lý contract
- **RELAYER_ROLE**: Khớp orders off-chain → on-chain

### Signature Verification
- Sử dụng **EIP-712** cho typed data signing
- **Nonce tracking** chống replay attacks
- **Deadline** validation cho orders

### Collateral Protection
- **ReentrancyGuard** chống reentrancy attacks
- **SafeERC20** cho token transfers
- **Locked collateral** tracking

### Economic Security
- Cả buyer và seller đều lock collateral = `amount × price`
- Seller nhận cả 2 phần collateral khi settle thành công
- Buyer nhận cả 2 phần collateral nếu seller không giao hàng

## 📊 Gas Optimization

- ✅ Sử dụng `custom errors` thay vì string revert
- ✅ Packed structs để tiết kiệm storage
- ✅ `calldata` cho external function parameters
- ✅ Minimal storage writes trong hot paths

## 🧪 Testing

```bash
# Chạy toàn bộ test suite
npx hardhat test

# Test coverage
npx hardhat coverage

# Gas reporter
REPORT_GAS=true npx hardhat test
```

## 📋 Deployment Networks

### Testnet
- **Sepolia**: `0x...` (Coming soon)
- **Polygon Mumbai**: `0x...` (Coming soon)

### Mainnet
- **Ethereum**: `0x...` (Coming soon)
- **Polygon**: `0x...` (Coming soon)

## 🤝 Đóng góp

1. Fork repository
2. Tạo feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Tạo Pull Request

## 📄 License

Project này được phân phối dưới MIT License. Xem `LICENSE` để biết thêm chi tiết.

## ⚠️ Disclaimer

Smart contract này chưa được audit bởi bên thứ ba. Sử dụng trên mainnet với rủi ro của bạn. Luôn kiểm tra kỹ code và test trước khi sử dụng với tiền thật.

---

**Được xây dựng bởi Blockchain Expert Team** 🧠⚡ 