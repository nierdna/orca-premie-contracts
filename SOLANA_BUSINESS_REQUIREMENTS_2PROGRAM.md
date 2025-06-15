# 📋 PREMARKET TRADING SYSTEM - BUSINESS LOGIC REQUIREMENTS
## 🎯 For Solana Implementation (2-Program Architecture)

> **Source**: Analyzed from Orca Contracts EVM implementation  
> **Purpose**: Complete business logic specification for Solana rebuild  
> **Architecture**: **2 Programs** - EscrowVault + PreMarketTrade (mirrors EVM design)  
> **Date**: December 2024

---

## 📖 **TABLE OF CONTENTS**

1. [System Overview](#system-overview)
2. [Architecture Design](#architecture-design)
3. [Program 1: Escrow Vault](#program-1-escrow-vault)
4. [Program 2: PreMarket Trade](#program-2-premarket-trade)
5. [Cross-Program Integration](#cross-program-integration)
6. [Business Flows](#business-flows)
7. [Security & Validation Rules](#security--validation-rules)
8. [Economic Model](#economic-model)
9. [Events & Monitoring](#events--monitoring)
10. [Implementation Roadmap](#implementation-roadmap)

---

## 🎯 **SYSTEM OVERVIEW**

### **Core Concept**
Pre-market trading system cho phép giao dịch **tokens chưa phát hành** với **collateral-based protection** đảm bảo cả buyer và seller đều có động lực fulfill commitments.

### **Key Features**
- ✅ **Off-chain Order Matching** + **On-chain Settlement**
- ✅ **Collateral-based Protection** cho buyer và seller
- ✅ **Partial Fill Support** với order book functionality  
- ✅ **Grace Period Mechanism** cho seller delivery
- ✅ **Economic Incentive System** với rewards/penalties
- ✅ **Modular Architecture** - Vault tách biệt khỏi Trading Logic

### **Problem Solved**
- Giao dịch token trước khi launch mainnet
- Bảo vệ buyer khỏi seller không deliver
- Bảo vệ seller khỏi buyer cancel bừa bãi
- Tạo thanh khoản sớm cho new projects

---

## 🏗️ **ARCHITECTURE DESIGN**

### **🎯 Why 2-Program Architecture?**

**Mirrors EVM Implementation:**
- **EscrowVault.sol** → **Escrow Vault Program** (Pure custody)
- **PreMarketTrade.sol** → **PreMarket Trade Program** (Business logic)

**Benefits:**
- ✅ **Security Isolation** - Asset custody tách biệt khỏi trading logic
- ✅ **Modularity** - Vault có thể reuse cho other trading systems
- ✅ **Independent Upgrades** - Upgrade trading logic without vault migration
- ✅ **Clear Audit Trail** - Easier để audit asset management separately
- ✅ **Regulatory Compliance** - Asset custody meets specific standards

### **Program Interaction Pattern:**

```
User → PreMarket Trade Program → Cross-Program Invocation → Escrow Vault Program
     ↓                                                    ↓
   Business Logic                                    Asset Custody
   (Orders, Matching,                               (Balances, Transfers,
    Settlement)                                      Collateral Management)
```

### **EVM vs Solana Mapping:**

| EVM Component | Solana Equivalent | Purpose |
|---------------|-------------------|---------|
| `EscrowVault.sol` | **Vault Program** | Asset custody, balance management |
| `PreMarketTrade.sol` | **Trading Program** | Order matching, settlement logic |
| `vault.slashBalance()` | **CPI SlashBalance** | Subtract balance (lock collateral) |
| `vault.creditBalance()` | **CPI CreditBalance** | Add balance (unlock collateral) |
| `vault.transferOut()` | **CPI TransferOut** | Transfer tokens to external wallets |
| `balances[user][token]` | **UserBalance.balance** | Single balance field |
| `totalDeposits[token]` | **VaultAuthority.total_deposits** | Global deposit tracking |
| Contract state | **PDA accounts** | Persistent data storage |
| Role-based access | **Program authority** | Permission management |

### **Key Logic Equivalence:**

| EVM Logic | Solana Logic | Explanation |
|-----------|--------------|-------------|
| `balances[user][token] -= amount` | `user_balance.balance -= amount` | "Lock" collateral by subtraction |
| `balances[user][token] += amount` | `user_balance.balance += amount` | "Unlock" collateral by addition |
| `IERC20(token).safeTransfer(to, amount)` | `token::transfer(vault_to_wallet, amount)` | Transfer tokens to external wallets |
| `vault.transferOut(token, user, amount)` | `transfer_out(token, user_wallet, amount)` | Direct transfer to user wallet |
| No separate "locked" tracking | No separate "locked" tracking | Balance subtraction = locking |

### **🔑 Critical Vault Operations Distinction:**

| Operation | EVM | Solana | Use Case |
|-----------|-----|--------|----------|
| **Lock Collateral** | `balances[user][token] -= amount` | `slash_balance(user, amount)` | Order matching |
| **Unlock to Balance** | `balances[user][token] += amount` | `credit_balance(user, amount)` | Order cancellation (before matching) |
| **Transfer to Wallet** | `IERC20.safeTransfer(wallet, amount)` | `transfer_out(wallet, amount)` | Settlement & trade cancellation |

**Key Point**: Settlement and trade cancellation use `transfer_out()` (external transfer), NOT `credit_balance()` (vault balance)!

---

## 🏦 **PROGRAM 1: ESCROW VAULT**

### **🎯 Purpose**
**Pure asset custody and balance management** - equivalent to EscrowVault.sol

### **A. Account Structures**

#### **VaultConfig (Global State)**
```rust
#[account]
pub struct VaultConfig {
    pub admin: Pubkey,                    // Vault admin (multisig)
    pub emergency_admin: Pubkey,          // Emergency controls
    pub authorized_traders: Vec<Pubkey>,  // Authorized trading programs
    pub paused: bool,                     // Emergency pause
    pub total_users: u32,                 // Statistics
    pub supported_tokens: Vec<Pubkey>,    // Supported token mints
    pub bump: u8,                         // PDA bump
}
```

#### **UserBalance (Per User Per Token)**
```rust
#[account]
pub struct UserBalance {
    pub user: Pubkey,           // User wallet
    pub token_mint: Pubkey,     // Token mint address
    pub balance: u64,           // Total balance (exact EVM mapping)
    pub bump: u8,               // PDA bump
}
```

#### **VaultAuthority (Token Custody)**
```rust
#[account]
pub struct VaultAuthority {
    pub token_mint: Pubkey,     // Token being managed
    pub total_deposits: u64,    // Total deposits for reconciliation (exact EVM mapping)
    pub vault_ata: Pubkey,      // Associated Token Account
    pub bump: u8,               // PDA bump
}
```

### **B. Instructions**

#### **Admin Instructions:**
```rust
pub enum VaultInstruction {
    /// Initialize vault system
    InitializeVault {
        admin: Pubkey,
        emergency_admin: Pubkey,
    },
    
    /// Add authorized trading program
    AddAuthorizedTrader {
        trader_program: Pubkey,
    },
    
    /// Remove authorized trading program
    RemoveAuthorizedTrader {
        trader_program: Pubkey,
    },
    
    /// Add supported token
    AddSupportedToken {
        token_mint: Pubkey,
    },
    
    /// Emergency pause
    Pause,
    
    /// Emergency unpause
    Unpause,
}
```

#### **User Instructions:**
```rust
pub enum UserInstruction {
    /// Deposit collateral tokens
    DepositCollateral {
        amount: u64,
    },
    
    /// Withdraw available balance
    WithdrawCollateral {
        amount: u64,
    },
}
```

#### **CPI-Only Instructions (Called by Trading Programs):**
```rust
pub enum CPIInstruction {
    /// Subtract user balance (exact EVM slashBalance mapping)
    SlashBalance {
        user: Pubkey,
        token_mint: Pubkey,
        amount: u64,
    },
    
    /// Add user balance (exact EVM creditBalance mapping)
    CreditBalance {
        user: Pubkey,
        token_mint: Pubkey,
        amount: u64,
    },
    
    /// Transfer tokens out of vault (exact EVM transferOut mapping)
    TransferOut {
        token_mint: Pubkey,
        recipient: Pubkey,
        amount: u64,
    },
    
    /// Transfer between user balances (exact EVM transferBalance mapping)
    TransferBalance {
        from_user: Pubkey,
        to_user: Pubkey,
        token_mint: Pubkey,
        amount: u64,
    },
}
```

### **C. PDA Seeds**

```rust
// Vault config: ["vault_config"]
pub const VAULT_CONFIG_SEED: &[u8] = b"vault_config";

// User balance: ["user_balance", user_pubkey, token_mint]
pub const USER_BALANCE_SEED: &[u8] = b"user_balance";

// Vault authority: ["vault_authority", token_mint]
pub const VAULT_AUTHORITY_SEED: &[u8] = b"vault_authority";
```

### **D. Security Features**

```rust
// Authorization check for CPI calls
pub fn verify_authorized_trader(program_id: &Pubkey, config: &VaultConfig) -> Result<()> {
    require!(
        config.authorized_traders.contains(program_id),
        VaultError::UnauthorizedTrader
    );
    Ok(())
}

// Balance validation (exact EVM logic)
pub fn validate_sufficient_balance(
    user_balance: &UserBalance,
    amount: u64,
) -> Result<()> {
    require!(user_balance.balance >= amount, VaultError::InsufficientBalance);
    Ok(())
}
```

---

## 📈 **PROGRAM 2: PREMARKET TRADE**

### **🎯 Purpose**
**Trading logic and order management** - equivalent to PreMarketTrade.sol

### **A. Account Structures**

#### **TradeConfig (Global State)**
```rust
#[account]
pub struct TradeConfig {
    pub admin: Pubkey,                  // Trading admin
    pub vault_program: Pubkey,          // Reference to vault program
    pub relayers: Vec<Pubkey>,          // Authorized relayers
    pub economic_config: EconomicConfig,// Economic parameters
    pub technical_config: TechnicalConfig, // Technical parameters
    pub paused: bool,                   // Emergency pause
    pub bump: u8,                       // PDA bump
}
```

#### **TokenMarket**
```rust
#[account]
pub struct TokenMarket {
    pub token_id: Pubkey,           // Account address as unique token ID (EVM compatible naming)
    pub symbol: String,             // Token symbol (max 10 chars)
    pub name: String,               // Token name (max 50 chars)
    pub real_mint: Option<Pubkey>,  // Real token mint (after mapping)
    pub mapping_time: Option<i64>,  // When token was mapped
    pub settle_time_limit: u32,     // Grace period in seconds
    pub created_at: i64,            // Creation timestamp
    // NOTE: No bump field - not a PDA, user-controlled keypair
}
```

#### **TradeRecord**
```rust
#[account]
pub struct TradeRecord {
    pub trade_id: Pubkey,           // Account address as unique trade ID (EVM compatible naming)
    pub buyer: Pubkey,              // Buyer wallet
    pub seller: Pubkey,             // Seller wallet
    pub token_id: Pubkey,           // TokenMarket account address as token ID (EVM compatible naming)
    pub collateral_mint: Pubkey,    // Collateral token mint
    pub filled_amount: u64,         // Amount filled
    pub price: u64,                 // Price per token (6 decimals)
    pub buyer_collateral: u64,      // Buyer collateral locked
    pub seller_collateral: u64,     // Seller collateral locked
    pub match_time: i64,            // When trade was matched
    pub settled: bool,              // Settlement status
    pub target_mint: Option<Pubkey>,// Real token mint (after settlement)
    // NOTE: No bump field - not a PDA, user-controlled keypair
}
```

#### **OrderStatus**
```rust
#[account]
pub struct OrderStatus {
    pub order_hash: [u8; 32],       // Order hash
    pub trader: Pubkey,             // Order creator
    pub total_amount: u64,          // Original order amount
    pub filled_amount: u64,         // Amount filled so far
    pub fill_count: u16,            // Number of partial fills
    pub last_fill_time: i64,        // Last fill timestamp
    pub cancelled: bool,            // Cancellation status
    pub bump: u8,                   // PDA bump
}
```

### **B. Core Data Types**

#### **PreOrder (Updated for Keypair Pattern)**
```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PreOrder {
    pub trader: Pubkey,             // Order creator
    pub collateral_token: Pubkey,   // Collateral mint
    pub token_id: Pubkey,           // TokenMarket account address as token ID (EVM compatible naming)
    pub amount: u64,                // Order amount
    pub price: u64,                 // Price (6 decimals)
    pub is_buy: bool,               // Buy/sell flag
    pub nonce: u64,                 // Replay protection
    pub deadline: i64,              // Order expiration
}
```

#### **Economic Config**
```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct EconomicConfig {
    pub buyer_collateral_ratio: u16,    // Default: 10000 (100%)
    pub seller_collateral_ratio: u16,   // Default: 10000 (100%)
    pub seller_reward_bps: u16,         // Default: 0 (0%)
    pub late_penalty_bps: u16,          // Default: 10000 (100%)
    pub minimum_fill_amount: u64,       // Default: 1000
    pub maximum_order_amount: u64,      // Default: 1e12
}
```

### **C. Instructions**

#### **Admin Instructions:**
```rust
pub enum AdminInstruction {
    /// Initialize trading system
    InitializeTrading {
        vault_program: Pubkey,
        economic_config: EconomicConfig,
        technical_config: TechnicalConfig,
    },
    
    /// Create new token market
    CreateTokenMarket {
        token_keypair: Pubkey,         // Client-generated keypair for TokenMarket
        symbol: String,
        name: String,
        settle_time_limit: u32,
    },
    
    /// Map real token to market
    MapToken {
        token_id: Pubkey,              // TokenMarket account address as token ID
        real_mint: Pubkey,
    },
    
    /// Update economic parameters
    UpdateEconomicConfig {
        new_config: EconomicConfig,
    },
    
    /// Add/remove relayers
    ManageRelayers {
        relayer: Pubkey,
        add: bool,
    },
}
```

#### **Trading Instructions:**
```rust
pub enum TradingInstruction {
    /// Match buy and sell orders
    MatchOrders {
        trade_keypair: Pubkey,         // Client-generated keypair for TradeRecord
        buy_order: PreOrder,
        sell_order: PreOrder,
        buy_signature: [u8; 64],
        sell_signature: [u8; 64],
        fill_amount: Option<u64>,
    },
    
    /// Settle completed trade
    SettleTrade {
        trade_id: Pubkey,              // TradeRecord account address as trade ID
    },
    
    /// Cancel trade after grace period
    CancelTrade {
        trade_id: Pubkey,              // TradeRecord account address as trade ID
    },
    
    /// Cancel order before matching
    CancelOrder {
        order: PreOrder,
        signature: [u8; 64],
    },
}
```

### **D. PDA Seeds (Updated)**

```rust
// Trade config: ["trade_config"] - Still PDA
pub const TRADE_CONFIG_SEED: &[u8] = b"trade_config";

// Order status: ["order_status", order_hash] - Still PDA
pub const ORDER_STATUS_SEED: &[u8] = b"order_status";

// NOTE: TokenMarket and TradeRecord are now user-controlled keypairs, not PDAs
// - TokenMarket: Client generates keypair, address stored as token_id field
// - TradeRecord: Client generates keypair, address stored as trade_id field
```

---

## 🔗 **CROSS-PROGRAM INTEGRATION**

### **A. CPI Call Pattern**

#### **From Trading Program to Vault Program:**
```rust
// In match_orders instruction
pub fn match_orders(ctx: Context<MatchOrders>, /* params */) -> Result<()> {
    // 1. Validate orders and signatures
    validate_orders(&buy_order, &sell_order)?;
    verify_signatures(&buy_order, &sell_order, &signatures)?;
    
    // 2. Calculate collateral requirements
    let (buyer_collateral, seller_collateral) = calculate_collateral(
        fill_amount, 
        price, 
        &ctx.accounts.config.economic_config
    )?;
    
    // 3. CPI to vault: Subtract buyer collateral (exact EVM slashBalance)
    let slash_buyer_accounts = SlashBalance {
        config: ctx.accounts.vault_config.to_account_info(),
        user_balance: ctx.accounts.buyer_balance.to_account_info(),
        authority: ctx.accounts.vault_authority.to_account_info(),
    };
    
    let cpi_ctx = CpiContext::new(
        ctx.accounts.vault_program.to_account_info(),
        slash_buyer_accounts,
    );
    
    vault_program::cpi::slash_balance(
        cpi_ctx,
        buy_order.trader,
        buy_order.collateral_token,
        buyer_collateral,
    )?;
    
    // 4. CPI to vault: Subtract seller collateral (exact EVM slashBalance)
    let slash_seller_accounts = SlashBalance {
        config: ctx.accounts.vault_config.to_account_info(),
        user_balance: ctx.accounts.seller_balance.to_account_info(),
        authority: ctx.accounts.vault_authority.to_account_info(),
    };
    
    let cpi_ctx = CpiContext::new(
        ctx.accounts.vault_program.to_account_info(),
        slash_seller_accounts,
    );
    
    vault_program::cpi::slash_balance(
        cpi_ctx,
        sell_order.trader,
        sell_order.collateral_token,
        seller_collateral,
    )?;
    
    // 5. Create trade record
    create_trade_record(ctx, &buy_order, &sell_order, fill_amount)?;
    
    Ok(())
}
```

### **B. Account Validation**

```rust
#[derive(Accounts)]
pub struct MatchOrders<'info> {
    // Trading program accounts
    #[account(mut)]
    pub config: Account<'info, TradeConfig>,
    
    #[account(
        mut,
        constraint = trade_record.owner == &crate::ID,  // Verify program ownership
        constraint = trade_record.data_len() == TradeRecord::LEN,
    )]
    pub trade_record: Account<'info, TradeRecord>,  // User-controlled keypair, not PDA
    
    // Vault program accounts (for CPI)
    /// CHECK: Validated in CPI call
    pub vault_program: AccountInfo<'info>,
    
    /// CHECK: Validated in CPI call
    pub vault_config: AccountInfo<'info>,
    
    /// CHECK: Validated in CPI call
    pub buyer_balance: AccountInfo<'info>,
    
    /// CHECK: Validated in CPI call
    pub seller_balance: AccountInfo<'info>,
    
    /// CHECK: Validated in CPI call
    pub vault_authority: AccountInfo<'info>,
    
    // System accounts
    #[account(mut)]
    pub relayer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
```

### **C. Error Handling**

```rust
// Trading program errors
#[error_code]
pub enum TradingError {
    #[msg("Invalid signature")]
    InvalidSignature,
    #[msg("Orders incompatible")]
    IncompatibleOrders,
    #[msg("Trade already settled")]
    TradeAlreadySettled,
    #[msg("Grace period active")]
    GracePeriodActive,
    #[msg("Vault CPI failed")]
    VaultCPIFailed,
}

// Handle CPI errors
pub fn handle_vault_error(error: ProgramError) -> TradingError {
    match error {
        // Map vault errors to trading errors
        _ => TradingError::VaultCPIFailed,
    }
}
```

---

## 🔄 **BUSINESS FLOWS (Updated for 2-Program)**

### **1. 🏪 MARKET CREATION FLOW**

```
Admin → Generate TokenMarket Keypair (Client-side)
↓
Admin → PreMarket Trade Program → CreateTokenMarket {
    token_keypair: token_keypair.publicKey,
    symbol: "TOKEN",
    name: "My Token", 
    settle_time_limit: 259200  // 3 days
}
↓
SystemProgram creates account at token_keypair.publicKey (owned by Trading Program)
↓
Initialize TokenMarket account with token_id = account address
↓
Emit TokenMarketCreated event with token_id (EVM compatible)
```

### **2. 💰 COLLATERAL MANAGEMENT FLOW**

```
User → Escrow Vault Program → DepositCollateral {
    token_mint: USDC_MINT,
    amount: 1000_000000  // 1000 USDC
}
↓
Transfer from user ATA to vault ATA
↓
Update UserBalance account (balance += amount) // Exact EVM logic
↓
Update VaultAuthority (total_deposits += amount) // Exact EVM logic
↓
Emit CollateralDeposited event
```

### **3. 🔀 ORDER MATCHING FLOW (Cross-Program)**

```
Relayer → PreMarket Trade Program → MatchOrders {
    buy_order, sell_order, signatures, fill_amount
}
↓
Validate orders and signatures
↓
Calculate collateral requirements
↓
CPI to Vault Program → SlashBalance (buyer collateral) // Subtract balance
↓
CPI to Vault Program → SlashBalance (seller collateral) // Subtract balance
↓
Create TradeRecord account
↓
Update OrderStatus accounts
↓
Emit OrdersMatched event

// Note: SlashBalance = "lock collateral" by subtracting from balance (exact EVM logic)
```

### **4. ✅ SETTLEMENT FLOW (Cross-Program)**

```
Seller → PreMarket Trade Program → SettleTrade { trade_id }
↓
Validate settlement conditions
↓
Transfer real tokens: seller ATA → buyer ATA
↓
Calculate rewards and total release
↓
CPI to Vault Program → TransferOut (total collateral + reward to seller)
↓
Update TradeRecord.settled = true
↓
Emit TradeSettled event

// Note: TransferOut sends tokens directly from vault (exact EVM logic)
// Collateral was already "locked" by SlashBalance (balance subtraction)
```

### **5. 🚨 CANCEL TRADE IMPLEMENTATION (Corrected)**

```
Buyer → PreMarket Trade Program → CancelTrade { trade_id }
↓
Validate cancellation conditions (grace period expired)
↓
Calculate penalty distribution
↓
CPI to Vault Program → TransferOut (buyer collateral + penalty to buyer wallet)
↓
CPI to Vault Program → TransferOut (remaining seller collateral to seller wallet)
↓
Update TradeRecord.settled = true
↓
Emit TradeCancelled event

// IMPORTANT: TransferOut sends tokens DIRECTLY to user wallets (exact EVM logic)
// NO credit_balance() - that would be inconsistent with EVM behavior
```

### **6. 📊 COMPLETE TRADE FLOW EXAMPLE**

```rust
// Initial state: User deposits 1000 USDC
user_balance.balance = 1000;
vault_authority.total_deposits = 1000;

// Step 1: Order matched - "lock" 200 USDC collateral
// EVM: balances[user][USDC] -= 200;
// Solana: user_balance.balance -= 200;
slash_balance(user, USDC, 200);
// Result: user_balance.balance = 800 (200 "locked" by subtraction)

// Step 2a: Trade settled - release collateral to seller
// EVM: IERC20(USDC).safeTransfer(seller, 200);
// Solana: token::transfer(seller_ata, 200);
transfer_out(USDC, seller_wallet, 200);
// Result: user_balance.balance = 800 (unchanged, tokens went to seller wallet)

// Step 2b: OR trade cancelled - return collateral to buyer
// EVM: IERC20(USDC).safeTransfer(buyer, 200);
// Solana: token::transfer(buyer_ata, 200);
transfer_out(USDC, buyer_wallet, 200);
// Result: user_balance.balance = 800 (unchanged, tokens went to buyer wallet)

// CRITICAL: Both settlement and cancellation use transfer_out() to external wallets
// NO credit_balance() - that would be inconsistent with EVM behavior
```

---

## 🛡️ **SECURITY & VALIDATION RULES**

### **A. Cross-Program Security**

#### **Program ID Validation:**
```rust
// In vault program - verify caller is authorized trader
pub fn verify_authorized_trader(ctx: &Context<SlashBalance>) -> Result<()> {
    let config = &ctx.accounts.config;
    let caller_program = ctx.program_id;
    
    require!(
        config.authorized_traders.contains(caller_program),
        VaultError::UnauthorizedTrader
    );
    
    Ok(())
}
```

#### **Account Ownership Validation:**
```rust
// Ensure accounts belong to correct programs
pub fn validate_account_ownership<'info>(
    account: &AccountInfo<'info>,
    expected_owner: &Pubkey,
) -> Result<()> {
    require!(
        account.owner == expected_owner,
        TradingError::InvalidAccountOwner
    );
    Ok(())
}
```

### **B. Signature Security**

```rust
pub fn verify_order_signature(
    order: &PreOrder,
    signature: &[u8; 64],
) -> Result<()> {
    let message = create_order_message(order);
    
    require!(
        ed25519_verify(signature, &message, &order.trader.to_bytes()),
        TradingError::InvalidSignature
    );
    
    Ok(())
}

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

### **C. Economic Security**

```rust
// Safe math operations
pub fn safe_calculate_collateral(
    amount: u64,
    price: u64,
    ratio: u16,
) -> Result<u64> {
    let trade_value = amount
        .checked_mul(price)
        .ok_or(TradingError::MathOverflow)?
        .checked_div(PRICE_SCALE)
        .ok_or(TradingError::MathOverflow)?;
    
    let collateral = trade_value
        .checked_mul(ratio as u64)
        .ok_or(TradingError::MathOverflow)?
        .checked_div(10000)
        .ok_or(TradingError::MathOverflow)?;
    
    Ok(collateral)
}

// Price bounds validation
pub fn validate_price_bounds(price: u64) -> Result<()> {
    require!(price >= MIN_PRICE, TradingError::PriceTooLow);
    require!(price <= MAX_PRICE, TradingError::PriceTooHigh);
    Ok(())
}

// Constants
pub const PRICE_SCALE: u64 = 1_000_000; // 6 decimals
pub const MIN_PRICE: u64 = 1_000; // 0.001
pub const MAX_PRICE: u64 = 1_000_000_000_000_000_000; // 1e18
```

---

## 📈 **ECONOMIC MODEL**

### **A. Incentive Structure (Same as EVM)**

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

### **B. Economic Parameters**

```rust
pub struct EconomicConfig {
    // Collateral ratios (basis points: 10000 = 100%)
    pub buyer_collateral_ratio: u16,   // Default: 10000 (100%)
    pub seller_collateral_ratio: u16,  // Default: 10000 (100%)
    
    // Incentive parameters (basis points)
    pub seller_reward_bps: u16,        // Default: 0 (0%, max 1000 = 10%)
    pub late_penalty_bps: u16,          // Default: 10000 (100%)
    
    // Risk management
    pub minimum_fill_amount: u64,       // Default: 1000 (0.001 tokens)
    pub maximum_order_amount: u64,      // Default: 1e12 (1M tokens)
}
```

### **C. Economic Calculations**

```rust
// Trade value calculation
pub fn calculate_trade_value(amount: u64, price: u64) -> Result<u64> {
    amount
        .checked_mul(price)
        .ok_or(TradingError::MathOverflow)?
        .checked_div(PRICE_SCALE)
        .ok_or(TradingError::MathOverflow)
}

// Collateral calculation
pub fn calculate_collateral(
    trade_value: u64,
    collateral_ratio: u16,
) -> Result<u64> {
    trade_value
        .checked_mul(collateral_ratio as u64)
        .ok_or(TradingError::MathOverflow)?
        .checked_div(10000)
        .ok_or(TradingError::MathOverflow)
}

// Reward/penalty calculation
pub fn calculate_reward_or_penalty(
    trade_value: u64,
    basis_points: u16,
) -> Result<u64> {
    if basis_points == 0 {
        return Ok(0);
    }
    
    trade_value
        .checked_mul(basis_points as u64)
        .ok_or(TradingError::MathOverflow)?
        .checked_div(10000)
        .ok_or(TradingError::MathOverflow)
}
```

---

## 📊 **EVENTS & MONITORING**

### **Vault Program Events:**
```rust
#[event]
pub struct CollateralDeposited {
    pub user: Pubkey,
    pub token_mint: Pubkey,
    pub amount: u64,
    pub new_balance: u64,           // Exact EVM mapping
}

#[event]
pub struct CollateralWithdrawn {
    pub user: Pubkey,
    pub token_mint: Pubkey,
    pub amount: u64,
    pub remaining_balance: u64,     // Exact EVM mapping
}

#[event]
pub struct BalanceSlashed {
    pub user: Pubkey,
    pub token_mint: Pubkey,
    pub amount: u64,
    pub caller_program: Pubkey,
}

#[event]
pub struct BalanceCredited {
    pub user: Pubkey,
    pub token_mint: Pubkey,
    pub amount: u64,
    pub caller_program: Pubkey,
}
```

### **Trading Program Events:**
```rust
#[event]
pub struct TokenMarketCreated {
    pub token_id: Pubkey,           // Account address as token ID (EVM compatible naming)
    pub symbol: String,
    pub name: String,
    pub settle_time_limit: u32,
    pub created_at: i64,
}

#[event]
pub struct OrdersMatched {
    pub trade_id: Pubkey,           // Account address as trade ID (EVM compatible naming)
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub token_id: Pubkey,           // Account address as token ID (EVM compatible naming)
    pub filled_amount: u64,
    pub price: u64,
    pub buyer_collateral: u64,
    pub seller_collateral: u64,
    pub match_time: i64,
}

#[event]
pub struct TradeSettled {
    pub trade_id: Pubkey,           // Account address as trade ID (EVM compatible naming)
    pub seller: Pubkey,
    pub buyer: Pubkey,
    pub target_mint: Pubkey,
    pub filled_amount: u64,
    pub seller_reward: u64,
    pub settlement_time: i64,
}

#[event]
pub struct TradeCancelled {
    pub trade_id: Pubkey,           // Account address as trade ID (EVM compatible naming)
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub penalty_amount: u64,
    pub cancellation_time: i64,
}

#[event]
pub struct TokenMapped {
    pub token_id: Pubkey,           // Account address as token ID (EVM compatible naming)
    pub real_mint: Pubkey,
    pub mapping_time: i64,
}
```

---

## 🎯 **IMPLEMENTATION ROADMAP**

### **Phase 1: Vault Program Foundation**
1. ✅ Initialize vault program structure
2. ✅ Implement deposit/withdraw functionality
3. ✅ Add authorization system for trading programs
4. ✅ Create CPI instruction handlers
5. ✅ Add comprehensive testing

### **Phase 2: Trading Program Core**
1. ✅ Initialize trading program structure
2. ✅ Implement token market creation
3. ✅ Add order signature verification
4. ✅ Create basic admin functions

### **Phase 3: Cross-Program Integration**
1. ✅ Implement CPI calls from trading to vault
2. ✅ Add proper account validation
3. ✅ Handle cross-program errors
4. ✅ Test integration scenarios

### **Phase 4: Business Logic Implementation**
1. ✅ Order matching with CPI collateral locking
2. ✅ Settlement with CPI token transfers
3. ✅ Cancellation with CPI penalty distribution
4. ✅ Partial fill support

---

## 🔑 **ACCOUNT CREATION PATTERN**

### **Client-Side Account Management (Recommended)**

**Rationale**: Following production-proven pattern used by major DEX protocols (Jupiter, Raydium, Serum) for maximum compatibility and flexibility.

#### **Account Creation Flows:**

```typescript
// Client-side implementation for both TokenMarket and TradeRecord
export class AccountManager {
  // TokenMarket creation (Admin only)
  async createTokenMarket(marketData: TokenMarketData): Promise<TransactionResult> {
    const tokenKeypair = Keypair.generate();
    
    const createAccountIx = SystemProgram.createAccount({
      fromPubkey: this.admin.publicKey,
      newAccountPubkey: tokenKeypair.publicKey,
      lamports: await this.connection.getMinimumBalanceForRentExemption(TOKEN_MARKET_SIZE),
      space: TOKEN_MARKET_SIZE,
      programId: TRADING_PROGRAM_ID,
    });
    
    const initializeIx = await this.program.methods
      .createTokenMarket(marketData.symbol, marketData.name, marketData.settleTimeLimit)
      .accounts({
        tokenMarket: tokenKeypair.publicKey,
        admin: this.admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    
    return {
      transaction: new Transaction().add(createAccountIx).add(initializeIx),
      signers: [this.admin, tokenKeypair],
      tokenId: tokenKeypair.publicKey,  // EVM compatible naming
    };
  }

  // TradeRecord creation (Relayer during order matching)
  async createTradeRecord(tradeData: TradeData): Promise<TransactionResult> {
    const tradeKeypair = Keypair.generate();
    
    const createAccountIx = SystemProgram.createAccount({
      fromPubkey: this.relayer.publicKey,
      newAccountPubkey: tradeKeypair.publicKey,
      lamports: await this.connection.getMinimumBalanceForRentExemption(TRADE_RECORD_SIZE),
      space: TRADE_RECORD_SIZE,
      programId: TRADING_PROGRAM_ID,
    });
    
    // Note: TradeRecord is created during MatchOrders instruction
    // No separate initialization needed
    
    return {
      createAccountIx,
      tradeKeypair,
      tradeId: tradeKeypair.publicKey,  // EVM compatible naming
    };
  }
}
```

#### **Program-side Account Handling:**

```rust
// TokenMarket creation
#[derive(Accounts)]
pub struct CreateTokenMarket<'info> {
    #[account(
        mut,
        constraint = token_market.owner == &crate::ID,
        constraint = token_market.data_len() == TokenMarket::LEN,
    )]
    pub token_market: Account<'info, TokenMarket>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn create_token_market(
    ctx: Context<CreateTokenMarket>,
    symbol: String,
    name: String,
    settle_time_limit: u32,
) -> Result<()> {
    let token_market = &mut ctx.accounts.token_market;
    
    // Set token_id to account address for EVM compatibility
    token_market.token_id = ctx.accounts.token_market.key();
    token_market.symbol = symbol;
    token_market.name = name;
    token_market.real_mint = None;
    token_market.mapping_time = None;
    token_market.settle_time_limit = settle_time_limit;
    token_market.created_at = Clock::get()?.unix_timestamp;
    
    Ok(())
}

// TradeRecord creation (during MatchOrders)
#[derive(Accounts)]
pub struct MatchOrders<'info> {
    #[account(
        mut,
        constraint = trade_record.owner == &crate::ID,
        constraint = trade_record.data_len() == TradeRecord::LEN,
    )]
    pub trade_record: Account<'info, TradeRecord>,  // Created by client, initialized here
    
    #[account(mut)]
    pub token_market: Account<'info, TokenMarket>,  // Referenced by orders
    
    #[account(mut)]
    pub relayer: Signer<'info>,
    
    // ... vault CPI accounts
}

pub fn match_orders(
    ctx: Context<MatchOrders>,
    buy_order: PreOrder,
    sell_order: PreOrder,
    // ... other params
) -> Result<()> {
    // Initialize TradeRecord during matching
    let trade_record = &mut ctx.accounts.trade_record;
    
    // Set trade_id to account address for EVM compatibility
    trade_record.trade_id = ctx.accounts.trade_record.key();
    trade_record.buyer = buy_order.trader;
    trade_record.seller = sell_order.trader;
    trade_record.token_id = ctx.accounts.token_market.key();
    trade_record.collateral_mint = buy_order.collateral_token;
    trade_record.filled_amount = fill_amount;
    trade_record.price = buy_order.price;
    trade_record.match_time = Clock::get()?.unix_timestamp;
    trade_record.settled = false;
    
    // ... rest of matching logic
    Ok(())
}
```

#### **Account Ownership Mechanics:**

```rust
// Account ownership flow:
// 1. Client generates keypair
let trade_keypair = Keypair::new();

// 2. SystemProgram creates account with Trading Program as owner
SystemProgram::create_account(
    from: relayer,                    // Payer
    to: trade_keypair.pubkey,        // New account address
    lamports: rent_amount,           // SOL for rent exemption
    space: TRADE_ACCOUNT_SIZE,       // Account data size
    owner: TRADING_PROGRAM_ID,       // ← Program immediately owns account
);

// 3. Account is created with proper ownership
AccountInfo {
    key: trade_keypair.pubkey,
    owner: TRADING_PROGRAM_ID,       // ← Already owned by Trading Program
    lamports: rent_amount,
    data: [0; TRADE_ACCOUNT_SIZE],   // Uninitialized data
    executable: false,
}

// 4. Trading Program can now modify account data
// No ownership transfer needed - account belongs to program from creation
```

#### **Security Requirements:**

```rust
// Why trade_keypair must sign:
// 1. Prevent account hijacking
// 2. Ensure address ownership claim
// 3. Solana security model enforcement

// Transaction signature requirements:
// - relayer: Pays for account creation and rent
// - trade_keypair: Claims ownership of the address
// - Both signatures required for security
```

#### **Integration with Business Logic:**

```typescript
// Complete order matching flow with keypair-based accounts
export class OrcaTradeService {
  // Admin creates token market
  async createTokenMarket(
    admin: Keypair,
    symbol: string,
    name: string,
    settleTimeLimit: number
  ): Promise<string> {
    const { transaction, signers, tokenId } = 
      await this.accountManager.createTokenMarket({
        symbol,
        name,
        settleTimeLimit,
      });
    
    const txId = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      signers  // [admin, tokenKeypair]
    );
    
    return tokenId.toString();  // EVM compatible naming
  }

  // Relayer matches orders (creates TradeRecord)
  async matchOrders(
    relayer: Keypair,
    buyOrder: PreOrder,
    sellOrder: PreOrder,
    buySignature: Buffer,
    sellSignature: Buffer,
    fillAmount?: BN
  ): Promise<string> {
    // 1. Create TradeRecord account
    const { createAccountIx, tradeKeypair, tradeId } = 
      await this.accountManager.createTradeRecord({
        buyOrder,
        sellOrder,
        fillAmount,
      });
    
    // 2. Match orders instruction
    const matchOrdersIx = await this.tradingProgram.methods
      .matchOrders(buyOrder, sellOrder, Array.from(buySignature), Array.from(sellSignature), fillAmount)
      .accounts({
        tradeRecord: tradeId,
        tokenMarket: buyOrder.token_id,  // EVM compatible naming
        relayer: relayer.publicKey,
        // ... vault CPI accounts
      })
      .instruction();
    
    // 3. Atomic transaction (create TradeRecord + match orders + CPI vault operations)
    const transaction = new Transaction()
      .add(createAccountIx)
      .add(matchOrdersIx);
    
    const txId = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [relayer, tradeKeypair]  // Both must sign
    );
    
    return tradeId.toString();  // EVM compatible naming
  }

  // Settlement using TradeRecord address
  async settleTrade(
    seller: Keypair,
    tradeId: PublicKey,  // EVM compatible naming
    realTokenMint: PublicKey
  ): Promise<string> {
    const settleIx = await this.tradingProgram.methods
      .settleTrade()
      .accounts({
        tradeRecord: tradeId,  // Direct address reference
        seller: seller.publicKey,
        realTokenMint,
        // ... vault CPI accounts
      })
      .instruction();
    
    return await sendAndConfirmTransaction(
      this.connection,
      new Transaction().add(settleIx),
      [seller]
    );
  }
}
```

### **Advantages of User-Controlled Keypair Pattern:**

1. **EVM Compatibility**: Mirrors EVM transaction construction pattern
2. **Production Proven**: Used by all major Solana DEX protocols
3. **Atomic Operations**: Account creation + initialization in single transaction
4. **Client Control**: Full control over keypair generation and management
5. **Flexibility**: Easy to customize and extend
6. **Relayer Architecture**: Perfect fit for relayer-based order matching
7. **Predictable Addresses**: Client knows account address before transaction
8. **No Race Conditions**: Eliminates sequential counter issues in parallel execution
9. **Simplified Architecture**: No complex PDA seed management
10. **Direct References**: Use account addresses directly instead of derived IDs

### **Implementation Guidelines:**

1. **Always use atomic transactions** for account creation + initialization
2. **Validate program ownership** in all account constraints
3. **Handle rent exemption** properly for account sustainability
4. **Implement proper error handling** for account creation failures
5. **Use consistent account sizing** to avoid reallocation issues
6. **Store keypairs securely** on client side for future reference
7. **Use account addresses as unique identifiers** instead of sequential IDs
8. **Reference related accounts directly** (e.g., token_id field contains account address)
9. **Maintain address mapping** for off-chain indexing and queries
10. **Store account address in ID fields** for EVM compatibility (trade_id, token_id)

### **Phase 5: Advanced Features**
1. ✅ Economic parameter management
2. ✅ Emergency controls
3. ✅ Monitoring and analytics
4. ✅ Performance optimizations

### **Phase 6: Production Readiness**
1. ✅ Security audit (both programs)
2. ✅ Load testing
3. ✅ Documentation
4. ✅ Deployment automation

---

## 📚 **PROGRAM DEPLOYMENT**

### **Deployment Order:**
1. **Deploy Vault Program first** (independent)
2. **Deploy Trading Program** (references vault program ID)
3. **Initialize Vault** with admin keys
4. **Initialize Trading** with vault program reference
5. **Authorize Trading Program** in vault config

### **Program IDs Configuration:**
```rust
// In trading program
pub const VAULT_PROGRAM_ID: Pubkey = pubkey!("VaultProgramID...");

// In vault program  
pub fn is_authorized_trader(program_id: &Pubkey) -> bool {
    // Check against authorized_traders list
}
```

### **Initialization Sequence:**
```rust
// 1. Initialize Vault Program
let vault_config = VaultConfig {
    admin: admin_pubkey,
    emergency_admin: emergency_admin_pubkey,
    authorized_traders: vec![],
    paused: false,
    total_users: 0,
    supported_tokens: vec![USDC_MINT, USDT_MINT],
    bump,
};

// 2. Initialize Trading Program
let trade_config = TradeConfig {
    admin: admin_pubkey,
    vault_program: vault_program_id,
    relayers: vec![relayer_pubkey],
    economic_config: EconomicConfig::default(),
    technical_config: TechnicalConfig::default(),
    paused: false,
    bump,
};

// 3. Authorize Trading Program in Vault
vault_program::add_authorized_trader(trading_program_id);
```

---

## ✅ **SUCCESS CRITERIA**

### **Architecture Requirements:**
- [ ] Clean separation between asset custody and business logic
- [ ] Secure cross-program communication
- [ ] Independent upgrade capability
- [ ] Modular design for future extensions

### **Functional Requirements:**
- [ ] All EVM business flows replicated
- [ ] Economic model equivalent
- [ ] Security model robust
- [ ] Performance acceptable

### **Integration Requirements:**
- [ ] Vault reusable for other trading systems
- [ ] Clear API boundaries
- [ ] Comprehensive error handling
- [ ] Proper event emission

### **Performance Requirements:**
- [ ] Transaction costs < $0.01 per operation
- [ ] Settlement latency < 10 seconds
- [ ] Support 1000+ concurrent orders
- [ ] 99.9% uptime target

---

## 🔍 **COMPARISON WITH EVM IMPLEMENTATION**

### **Architecture Mapping:**

| EVM Component | Solana Equivalent | Key Differences |
|---------------|-------------------|-----------------|
| `EscrowVault.sol` | **Vault Program** | Same functionality, different account model |
| `PreMarketTrade.sol` | **Trading Program** | CPI calls instead of direct calls |
| `vault.slashBalance()` | **CPI SlashBalance** | Subtract balance (lock collateral) |
| `vault.creditBalance()` | **CPI CreditBalance** | Add balance (unlock collateral) |
| `vault.transferOut()` | **CPI TransferOut** | Transfer tokens to external wallets |
| `balances[user][token]` | **UserBalance.balance** | Single balance field |
| `totalDeposits[token]` | **VaultAuthority.total_deposits** | Global deposit tracking |
| Contract state | **PDA accounts** | Persistent data storage |
| Role-based access | **Program authority** | PDA-based permissions |

### **🚨 CANCEL TRADE IMPLEMENTATION (Corrected)**

```rust
// Solana implementation matching EVM cancelAfterGracePeriod()
pub fn cancel_trade(ctx: Context<CancelTrade>) -> Result<()> {
    let trade = &ctx.accounts.trade_record;
    
    // Validate grace period expired (same as EVM)
    require!(
        Clock::get()?.unix_timestamp > trade.match_time + grace_period,
        TradingError::GracePeriodNotExpired
    );
    
    // Calculate penalty (same as EVM)
    let penalty = calculate_penalty(trade.filled_amount, trade.price);
    let buyer_receives = trade.buyer_collateral + penalty;
    let seller_receives = trade.seller_collateral.saturating_sub(penalty);
    
    // ✅ CORRECT: Transfer tokens DIRECTLY to wallets (matches EVM)
    vault_program::cpi::transfer_out(
        cpi_ctx,
        trade.collateral_mint,
        trade.buyer,           // → Buyer's external wallet
        buyer_receives,
    )?;
    
    if seller_receives > 0 {
        vault_program::cpi::transfer_out(
            cpi_ctx,
            trade.collateral_mint,
            trade.seller,       // → Seller's external wallet
            seller_receives,
        )?;
    }
    
    // Update state
    trade.settled = true;
    
    Ok(())
}

// ❌ WRONG: This would be inconsistent with EVM
// vault_program::cpi::credit_balance(cpi_ctx, trade.buyer, buyer_receives)?;
// vault_program::cpi::credit_balance(cpi_ctx, trade.seller, seller_receives)?;
```

### **🔍 EVM vs Solana Comparison:**

| Aspect | EVM (cancelAfterGracePeriod) | Solana (cancel_trade) |
|--------|------------------------------|----------------------|
| **Buyer Gets** | `vault.transferOut(token, buyer, collateral + penalty)` | `transfer_out(token, buyer_wallet, collateral + penalty)` |
| **Seller Gets** | `vault.transferOut(token, seller, remaining)` | `transfer_out(token, seller_wallet, remaining)` |
| **Destination** | External wallet | External wallet |
| **Vault Balance** | Unchanged | Unchanged |
| **Logic** | ✅ Direct transfer | ✅ Direct transfer |