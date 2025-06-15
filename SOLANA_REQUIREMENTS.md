# 📋 PREMARKET TRADING SYSTEM - BUSINESS LOGIC REQUIREMENTS
## 🎯 For Solana Implementation

> **Source**: Analyzed from Orca Contracts EVM implementation  
> **Purpose**: Complete business logic specification for Solana rebuild  
> **Date**: December 2024

---

## 📖 **TABLE OF CONTENTS**

1. [System Overview](#1-system-overview)
2. [Core Entities & Data Structures](#2-core-entities--data-structures)
3. [Business Flows](#3-business-flows)
4. [Security & Validation Rules](#4-security--validation-rules)
5. [Economic Model](#5-economic-model)
6. [System Parameters](#6-system-parameters)
7. [Events & Monitoring](#7-events--monitoring)
8. [Solana Implementation Notes](#8-solana-implementation-notes)

---

## 1. 🎯 **SYSTEM OVERVIEW**

### **Core Concept**
Pre-market trading system cho phép giao dịch **tokens chưa phát hành** với **collateral-based protection** đảm bảo cả buyer và seller đều có động lực fulfill commitments.

### **Key Features**
- ✅ **Off-chain Order Matching** + **On-chain Settlement**
- ✅ **Collateral-based Protection** cho buyer và seller
- ✅ **Partial Fill Support** với order book functionality  
- ✅ **Grace Period Mechanism** cho seller delivery
- ✅ **Economic Incentive System** với rewards/penalties
- ✅ **Role-based Access Control** (Admin, Relayer, Users)

### **Problem Solved**
- Giao dịch token trước khi launch mainnet
- Bảo vệ buyer khỏi seller không deliver
- Bảo vệ seller khỏi buyer cancel bừa bãi
- Tạo thanh khoản sớm cho new projects

---

## 2. 🏛️ **CORE ENTITIES & DATA STRUCTURES**

### **A. System Actors**

#### **👑 Admin**
- **Permissions**: Create token markets, map real tokens, update system parameters
- **Responsibilities**: Governance, token lifecycle management
- **Implementation**: Multisig hoặc DAO governance

#### **🤖 Relayer** 
- **Permissions**: Execute order matching on-chain
- **Responsibilities**: Off-chain order book maintenance, matching engine
- **Implementation**: Authorized service/bot với private key

#### **💰 Users (Buyers & Sellers)**
- **Permissions**: Create orders, deposit/withdraw collateral, settle trades
- **Responsibilities**: Provide liquidity, fulfill commitments
- **Implementation**: EOA accounts với signature capability

#### **🏦 Vault System**
- **Permissions**: Hold collateral, execute transfers
- **Responsibilities**: Custody, accounting, risk management  
- **Implementation**: Program-controlled accounts

---

### **B. Core Data Structures**

#### **📜 PreOrder**
```rust
pub struct PreOrder {
    pub trader: Pubkey,           // Người tạo order
    pub collateral_token: Pubkey, // Token thế chấp (USDC/USDT/SOL)
    pub target_token_id: [u8; 32], // ID của token sẽ giao (chưa có mint)
    pub amount: u64,              // Số lượng token muốn giao dịch
    pub price: u64,               // Giá per token (6 decimals - micro units)
    pub is_buy: bool,             // true = BUY, false = SELL
    pub nonce: u64,               // Chống replay attack
    pub deadline: i64,            // Unix timestamp deadline
}
```

#### **🤝 MatchedTrade**
```rust
pub struct MatchedTrade {
    pub trade_id: u64,
    pub buyer_order: PreOrder,
    pub seller_order: PreOrder,
    pub target_token_mint: Option<Pubkey>, // Mint thật (sau khi map)
    pub match_time: i64,
    pub settled: bool,
    pub filled_amount: u64,
    pub buyer_collateral: u64,
    pub seller_collateral: u64,
}
```

#### **🎫 TokenInfo**
```rust
pub struct TokenInfo {
    pub token_id: [u8; 32],       // Unique identifier
    pub symbol: String,           // Token symbol (unique, max 10 chars)
    pub name: String,             // Token name (max 50 chars)
    pub real_mint: Option<Pubkey>, // Mint address thật (None nếu chưa map)
    pub mapping_time: Option<i64>, // Thời điểm được map
    pub settle_time_limit: u32,   // Grace period seconds (1h-30days)
    pub created_at: i64,          // Unix timestamp creation
}
```

#### **💰 CollateralAccount**
```rust
pub struct CollateralAccount {
    pub user: Pubkey,
    pub token_mint: Pubkey,
    pub available_balance: u64,   // Có thể withdraw
    pub locked_balance: u64,      // Đang lock trong trades
    pub total_deposited: u64,     // Total lifetime deposits
    pub total_withdrawn: u64,     // Total lifetime withdrawals
}
```

---

## 3. 🔄 **BUSINESS FLOWS**

### **3.1 🏪 MARKET CREATION FLOW**

```
Admin → CreateTokenMarket {
    symbol: "TOKEN",
    name: "My Token", 
    settle_time_limit: 259200  // 3 days
}
↓
System generates unique token_id = hash(symbol + name + timestamp + admin + counter)
↓
Store TokenInfo with real_mint = None
↓
Emit TokenMarketCreated event
```

**Business Rules:**
- ✅ Chỉ Admin có thể tạo markets
- ✅ Symbol unique (max 10 characters, alphanumeric)
- ✅ Name max 50 characters
- ✅ settle_time_limit: 3600 ≤ x ≤ 2592000 (1h-30days)
- ✅ token_id collision-resistant generation

---

### **3.2 💰 COLLATERAL MANAGEMENT FLOW**

#### **Deposit Flow:**
```
User → DepositCollateral {
    token_mint: USDC_MINT,
    amount: 1000_000000  // 1000 USDC
}
↓
Transfer from user ATA to vault ATA
↓
Update user's CollateralAccount.available_balance += amount
↓
Emit CollateralDeposited event
```

#### **Withdrawal Flow:**
```
User → WithdrawCollateral {
    token_mint: USDC_MINT,
    amount: 500_000000
}
↓
Check available_balance >= amount
↓
Update available_balance -= amount
↓
Transfer from vault ATA to user ATA
↓
Emit CollateralWithdrawn event
```

**Business Rules:**
- ✅ User phải có ATA cho token trước khi deposit
- ✅ Withdrawal chỉ từ available_balance (không lock)
- ✅ Vault phải có sufficient balance để fulfill withdrawal
- ✅ Track lifetime deposit/withdrawal statistics

---

### **3.3 📝 ORDER CREATION & SIGNING**

#### **Off-chain Process:**
```javascript
// Client-side order creation
const order = {
    trader: userPublicKey,
    collateral_token: USDC_MINT,
    target_token_id: tokenId,
    amount: 1000_000000,     // 1000 tokens
    price: 1_500000,         // 1.5 USDC per token
    is_buy: true,
    nonce: Date.now(),
    deadline: Date.now() + 3600 // 1 hour
};

// Ed25519 signature
const signature = await signOrder(order, userKeypair);

// Submit to backend
await submitOrder(order, signature);
```

**Business Rules:**
- ✅ Price format: 6 decimals (micro units) - 1.5 USDC = 1500000
- ✅ Price bounds: 1000 ≤ price ≤ 1e18 (0.001 - 1T per unit)
- ✅ Amount > 0 và >= minimum_fill_amount
- ✅ deadline > current_time và <= current_time + max_order_lifetime
- ✅ target_token_id phải exist trong system
- ✅ User phải có sufficient available_balance cho potential collateral

---

### **3.4 🔀 ORDER MATCHING FLOW**

```
Relayer queries matching orders from off-chain orderbook
↓
Relayer → MatchOrders {
    buy_order: BuyOrder,
    sell_order: SellOrder,
    buy_signature: Signature,
    sell_signature: Signature,
    fill_amount: 500_000000  // Partial fill
}
↓
Validate signatures using ed25519_verify
↓
Validate order compatibility
↓
Calculate actual_fill_amount = min(buy_remaining, sell_remaining, requested)
↓
Calculate collateral requirements
↓
Lock collateral from both parties
↓
Create MatchedTrade record
↓
Update order fill tracking
↓
Emit OrdersMatched event
```

**Order Compatibility Rules:**
- ✅ buy_order.is_buy = true, sell_order.is_buy = false
- ✅ buy_order.price = sell_order.price (exact match)
- ✅ buy_order.collateral_token = sell_order.collateral_token
- ✅ buy_order.target_token_id = sell_order.target_token_id
- ✅ buy_order.trader ≠ sell_order.trader (no self-trade)
- ✅ Both orders not expired (current_time ≤ deadline)
- ✅ Both orders have remaining amount (amount - filled > 0)
- ✅ target_token exists in system

**Collateral Calculation:**
```rust
let trade_value = (fill_amount * price) / PRICE_SCALE; // Normalize from micro units
let buyer_collateral = (trade_value * buyer_collateral_ratio) / 100;
let seller_collateral = (trade_value * seller_collateral_ratio) / 100;
```

**Partial Fill Logic:**
```rust
let buy_remaining = buy_order.amount - get_filled_amount(buy_order_hash);
let sell_remaining = sell_order.amount - get_filled_amount(sell_order_hash);
let max_fill = min(buy_remaining, sell_remaining);
let actual_fill = if fill_amount == 0 { max_fill } else { min(fill_amount, max_fill) };

require!(actual_fill >= minimum_fill_amount, "Below minimum fill");
```

---

### **3.5 🎯 TOKEN MAPPING FLOW**

```
Real token mint deployed on Solana
↓
Admin → MapToken {
    token_id: [u8; 32],
    real_mint: Pubkey
}
↓
Validate token_id exists và chưa mapped
↓
Validate real_mint is valid mint address
↓
Update TokenInfo.real_mint = Some(real_mint)
↓
Update TokenInfo.mapping_time = Some(current_time)
↓
Emit TokenMapped event
↓
Settlement có thể begin
```

**Business Rules:**
- ✅ Chỉ Admin có thể map tokens
- ✅ token_id phải exist trong system
- ✅ real_mint chưa được sử dụng cho token khác
- ✅ real_mint phải là valid Mint account
- ✅ Mapping là immutable (không thể change sau khi set)

---

### **3.6 ✅ SETTLEMENT FLOW**

```
Seller → SettleTrade {
    trade_id: u64
}
↓
Validate caller = seller của trade
↓
Validate trade chưa settled
↓
Validate token đã mapped (real_mint is Some)
↓
Validate trong grace period (current_time ≤ match_time + settle_time_limit)
↓
Transfer real tokens: seller ATA → buyer ATA (filled_amount)
↓
Calculate seller reward
↓
Release total collateral + reward to seller
↓
Mark trade as settled
↓
Emit TradeSettled event
```

**Settlement Economics:**
```rust
let trade_value = (filled_amount * price) / PRICE_SCALE;
let seller_reward = (trade_value * seller_reward_bps) / 10000;
let total_release = buyer_collateral + seller_collateral + seller_reward;

// Transfer to seller
transfer_collateral(seller, collateral_token, total_release);
```

**Business Rules:**
- ✅ Chỉ seller có thể initiate settlement
- ✅ Trade chưa được settled trước đó
- ✅ Token phải đã mapped (real_mint available)
- ✅ Phải trong grace period
- ✅ Seller phải có đủ real tokens trong ATA
- ✅ All transfers atomic hoặc revert

---

### **3.7 ❌ CANCELLATION FLOW**

```
Grace period expired (current_time > match_time + settle_time_limit)
↓
Buyer → CancelTrade {
    trade_id: u64
}
↓
Validate caller = buyer của trade
↓
Validate trade chưa settled
↓
Validate grace period đã expired
↓
Calculate seller penalty
↓
Refund buyer: buyer_collateral + penalty_amount
↓
Refund seller: remaining_collateral (if any)
↓
Mark trade as settled (cancelled)
↓
Emit TradeCancelled event
```

**Penalty Economics:**
```rust
let trade_value = (filled_amount * price) / PRICE_SCALE;
let seller_penalty = (trade_value * late_penalty_bps) / 10000;
let penalty_amount = min(seller_penalty, seller_collateral);

// Distribute collateral
let buyer_refund = buyer_collateral + penalty_amount;
let seller_refund = seller_collateral.saturating_sub(penalty_amount);
```

**Business Rules:**
- ✅ Chỉ buyer có thể cancel
- ✅ Chỉ sau grace period (late settlement)
- ✅ Trade chưa được settled
- ✅ Penalty không vượt seller_collateral
- ✅ Remaining collateral về seller (nếu có)

---

## 4. 🛡️ **SECURITY & VALIDATION RULES**

### **A. Signature Security**

#### **Ed25519 Message Format:**
```rust
pub fn create_order_message(order: &PreOrder) -> Vec<u8> {
    let mut message = Vec::new();
    message.extend_from_slice(b"PreMarketOrder");  // Domain separator
    message.extend_from_slice(&order.trader.to_bytes());
    message.extend_from_slice(&order.collateral_token.to_bytes());
    message.extend_from_slice(&order.target_token_id);
    message.extend_from_slice(&order.amount.to_le_bytes());
    message.extend_from_slice(&order.price.to_le_bytes());
    message.push(if order.is_buy { 1 } else { 0 });
    message.extend_from_slice(&order.nonce.to_le_bytes());
    message.extend_from_slice(&order.deadline.to_le_bytes());
    message
}
```

#### **Signature Verification:**
```rust
pub fn verify_order_signature(
    order: &PreOrder, 
    signature: &[u8; 64]
) -> Result<()> {
    let message = create_order_message(order);
    let pubkey = Pubkey::from_bytes(&order.trader.to_bytes())?;
    
    require!(
        ed25519_verify(&signature, &message, &pubkey.to_bytes()),
        "Invalid signature"
    );
    
    Ok(())
}
```

**Security Rules:**
- ✅ Domain separator để prevent cross-protocol replay
- ✅ Nonce tracking để prevent same-order replay
- ✅ Deadline validation để prevent stale orders
- ✅ Message format deterministic và canonical

---

### **B. Access Control**

#### **Program Authority Roles:**
```rust
pub struct ProgramConfig {
    pub admin: Pubkey,           // Multisig - protocol governance
    pub relayers: Vec<Pubkey>,   // Authorized matching services
    pub emergency_admin: Pubkey, // Emergency pause/unpause
    pub treasury: Pubkey,        // Protocol fee recipient
}
```

#### **Permission Checks:**
```rust
// Admin-only functions
require!(ctx.accounts.signer.key() == config.admin, "Admin only");

// Relayer-only functions  
require!(config.relayers.contains(&ctx.accounts.signer.key()), "Relayer only");

// Emergency-only functions
require!(ctx.accounts.signer.key() == config.emergency_admin, "Emergency only");
```

**Security Rules:**
- ✅ Role separation: Admin ≠ Relayer ≠ Emergency
- ✅ Multi-signature cho Admin functions
- ✅ Rate limiting cho Relayer actions
- ✅ Emergency pause mechanism

---

### **C. Economic Security**

#### **Overflow Protection:**
```rust
pub fn safe_mul_div(a: u64, b: u64, c: u64) -> Result<u64> {
    let result = (a as u128)
        .checked_mul(b as u128)
        .ok_or(ErrorCode::MathOverflow)?
        .checked_div(c as u128)
        .ok_or(ErrorCode::MathOverflow)?;
    
    require!(result <= u64::MAX as u128, "Result overflow");
    Ok(result as u64)
}
```

#### **Bounds Validation:**
```rust
// Price bounds
require!(price >= MIN_PRICE && price <= MAX_PRICE, "Price out of bounds");

// Collateral ratio bounds  
require!(ratio >= 100 && ratio <= 20000, "Invalid collateral ratio"); // 1-200%

// Time bounds
require!(deadline > Clock::get()?.unix_timestamp, "Order expired");
require!(settle_time >= 3600 && settle_time <= 2592000, "Invalid settle time");
```

**Security Rules:**
- ✅ All arithmetic operations overflow-safe
- ✅ Input validation trên all parameters
- ✅ Reasonable bounds trên all economic parameters
- ✅ Time-based validation với Clock sysvar

---

## 5. 📈 **ECONOMIC MODEL**

### **A. Incentive Structure**

#### **Buyer Incentives:**
- ✅ **Lock collateral** → commitment to purchase
- ✅ **Penalty protection** → nếu seller not deliver → get penalty
- ✅ **Price discovery** → early access to new tokens
- ✅ **Partial fills** → flexibility trong position sizing

#### **Seller Incentives:**  
- ✅ **Lock collateral** → commitment to deliver
- ✅ **Reward for delivery** → earn seller_reward for on-time settlement
- ✅ **Avoid penalties** → deliver on time để avoid losing collateral
- ✅ **Early revenue** → monetize token before official launch

---

### **B. Economic Parameters**

```rust
pub struct EconomicConfig {
    // Collateral ratios (percentage: 100 = 100%)
    pub buyer_collateral_ratio: u16,   // Default: 100 (100%)
    pub seller_collateral_ratio: u16,  // Default: 100 (100%)
    
    // Incentive parameters (basis points: 10000 = 100%)
    pub seller_reward_bps: u16,        // Default: 0 (0%, max 1000 = 10%)
    pub late_penalty_bps: u16,          // Default: 10000 (100%)
    
    // Risk management
    pub minimum_fill_amount: u64,       // Default: 1000 (0.001 tokens)
    pub maximum_order_amount: u64,      // Default: 1e12 (1M tokens)
    
    // Time parameters (seconds)
    pub max_order_lifetime: i64,        // Default: 86400 (24 hours)
    pub min_settle_time: u32,           // Default: 3600 (1 hour)
    pub max_settle_time: u32,           // Default: 2592000 (30 days)
}
```

---

## 6. 📊 **EVENTS & MONITORING**

### **A. Core Business Events**

```rust
#[event]
pub struct TokenMarketCreated {
    pub token_id: [u8; 32],
    pub symbol: String,
    pub name: String,
    pub settle_time_limit: u32,
    pub created_at: i64,
}

#[event]
pub struct OrdersMatched {
    pub trade_id: u64,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub target_token_id: [u8; 32],
    pub filled_amount: u64,
    pub price: u64,
    pub buyer_collateral: u64,
    pub seller_collateral: u64,
    pub match_time: i64,
}

#[event]
pub struct TradeSettled {
    pub trade_id: u64,
    pub seller: Pubkey,
    pub buyer: Pubkey,
    pub target_token_mint: Pubkey,
    pub filled_amount: u64,
    pub seller_reward: u64,
    pub settlement_time: i64,
}

#[event]
pub struct TradeCancelled {
    pub trade_id: u64,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub penalty_amount: u64,
    pub cancellation_time: i64,
}
```

---

## 7. 🔧 **SOLANA IMPLEMENTATION NOTES**

### **A. Account Architecture**

#### **Program Data Accounts:**
```rust
// Global config - PDA: ["config"]
pub struct ProgramConfig {
    pub admin: Pubkey,
    pub emergency_admin: Pubkey,
    pub relayers: Vec<Pubkey>,
    pub economic_config: EconomicConfig,
    pub paused: bool,
}

// Token market - PDA: ["token", token_id]  
pub struct TokenMarket {
    pub token_info: TokenInfo,
    pub total_volume: u64,
    pub active_orders_count: u32,
}

// User collateral - PDA: ["collateral", user, token_mint]
pub struct UserCollateral {
    pub user: Pubkey,
    pub token_mint: Pubkey,
    pub available_balance: u64,
    pub locked_balance: u64,
    pub lifetime_deposited: u64,
    pub lifetime_withdrawn: u64,
}

// Trade record - PDA: ["trade", trade_id]
pub struct TradeRecord {
    pub trade_id: u64,
    pub matched_trade: MatchedTrade,
    pub created_at: i64,
    pub updated_at: i64,
}

// Order tracking - PDA: ["order", order_hash]
pub struct OrderStatus {
    pub order_hash: [u8; 32],
    pub trader: Pubkey,
    pub total_amount: u64,
    pub filled_amount: u64,
    pub fill_count: u16,
    pub last_fill_time: i64,
    pub cancelled: bool,
}
```

---

### **B. Instruction Design**

#### **Admin Instructions:**
```rust
pub enum AdminInstruction {
    InitializeProgram {
        admin: Pubkey,
        emergency_admin: Pubkey,
        economic_config: EconomicConfig,
    },
    CreateTokenMarket {
        symbol: String,
        name: String,
        settle_time_limit: u32,
    },
    MapToken {
        token_id: [u8; 32],
        real_mint: Pubkey,
    },
    UpdateConfig {
        new_config: ProgramConfig,
    },
    AddRelayer {
        relayer: Pubkey,
    },
    RemoveRelayer {
        relayer: Pubkey,
    },
    Pause,
    Unpause,
}
```

#### **User Instructions:**
```rust
pub enum UserInstruction {
    DepositCollateral {
        amount: u64,
    },
    WithdrawCollateral {
        amount: u64,
    },
    CancelOrder {
        order: PreOrder,
        signature: [u8; 64],
    },
    SettleTrade {
        trade_id: u64,
    },
    CancelTrade {
        trade_id: u64,
    },
}
```

#### **Relayer Instructions:**
```rust
pub enum RelayerInstruction {
    MatchOrders {
        buy_order: PreOrder,
        sell_order: PreOrder,
        buy_signature: [u8; 64],
        sell_signature: [u8; 64],
        fill_amount: Option<u64>,
    },
}
```

---

## 8. ✅ **SUCCESS CRITERIA**

### **Functional Requirements:**
- [ ] All business flows implemented và tested
- [ ] Economic model equivalent to EVM version
- [ ] Security model robust và audited
- [ ] Performance acceptable for production use

### **Non-Functional Requirements:**
- [ ] Transaction costs < $0.01 per operation
- [ ] Settlement latency < 10 seconds
- [ ] Support 1000+ concurrent orders
- [ ] 99.9% uptime target

### **Business Requirements:**
- [ ] User experience equivalent to EVM version
- [ ] Risk management equivalent hoặc better
- [ ] Economic incentives preserved
- [ ] Integration-ready APIs

---

**🎯 END OF REQUIREMENTS DOCUMENT**

> **Next Steps**: Use this document as specification để implement Solana programs với full business logic parity to EVM version. 