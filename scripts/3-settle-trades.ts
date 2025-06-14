import { ethers } from "hardhat";

/**
 * @title Settle Trades Script
 * @notice Script để settle giao dịch sau khi token đã được map với real address
 * @dev Chỉ seller mới có thể settle trades để nhận token thật
 */

interface SettleTradeConfig {
    tradeId: string;
    targetTokenAddress: string; // Real token address to map
}

const DECIMALS = 6;

/**
 * @notice Map token với real address trước khi settle
 */
async function mapTokenToRealAddress(
    tokenId: string,
    realAddress: string,
    adminSigner: any,
    contractAddress: string
) {
    console.log("🗺️ Mapping token to real address...");

    const preMarketTrade = await ethers.getContractAt("PreMarketTrade", contractAddress);

    try {
        // Check if token exists
        const tokenInfo = await preMarketTrade.tokens(tokenId);
        if (!tokenInfo.exists) {
            throw new Error(`Token ${tokenId} không tồn tại`);
        }

        console.log(`🎯 Token Info: ${tokenInfo.symbol} (${tokenInfo.name})`);

        // Check if already mapped
        if (tokenInfo.realAddress !== "0x0000000000000000000000000000000000000000") {
            console.log(`⚠️ Token đã được map với address: ${tokenInfo.realAddress}`);
            return tokenInfo.realAddress;
        }

        // Map token
        const tx = await (preMarketTrade as any).connect(adminSigner).mapTokenToRealAddress(
            tokenId,
            realAddress
        );

        console.log("📤 Mapping transaction sent:", tx.hash);
        await tx.wait();

        console.log("✅ Token mapped successfully!");
        return realAddress;

    } catch (error: any) {
        console.error("❌ Error mapping token:", error.message);
        throw error;
    }
}

/**
 * @notice Settle một trade cụ thể
 */
async function settleTrade(config: SettleTradeConfig) {
    console.log("🚀 Starting trade settlement...");

    // Get signers
    const [admin, , seller] = await ethers.getSigners();
    console.log("📝 Admin address:", admin.address);
    console.log("👤 Seller address:", seller.address);

    // Contract address
    const CONTRACT_ADDRESS = process.env.PREMARKET_CONTRACT || "YOUR_CONTRACT_ADDRESS";

    // Get contract instance
    const preMarketTrade = await ethers.getContractAt("PreMarketTrade", CONTRACT_ADDRESS);

    try {
        // Get trade info
        const tradeInfo = await preMarketTrade.trades(config.tradeId);

        if (!tradeInfo.buyer.trader || tradeInfo.buyer.trader === "0x0000000000000000000000000000000000000000") {
            throw new Error(`Trade ${config.tradeId} không tồn tại`);
        }

        if (tradeInfo.settled) {
            throw new Error(`Trade ${config.tradeId} đã được settle rồi`);
        }

        console.log("📊 Trade Information:");
        console.log(`  - Trade ID: ${config.tradeId}`);
        console.log(`  - Buyer: ${tradeInfo.buyer.trader}`);
        console.log(`  - Seller: ${tradeInfo.seller.trader}`);
        console.log(`  - Target Token ID: ${tradeInfo.buyer.targetTokenId}`);
        console.log(`  - Amount: ${ethers.formatUnits(tradeInfo.filledAmount, DECIMALS)}`);
        console.log(`  - Price: ${ethers.formatUnits(tradeInfo.buyer.price, 6)}`);
        console.log(`  - Match Time: ${new Date(Number(tradeInfo.matchTime) * 1000).toISOString()}`);
        console.log(`  - Current Target Token: ${tradeInfo.targetToken}`);
        console.log(`  - Settled: ${tradeInfo.settled}`);

        // Check if token is mapped
        const tokenInfo = await preMarketTrade.tokens(tradeInfo.buyer.targetTokenId);
        let mappedAddress = tokenInfo.realAddress;

        if (mappedAddress === "0x0000000000000000000000000000000000000000") {
            console.log("🗺️ Token chưa được map, đang thực hiện mapping...");
            mappedAddress = await mapTokenToRealAddress(
                tradeInfo.buyer.targetTokenId,
                config.targetTokenAddress,
                admin,
                CONTRACT_ADDRESS
            );
        } else {
            console.log(`✅ Token đã được map với address: ${mappedAddress}`);
        }

        // Check if seller has enough tokens
        const targetToken = await ethers.getContractAt("IERC20", mappedAddress) as any;
        const sellerBalance = await targetToken.balanceOf(tradeInfo.seller.trader);
        const requiredAmount = tradeInfo.filledAmount;

        console.log(`💰 Seller Balance: ${ethers.formatUnits(sellerBalance, DECIMALS)}`);
        console.log(`📊 Required Amount: ${ethers.formatUnits(requiredAmount, DECIMALS)}`);

        if (sellerBalance < requiredAmount) {
            throw new Error(`Seller không đủ token để settle. Cần: ${ethers.formatUnits(requiredAmount, DECIMALS)}, có: ${ethers.formatUnits(sellerBalance, DECIMALS)}`);
        }

        // Check allowance
        const allowance = await targetToken.allowance(tradeInfo.seller.trader, CONTRACT_ADDRESS);
        console.log(`🔓 Current Allowance: ${ethers.formatUnits(allowance, DECIMALS)}`);

        if (allowance < requiredAmount) {
            console.log("🔓 Cần approve token trước khi settle...");
            console.log("ℹ️ Seller cần chạy: targetToken.approve(preMarketContract, amount)");
            // In real scenario, seller would do this separately
            // For demo purposes, we'll show the required approval
            const approveTx = await targetToken.connect(seller).approve(
                CONTRACT_ADDRESS,
                ethers.MaxInt256,
                {
                    gasLimit: 100000 // Gas limit cho approve
                }
            );

            console.log("📤 Approval transaction sent:", approveTx.hash);
            console.log("⏳ Waiting for approval confirmation...");

            const approveReceipt = await approveTx.wait();

            if (approveReceipt && approveReceipt.status === 1) {
                console.log("✅ Token approved successfully!");
                console.log(`📋 Approval tx hash: ${approveTx.hash}`);
            } else {
                throw new Error("Token approval failed");
            }
        }

        // Calculate timing
        const currentTime = Math.floor(Date.now() / 1000);
        const matchTime = Number(tradeInfo.matchTime);
        const settleTimeLimit = Number(tokenInfo.settleTimeLimit);
        const deadline = matchTime + settleTimeLimit;

        console.log("⏰ Timing Information:");
        console.log(`  - Current Time: ${new Date(currentTime * 1000).toISOString()}`);
        console.log(`  - Match Time: ${new Date(matchTime * 1000).toISOString()}`);
        console.log(`  - Settle Deadline: ${new Date(deadline * 1000).toISOString()}`);
        console.log(`  - Is Late: ${currentTime > deadline}`);

        // Estimate gas
        const gasEstimate = await (preMarketTrade as any).connect(seller).settle.estimateGas(
            config.tradeId
        );

        console.log(`⛽ Gas estimate: ${gasEstimate.toString()}`);

        // Settle trade
        console.log("🔄 Settling trade...");
        const tx = await (preMarketTrade as any).connect(seller).settle(
            config.tradeId,
            {
                gasLimit: gasEstimate + BigInt(50000) // Add buffer
            }
        );

        console.log("📤 Transaction sent:", tx.hash);
        console.log("⏳ Waiting for confirmation...");

        const receipt = await tx.wait();

        if (receipt && receipt.status === 1) {
            console.log("✅ Trade settled successfully!");
            console.log(`📋 Transaction hash: ${tx.hash}`);
            console.log(`📊 Gas used: ${receipt.gasUsed.toString()}`);

            // Find TradeSettled event
            const logs = receipt.logs;
            for (const log of logs) {
                try {
                    const parsedLog = preMarketTrade.interface.parseLog({
                        topics: log.topics,
                        data: log.data
                    });

                    if (parsedLog && parsedLog.name === "TradeSettled") {
                        console.log(`🎯 Trade ID: ${parsedLog.args.tradeId}`);
                        console.log(`🪙 Target Token: ${parsedLog.args.targetToken}`);
                        console.log(`💰 Seller Reward: ${ethers.formatUnits(parsedLog.args.sellerReward, DECIMALS)}`);
                        console.log(`⏰ Is Late: ${parsedLog.args.isLate}`);

                        // Get updated trade info
                        const updatedTradeInfo = await preMarketTrade.trades(config.tradeId);
                        console.log("\n📋 Updated Trade Info:");
                        console.log(`  - Settled: ${updatedTradeInfo.settled}`);
                        console.log(`  - Target Token: ${updatedTradeInfo.targetToken}`);

                        return true;
                    }
                } catch (e) {
                    // Skip invalid logs
                }
            }
        } else {
            throw new Error("Transaction failed");
        }

    } catch (error: any) {
        console.error("❌ Error settling trade:");
        console.error(error.message);

        if (error.reason) {
            console.error("Reason:", error.reason);
        }

        if (error.code) {
            console.error("Code:", error.code);
        }

        throw error;
    }
}

