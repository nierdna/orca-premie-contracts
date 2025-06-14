import { ethers } from "hardhat";

/**
 * @title Debug Match Orders Script
 * @notice Script để debug các lỗi trong match orders
 */

async function debugMatchOrders() {
    console.log("🔍 Starting debug process...");

    // Get signers
    const [relayer, buyer, seller] = await ethers.getSigners();
    console.log("📝 Relayer address:", relayer.address);
    console.log("👤 Buyer address:", buyer.address);
    console.log("👤 Seller address:", seller.address);

    // Contract address
    const CONTRACT_ADDRESS = process.env.PREMARKET_CONTRACT || "0x1bfaF47F4bc70772121d3ee8724Cad36557C7a79";
    const USDC_ADDRESS = process.env.USDC_ADDRESS || "0x2fEe5278e6552aA879137a95F550E7736541C303";

    console.log("🏗️ Contract address:", CONTRACT_ADDRESS);
    console.log("💰 USDC address:", USDC_ADDRESS);

    try {
        // Get contract instance
        const preMarketTrade: any = await ethers.getContractAt("PreMarketTrade", CONTRACT_ADDRESS);
        const usdc = await ethers.getContractAt("IERC20", USDC_ADDRESS);

        // Check 1: Relayer role
        console.log("\n=== CHECK 1: RELAYER ROLE ===");
        const RELAYER_ROLE = await preMarketTrade.RELAYER_ROLE();
        const hasRelayerRole = await preMarketTrade.hasRole(RELAYER_ROLE, relayer.address);
        console.log(`Relayer role hash: ${RELAYER_ROLE}`);
        console.log(`Relayer has role: ${hasRelayerRole}`);

        if (!hasRelayerRole) {
            console.log("❌ PROBLEM: Relayer không có RELAYER_ROLE!");
            console.log("💡 Solution: Chạy script setup roles trước");
            return;
        }

        // Check 2: Token exists
        console.log("\n=== CHECK 2: TOKEN EXISTS ===");
        const targetTokenId = process.env.TOKEN_ID!;
        const tokenInfo = await preMarketTrade.tokens(targetTokenId);
        console.log(`Token exists: ${tokenInfo.exists}`);
        console.log(`Token symbol: ${tokenInfo.symbol}`);
        console.log(`Token name: ${tokenInfo.name}`);

        if (!tokenInfo.exists) {
            console.log("❌ PROBLEM: Token chưa được tạo market!");
            console.log("💡 Solution: Chạy script 1-create-token-market.ts trước");
            return;
        }

        // Check 3: Vault address
        console.log("\n=== CHECK 3: VAULT SETUP ===");
        const vaultAddress = await preMarketTrade.vault();
        console.log(`Vault address: ${vaultAddress}`);

        if (vaultAddress === ethers.ZeroAddress) {
            console.log("❌ PROBLEM: Vault chưa được setup!");
            return;
        }

        const vault = await ethers.getContractAt("EscrowVault", vaultAddress);

        // Check 3.1: PreMarket có TRADE_ROLE trong vault không
        console.log("\n=== CHECK 3.1: PREMARKET TRADE_ROLE IN VAULT ===");
        try {
            const TRADE_ROLE = await vault.TRADER_ROLE();
            const preMarketHasTradeRole = await vault.hasRole(TRADE_ROLE, CONTRACT_ADDRESS);
            console.log(`TRADE_ROLE hash: ${TRADE_ROLE}`);
            console.log(`PreMarket contract address: ${CONTRACT_ADDRESS}`);
            console.log(`PreMarket has TRADE_ROLE in vault: ${preMarketHasTradeRole}`);

            if (!preMarketHasTradeRole) {
                console.log("❌ PROBLEM: PreMarket contract không có TRADE_ROLE trong vault!");
                console.log("💡 Solution: Grant TRADE_ROLE cho PreMarket contract trong vault");
                console.log(`💡 Command: vault.grantRole(TRADE_ROLE, "${CONTRACT_ADDRESS}")`);
                return;
            }
        } catch (roleError: any) {
            console.log("❌ Error checking TRADE_ROLE:", roleError.message);
            console.log("💡 Vault có thể không có TRADE_ROLE hoặc access control");
        }

        // Check 4: User balances in vault
        console.log("\n=== CHECK 4: USER BALANCES IN VAULT ===");
        const buyerBalance = await vault.balances(buyer.address, USDC_ADDRESS);
        const sellerBalance = await vault.balances(seller.address, USDC_ADDRESS);

        console.log(`Buyer vault balance: ${ethers.formatUnits(buyerBalance, 6)} USDC`);
        console.log(`Seller vault balance: ${ethers.formatUnits(sellerBalance, 6)} USDC`);

        // Calculate required collateral
        const amount = ethers.parseUnits("5", 6); // 5 tokens
        const price = ethers.parseUnits("2", 6); // 2 USDC per token (updated price)
        const tradeValue = amount * price / BigInt(1e6); // Divide by 1e6 because price is per unit

        console.log(`Trade value: ${ethers.formatUnits(tradeValue, 6)} USDC`);

        const buyerCollateralRatio = await preMarketTrade.buyerCollateralRatio();
        const sellerCollateralRatio = await preMarketTrade.sellerCollateralRatio();

        const requiredBuyerCollateral = (tradeValue * buyerCollateralRatio) / BigInt(100);
        const requiredSellerCollateral = (tradeValue * sellerCollateralRatio) / BigInt(100);

        console.log(`Required buyer collateral: ${ethers.formatUnits(requiredBuyerCollateral, 6)} USDC`);
        console.log(`Required seller collateral: ${ethers.formatUnits(requiredSellerCollateral, 6)} USDC`);

        if (buyerBalance < requiredBuyerCollateral) {
            console.log("❌ PROBLEM: Buyer không có đủ balance trong vault!");
            console.log(`💡 Solution: Deposit thêm ${ethers.formatUnits(requiredBuyerCollateral - buyerBalance, 6)} USDC`);
            return;
        }

        if (sellerBalance < requiredSellerCollateral) {
            console.log("❌ PROBLEM: Seller không có đủ balance trong vault!");
            console.log(`💡 Solution: Deposit thêm ${ethers.formatUnits(requiredSellerCollateral - sellerBalance, 6)} USDC`);
            return;
        }

        // Check 5: Order hash và nonce
        console.log("\n=== CHECK 5: ORDER HASH & NONCE ===");

        const deadline = Math.floor(Date.now() / 1000) + 3600;

        const buyOrder = {
            trader: buyer.address,
            collateralToken: USDC_ADDRESS,
            targetTokenId: targetTokenId,
            amount: ethers.parseUnits("10", 6).toString(),
            price: ethers.parseUnits("2", 6).toString(), // Updated price
            isBuy: true,
            nonce: "1",
            deadline: deadline.toString()
        };

        const sellOrder = {
            trader: seller.address,
            collateralToken: USDC_ADDRESS,
            targetTokenId: targetTokenId,
            amount: ethers.parseUnits("10", 6).toString(),
            price: ethers.parseUnits("2", 6).toString(), // Updated price
            isBuy: false,
            nonce: "1",
            deadline: deadline.toString()
        };

        // Get domain
        const domain = {
            name: "PreMarketTrade",
            version: "1",
            chainId: (await ethers.provider.getNetwork()).chainId,
            verifyingContract: CONTRACT_ADDRESS
        };

        const types = {
            PreOrder: [
                { name: "trader", type: "address" },
                { name: "collateralToken", type: "address" },
                { name: "targetTokenId", type: "bytes32" },
                { name: "amount", type: "uint256" },
                { name: "price", type: "uint256" },
                { name: "isBuy", type: "bool" },
                { name: "nonce", type: "uint256" },
                { name: "deadline", type: "uint256" }
            ]
        };

        // Calculate order hashes
        const buyOrderHash = ethers.TypedDataEncoder.hash(domain, types, buyOrder);
        const sellOrderHash = ethers.TypedDataEncoder.hash(domain, types, sellOrder);

        console.log(`Buy order hash: ${buyOrderHash}`);
        console.log(`Sell order hash: ${sellOrderHash}`);

        // Check if orders are already used
        const buyOrderUsed = await preMarketTrade.usedOrderHashes(buyOrderHash);
        const sellOrderUsed = await preMarketTrade.usedOrderHashes(sellOrderHash);

        console.log(`Buy order already used: ${buyOrderUsed}`);
        console.log(`Sell order already used: ${sellOrderUsed}`);

        if (buyOrderUsed || sellOrderUsed) {
            console.log("❌ PROBLEM: Order đã được sử dụng!");
            console.log("💡 Solution: Thay đổi nonce hoặc tạo order mới");
            return;
        }

        // Check filled amounts
        const buyOrderFilled = await preMarketTrade.orderFilled(buyOrderHash);
        const sellOrderFilled = await preMarketTrade.orderFilled(sellOrderHash);

        console.log(`Buy order filled: ${ethers.formatUnits(buyOrderFilled, 6)}`);
        console.log(`Sell order filled: ${ethers.formatUnits(sellOrderFilled, 6)}`);

        // Check 6: Minimum fill amount
        console.log("\n=== CHECK 6: MINIMUM FILL AMOUNT ===");
        const minimumFillAmount = await preMarketTrade.minimumFillAmount();
        const fillAmount = ethers.parseUnits("5", 6);

        console.log(`Minimum fill amount: ${ethers.formatUnits(minimumFillAmount, 6)}`);
        console.log(`Requested fill amount: ${ethers.formatUnits(fillAmount, 6)}`);

        if (fillAmount < minimumFillAmount) {
            console.log("❌ PROBLEM: Fill amount nhỏ hơn minimum!");
            return;
        }

        // Check 7: Contract paused
        console.log("\n=== CHECK 7: CONTRACT STATUS ===");
        const isPaused = await preMarketTrade.paused();
        console.log(`Contract paused: ${isPaused}`);

        if (isPaused) {
            console.log("❌ PROBLEM: Contract đang bị pause!");
            return;
        }

        console.log("\n✅ TẤT CẢ ĐIỀU KIỆN ĐỀU OK!");
        console.log("🤔 Lỗi có thể do signature hoặc logic khác trong contract");

        // Try to create a simple transaction to test
        console.log("\n=== TEST SIMPLE CALL ===");
        try {
            // Test a simple view function first
            const tradeCounter = await preMarketTrade.tradeCounter();
            console.log(`Current trade counter: ${tradeCounter}`);

            // Test static call để xem lỗi chi tiết
            console.log("🧪 Testing static call...");

            const buySignature = await buyer.signTypedData(domain, types, buyOrder);
            const sellSignature = await seller.signTypedData(domain, types, sellOrder);

            console.log("Signatures generated");

            const buyOrderStruct = [
                buyOrder.trader,
                buyOrder.collateralToken,
                buyOrder.targetTokenId,
                buyOrder.amount,
                buyOrder.price,
                buyOrder.isBuy,
                buyOrder.nonce,
                buyOrder.deadline
            ];

            const sellOrderStruct = [
                sellOrder.trader,
                sellOrder.collateralToken,
                sellOrder.targetTokenId,
                sellOrder.amount,
                sellOrder.price,
                sellOrder.isBuy,
                sellOrder.nonce,
                sellOrder.deadline
            ];

            // Try static call to get detailed error
            try {
                const result = await preMarketTrade.connect(relayer).matchOrders.staticCall(
                    buyOrderStruct,
                    sellOrderStruct,
                    buySignature,
                    sellSignature,
                    fillAmount
                );
                console.log("✅ Static call thành công!");
                console.log("Trade ID would be:", result.toString());
            } catch (staticError: any) {
                console.log("❌ Static call failed:");
                console.log("Error message:", staticError.message);
                if (staticError.data) {
                    console.log("Error data:", staticError.data);
                }
                if (staticError.reason) {
                    console.log("Error reason:", staticError.reason);
                }
            }

        } catch (testError: any) {
            console.log("❌ Test failed:", testError.message);
        }

    } catch (error: any) {
        console.error("❌ Debug failed:", error.message);
        console.error("Stack:", error.stack);
    }
}

// Run debug
debugMatchOrders()
    .then(() => {
        console.log("🎉 Debug completed!");
        process.exit(0);
    })
    .catch((error) => {
        console.error("💥 Debug failed:", error);
        process.exit(1);
    });