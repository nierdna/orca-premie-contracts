import { ethers } from "hardhat";

/**
 * @title Cancel Trades Script
 * @notice Script để cancel trades và orders trong pre-market trading
 * @dev Hỗ trợ cancel trade sau grace period và cancel order trực tiếp
 */

interface CancelTradeConfig {
    tradeId: string;
    reason?: string;
}

interface CancelOrderConfig {
    orderHash: string;
    cancelAmount: string; // Wei format - amount to cancel
    reason?: string;
}

/**
 * @notice Cancel trade sau grace period (cho buyer)
 * @dev Chỉ buyer mới có thể cancel trade nếu seller không settle đúng hạn
 */
async function cancelTradeAfterGracePeriod(config: CancelTradeConfig) {
    console.log("🚀 Starting trade cancellation after grace period...");

    // Get signers
    const [admin, buyer] = await ethers.getSigners();
    console.log("📝 Admin address:", admin.address);
    console.log("👤 Buyer address:", buyer.address);

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
            throw new Error(`Trade ${config.tradeId} đã được settle rồi, không thể cancel`);
        }

        console.log("📊 Trade Information:");
        console.log(`  - Trade ID: ${config.tradeId}`);
        console.log(`  - Buyer: ${tradeInfo.buyer.trader}`);
        console.log(`  - Seller: ${tradeInfo.seller.trader}`);
        console.log(`  - Target Token ID: ${tradeInfo.buyer.targetTokenId}`);
        console.log(`  - Amount: ${ethers.formatEther(tradeInfo.filledAmount)}`);
        console.log(`  - Price: ${ethers.formatEther(tradeInfo.buyer.price)}`);
        console.log(`  - Match Time: ${new Date(Number(tradeInfo.matchTime) * 1000).toISOString()}`);
        console.log(`  - Settled: ${tradeInfo.settled}`);
        console.log(`  - Buyer Collateral: ${ethers.formatEther(tradeInfo.buyerCollateral)}`);
        console.log(`  - Seller Collateral: ${ethers.formatEther(tradeInfo.sellerCollateral)}`);

        // Get token info to check settle time limit
        const tokenInfo = await preMarketTrade.tokens(tradeInfo.buyer.targetTokenId);

        // Calculate timing
        const currentTime = Math.floor(Date.now() / 1000);
        const matchTime = Number(tradeInfo.matchTime);
        const settleTimeLimit = Number(tokenInfo.settleTimeLimit);
        const deadline = matchTime + settleTimeLimit;

        console.log("⏰ Timing Information:");
        console.log(`  - Current Time: ${new Date(currentTime * 1000).toISOString()}`);
        console.log(`  - Match Time: ${new Date(matchTime * 1000).toISOString()}`);
        console.log(`  - Settle Time Limit: ${settleTimeLimit} seconds`);
        console.log(`  - Settle Deadline: ${new Date(deadline * 1000).toISOString()}`);
        console.log(`  - Grace Period Expired: ${currentTime > deadline}`);

        if (currentTime <= deadline) {
            throw new Error(`Grace period chưa hết. Còn ${deadline - currentTime} giây nữa mới có thể cancel`);
        }

        // Verify caller is buyer
        if (tradeInfo.buyer.trader.toLowerCase() !== buyer.address.toLowerCase()) {
            console.log("⚠️ Warning: Current signer is not the buyer of this trade");
            console.log(`Trade buyer: ${tradeInfo.buyer.trader}`);
            console.log(`Current signer: ${buyer.address}`);
        }

        console.log(`📋 Cancel reason: ${config.reason || "Grace period expired, seller failed to settle"}`);

        // Estimate gas
        const gasEstimate = await (preMarketTrade as any).connect(buyer).cancelAfterGracePeriod.estimateGas(
            config.tradeId
        );

        console.log(`⛽ Gas estimate: ${gasEstimate.toString()}`);

        // Cancel trade
        console.log("🔄 Cancelling trade...");
        const tx = await (preMarketTrade as any).connect(buyer).cancelAfterGracePeriod(
            config.tradeId,
            {
                gasLimit: gasEstimate + BigInt(50000) // Add buffer
            }
        );

        console.log("📤 Transaction sent:", tx.hash);
        console.log("⏳ Waiting for confirmation...");

        const receipt = await tx.wait();

        if (receipt && receipt.status === 1) {
            console.log("✅ Trade cancelled successfully!");
            console.log(`📋 Transaction hash: ${tx.hash}`);
            console.log(`📊 Gas used: ${receipt.gasUsed.toString()}`);

            // Find TradeCancelled event
            const logs = receipt.logs;
            for (const log of logs) {
                try {
                    const parsedLog = preMarketTrade.interface.parseLog({
                        topics: log.topics,
                        data: log.data
                    });

                    if (parsedLog && parsedLog.name === "TradeCancelled") {
                        console.log(`🎯 Trade ID: ${parsedLog.args.tradeId}`);
                        console.log(`👤 Buyer: ${parsedLog.args.buyer}`);
                        console.log(`💰 Penalty Amount: ${ethers.formatEther(parsedLog.args.penaltyAmount)}`);

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
        console.error("❌ Error cancelling trade:");
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
 * @notice Cancel order trực tiếp (partial hoặc full)
 * @dev Trader có thể cancel order của mình bất kỳ lúc nào nếu chưa được fill hoàn toàn
 */
async function cancelOrder(config: CancelOrderConfig) {
    console.log("🚀 Starting order cancellation...");

    // Get signers
    const [admin, trader] = await ethers.getSigners();
    console.log("📝 Admin address:", admin.address);
    console.log("👤 Trader address:", trader.address);

    // Contract address
    const CONTRACT_ADDRESS = process.env.PREMARKET_CONTRACT || "YOUR_CONTRACT_ADDRESS";

    // Get contract instance
    const preMarketTrade = await ethers.getContractAt("PreMarketTrade", CONTRACT_ADDRESS);

    try {
        console.log("📊 Order Cancellation Configuration:");
        console.log(`  - Order Hash: ${config.orderHash}`);
        console.log(`  - Cancel Amount: ${ethers.formatEther(config.cancelAmount)}`);
        console.log(`  - Reason: ${config.reason || "User requested cancellation"}`);

        // Check if order hash has been used/filled
        const isUsed = await preMarketTrade.usedOrderHashes(config.orderHash);
        console.log(`  - Order Fully Used: ${isUsed}`);

        // Get filled amount for this order
        const filledAmount = await preMarketTrade.orderFilled(config.orderHash);
        console.log(`  - Currently Filled: ${ethers.formatEther(filledAmount)}`);

        if (isUsed) {
            console.log("⚠️ Warning: Order đã được fill hoàn toàn");
        }

        // Validate cancel amount
        const cancelAmountBN = BigInt(config.cancelAmount);
        if (cancelAmountBN <= 0) {
            throw new Error("Cancel amount phải lớn hơn 0");
        }

        // Estimate gas
        const gasEstimate = await (preMarketTrade as any).connect(trader).cancelOrder.estimateGas(
            config.orderHash,
            config.cancelAmount
        );

        console.log(`⛽ Gas estimate: ${gasEstimate.toString()}`);

        // Cancel order
        console.log("🔄 Cancelling order...");
        const tx = await (preMarketTrade as any).connect(trader).cancelOrder(
            config.orderHash,
            config.cancelAmount,
            {
                gasLimit: gasEstimate + BigInt(50000) // Add buffer
            }
        );

        console.log("📤 Transaction sent:", tx.hash);
        console.log("⏳ Waiting for confirmation...");

        const receipt = await tx.wait();

        if (receipt && receipt.status === 1) {
            console.log("✅ Order cancelled successfully!");
            console.log(`📋 Transaction hash: ${tx.hash}`);
            console.log(`📊 Gas used: ${receipt.gasUsed.toString()}`);

            // Find OrderCancelled event
            const logs = receipt.logs;
            for (const log of logs) {
                try {
                    const parsedLog = preMarketTrade.interface.parseLog({
                        topics: log.topics,
                        data: log.data
                    });

                    if (parsedLog && parsedLog.name === "OrderCancelled") {
                        console.log(`🎯 Order Hash: ${parsedLog.args.orderHash}`);
                        console.log(`👤 Trader: ${parsedLog.args.trader}`);
                        console.log(`📊 Cancelled Amount: ${ethers.formatEther(parsedLog.args.cancelledAmount)}`);

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
        console.error("❌ Error cancelling order:");
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
 * @notice Bulk cancel multiple trades
 */
async function cancelMultipleTrades(configs: CancelTradeConfig[]) {
    console.log(`🚀 Starting bulk cancellation for ${configs.length} trades...`);

    const results = [];

    for (let i = 0; i < configs.length; i++) {
        const config = configs[i];
        console.log(`\n[${i + 1}/${configs.length}] Cancelling trade ${config.tradeId}...`);

        try {
            const result = await cancelTradeAfterGracePeriod(config);
            results.push({ tradeId: config.tradeId, success: true, result });
            console.log(`✅ Trade ${config.tradeId} cancelled successfully`);
        } catch (error: any) {
            results.push({ tradeId: config.tradeId, success: false, error: error.message });
            console.error(`❌ Trade ${config.tradeId} failed: ${error.message}`);
        }

        // Add delay between cancellations
        if (i < configs.length - 1) {
            console.log("⏳ Waiting 2 seconds before next cancellation...");
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    return results;
}

/**
 * @notice Bulk cancel multiple orders
 */
async function cancelMultipleOrders(configs: CancelOrderConfig[]) {
    console.log(`🚀 Starting bulk cancellation for ${configs.length} orders...`);

    const results = [];

    for (let i = 0; i < configs.length; i++) {
        const config = configs[i];
        console.log(`\n[${i + 1}/${configs.length}] Cancelling order ${config.orderHash}...`);

        try {
            const result = await cancelOrder(config);
            results.push({ orderHash: config.orderHash, success: true, result });
            console.log(`✅ Order ${config.orderHash} cancelled successfully`);
        } catch (error: any) {
            results.push({ orderHash: config.orderHash, success: false, error: error.message });
            console.error(`❌ Order ${config.orderHash} failed: ${error.message}`);
        }

        // Add delay between cancellations
        if (i < configs.length - 1) {
            console.log("⏳ Waiting 2 seconds before next cancellation...");
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    return results;
}

// Examples và main execution
async function main() {
    // Example configurations for trade cancellation
    const tradeExamples: CancelTradeConfig[] = [
        {
            tradeId: "2",
            reason: "Seller failed to deliver tokens on time"
        },
        {
            tradeId: "2",
            reason: "Grace period expired"
        }
    ];

    // Example configurations for order cancellation
    const orderExamples: CancelOrderConfig[] = [
        {
            orderHash: "0x1234567890123456789012345678901234567890123456789012345678901234",
            cancelAmount: ethers.parseEther("500").toString(),
            reason: "Market conditions changed"
        },
        {
            orderHash: "0x5678901234567890123456789012345678901234567890123456789012345678",
            cancelAmount: ethers.parseEther("1000").toString(),
            reason: "No longer want to trade"
        }
    ];

    console.log("🎯 Choose cancellation type:");
    console.log("1. Cancel Trade After Grace Period");
    console.log("2. Cancel Order");
    console.log("3. Bulk Cancel Trades");
    console.log("4. Bulk Cancel Orders");

    // Demo trade cancellation
    const selectedTradeConfig = tradeExamples[0];
    console.log("\n🎯 Cancelling trade with configuration:");
    console.log(JSON.stringify(selectedTradeConfig, null, 2));

    try {
        await cancelTradeAfterGracePeriod(selectedTradeConfig);
    } catch (error) {
        console.log("⚠️ Trade cancellation demo failed (expected if no valid trades)");
    }

    // // Demo order cancellation
    // const selectedOrderConfig = orderExamples[0];
    // console.log("\n🎯 Cancelling order with configuration:");
    // console.log(JSON.stringify(selectedOrderConfig, null, 2));

    // try {
    //     await cancelOrder(selectedOrderConfig);
    // } catch (error) {
    //     console.log("⚠️ Order cancellation demo failed (expected if no valid orders)");
    // }

    // Bulk operations (uncomment to use)
    // console.log("\n🎯 Bulk cancelling trades...");
    // const tradeResults = await cancelMultipleTrades(tradeExamples);
    // console.log("\n📊 Trade Cancellation Results:");
    // console.table(tradeResults);

    // console.log("\n🎯 Bulk cancelling orders...");
    // const orderResults = await cancelMultipleOrders(orderExamples);
    // console.log("\n📊 Order Cancellation Results:");
    // console.table(orderResults);
}

// Export functions for use in other scripts
export {
    cancelTradeAfterGracePeriod,
    cancelOrder,
    cancelMultipleTrades,
    cancelMultipleOrders,
    CancelTradeConfig,
    CancelOrderConfig
};

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