/**
 * @notice Settle multiple trades
 */
async function settleMultipleTrades(configs: SettleTradeConfig[]) {
    console.log(`🚀 Starting settlement for ${configs.length} trades...`);

    const results = [];

    for (let i = 0; i < configs.length; i++) {
        const config = configs[i];
        console.log(`\n[${i + 1}/${configs.length}] Settling trade ${config.tradeId}...`);

        try {
            const result = await settleTrade(config);
            results.push({ tradeId: config.tradeId, success: true, result });
            console.log(`✅ Trade ${config.tradeId} settled successfully`);
        } catch (error: any) {
            results.push({ tradeId: config.tradeId, success: false, error: error.message });
            console.error(`❌ Trade ${config.tradeId} failed: ${error.message}`);
        }

        // Add delay between settlements
        if (i < configs.length - 1) {
            console.log("⏳ Waiting 2 seconds before next settlement...");
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    return results;
}

// Example và main execution
async function main() {
    // Example configurations
    const examples: SettleTradeConfig[] = [
        {
            tradeId: "1",
            targetTokenAddress: "0xd01ceeEa03fbadfA1B5aa5C1891a683c02f38C8f" // Replace with real token address
        },
        {
            tradeId: "2",
            targetTokenAddress: "0x1234567890123456789012345678901234567890" // Replace with real token address
        }
    ];

    // Single trade settlement
    const selectedConfig = examples[0];

    console.log("🎯 Settling trade with configuration:");
    console.log(JSON.stringify(selectedConfig, null, 2));

    await settleTrade(selectedConfig);

    // Multiple trades settlement (uncomment to use)
    // console.log("\n🎯 Settling multiple trades...");
    // const results = await settleMultipleTrades(examples);
    // console.log("\n📊 Settlement Results:");
    // console.table(results);
}

// Export functions for use in other scripts
export { settleTrade, settleMultipleTrades, mapTokenToRealAddress, SettleTradeConfig };

// Run if called directly
if (require.main === module) {
    main()
        .then(() => {
            console.log("🎉 Script completed successfully!");
            process.exit(0);
        })
        .catch((error) => {
            console.error("💥 Script failed:", error);
            process.exit(1);
        });
} 