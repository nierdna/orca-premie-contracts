import { ethers } from "hardhat";
import { createTokenMarket, TokenMarketConfig } from "./1-create-token-market";
import { matchOrders, MatchOrdersConfig, OrderInfo } from "./2-match-orders";
import { settleTrade, SettleTradeConfig } from "./3-settle-trades";
import { cancelTradeAfterGracePeriod, CancelTradeConfig } from "./4-cancel-trades";

/**
 * @title Complete Pre-Market Trading Workflow Demo
 * @notice Script demo hoàn chỉnh workflow của hệ thống pre-market trading
 * @dev Kết hợp tất cả 4 chức năng chính: Create Market, Match Orders, Settle, Cancel
 */

interface DemoConfig {
    tokenMarket: TokenMarketConfig;
    orders: {
        buy: OrderInfo;
        sell: OrderInfo;
    };
    fillAmount?: string;
    demoRealTokenAddress: string;
    shouldDemoCancel?: boolean;
}

async function runCompleteWorkflow(config: DemoConfig) {
    console.log("🎬 ========== COMPLETE PRE-MARKET TRADING WORKFLOW DEMO ==========");
    console.log("📋 Workflow Steps:");
    console.log("1. 🏪 Create Token Market");
    console.log("2. 🤝 Match Buy/Sell Orders");
    console.log("3. ✅ Settle Trade (hoặc ❌ Cancel Trade)");
    console.log("=".repeat(70));

    const results: any = {
        tokenId: null,
        tradeId: null,
        settled: false,
        cancelled: false,
        errors: []
    };

    try {
        // =================================================================
        // STEP 1: CREATE TOKEN MARKET
        // =================================================================
        console.log("\n🎯 STEP 1: Creating Token Market");
        console.log("-".repeat(50));

        const tokenId = await createTokenMarket(config.tokenMarket);
        results.tokenId = tokenId;

        console.log(`✅ Token Market Created Successfully!`);
        console.log(`🎯 Token ID: ${tokenId}`);

        // Update orders with actual token ID
        config.orders.buy.targetTokenId = tokenId;
        config.orders.sell.targetTokenId = tokenId;

        // =================================================================
        // STEP 2: MATCH ORDERS
        // =================================================================
        console.log("\n🎯 STEP 2: Matching Orders");
        console.log("-".repeat(50));

        const matchConfig: MatchOrdersConfig = {
            buyOrder: config.orders.buy,
            sellOrder: config.orders.sell,
            fillAmount: config.fillAmount
        };

        const tradeId = await matchOrders(matchConfig);
        results.tradeId = tradeId;

        console.log(`✅ Orders Matched Successfully!`);
        console.log(`🎯 Trade ID: ${tradeId}`);

        // =================================================================
        // STEP 3A: SETTLE TRADE (Normal Path)
        // =================================================================
        if (!config.shouldDemoCancel) {
            console.log("\n🎯 STEP 3A: Settling Trade");
            console.log("-".repeat(50));

            // Wait a bit to simulate real timing
            console.log("⏳ Waiting 3 seconds to simulate some time passing...");
            await new Promise(resolve => setTimeout(resolve, 3000));

            const settleConfig: SettleTradeConfig = {
                tradeId: tradeId.toString(),
                targetTokenAddress: config.demoRealTokenAddress
            };

            try {
                const settled = await settleTrade(settleConfig);
                results.settled = settled;

                console.log(`✅ Trade Settled Successfully!`);
            } catch (error: any) {
                console.log(`⚠️ Settlement failed (expected in demo): ${error.message}`);
                console.log("📝 Note: Trong thực tế, cần có real token address và seller phải có token");
                results.errors.push(`Settlement: ${error.message}`);
            }
        }

        // =================================================================
        // STEP 3B: CANCEL TRADE (Alternative Path)
        // =================================================================
        else {
            console.log("\n🎯 STEP 3B: Simulating Trade Cancellation");
            console.log("-".repeat(50));

            console.log("⏳ Simulating grace period expiration...");
            console.log("📝 Note: Trong demo, ta sẽ simulate việc grace period đã hết");

            const cancelConfig: CancelTradeConfig = {
                tradeId: tradeId.toString(),
                reason: "Demo cancellation - grace period expired"
            };

            try {
                const cancelled = await cancelTradeAfterGracePeriod(cancelConfig);
                results.cancelled = cancelled;

                console.log(`✅ Trade Cancelled Successfully!`);
            } catch (error: any) {
                console.log(`⚠️ Cancellation failed (expected in demo): ${error.message}`);
                console.log("📝 Note: Grace period chưa hết hoặc trade đã được settle");
                results.errors.push(`Cancellation: ${error.message}`);
            }
        }

        // =================================================================
        // SUMMARY
        // =================================================================
        console.log("\n🎉 ========== WORKFLOW SUMMARY ==========");
        console.log(`🏪 Token Market Created: ${results.tokenId ? '✅' : '❌'}`);
        console.log(`🤝 Orders Matched: ${results.tradeId ? '✅' : '❌'}`);
        console.log(`✅ Trade Settled: ${results.settled ? '✅' : '❌'}`);
        console.log(`❌ Trade Cancelled: ${results.cancelled ? '✅' : '❌'}`);

        if (results.errors.length > 0) {
            console.log("\n⚠️ Demo Errors (Expected):");
            results.errors.forEach((error: string, index: number) => {
                console.log(`  ${index + 1}. ${error}`);
            });
        }

        console.log("\n📋 Final Results:");
        console.log(JSON.stringify(results, null, 2));

        return results;

    } catch (error: any) {
        console.error("💥 Workflow failed at step:");
        console.error(error.message);
        results.errors.push(`Workflow: ${error.message}`);
        throw error;
    }
}

/**
 * @notice Demo với nhiều scenarios khác nhau
 */
async function runMultipleScenarios() {
    console.log("🎬 ========== MULTIPLE SCENARIOS DEMO ==========");

    const [relayer, buyer, seller] = await ethers.getSigners();
    const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

    // Example USDC address (replace with real)
    const usdcAddress = "0xA0b86a33E6426c8bf8fB4b6E2b78BB9db20CEaE3";
    const demoTokenAddress = "0x1234567890123456789012345678901234567890";

    const scenarios: DemoConfig[] = [
        // Scenario 1: Normal Settlement
        {
            tokenMarket: {
                symbol: "DEMO-1",
                name: "Demo Token Settlement",
                settleTimeLimitDays: 7
            },
            orders: {
                buy: {
                    trader: buyer.address,
                    collateralToken: usdcAddress,
                    targetTokenId: "", // Will be set after market creation
                    amount: ethers.parseEther("1000").toString(),
                    price: ethers.parseEther("0.5").toString(),
                    isBuy: true,
                    nonce: "1",
                    deadline: deadline.toString()
                },
                sell: {
                    trader: seller.address,
                    collateralToken: usdcAddress,
                    targetTokenId: "", // Will be set after market creation
                    amount: ethers.parseEther("1000").toString(),
                    price: ethers.parseEther("0.4").toString(),
                    isBuy: false,
                    nonce: "1",
                    deadline: deadline.toString()
                }
            },
            fillAmount: ethers.parseEther("500").toString(),
            demoRealTokenAddress: demoTokenAddress,
            shouldDemoCancel: false
        },

        // Scenario 2: Cancellation Demo
        {
            tokenMarket: {
                symbol: "DEMO-2",
                name: "Demo Token Cancellation",
                settleTimeLimitDays: 1
            },
            orders: {
                buy: {
                    trader: buyer.address,
                    collateralToken: usdcAddress,
                    targetTokenId: "", // Will be set after market creation
                    amount: ethers.parseEther("2000").toString(),
                    price: ethers.parseEther("0.8").toString(),
                    isBuy: true,
                    nonce: "2",
                    deadline: deadline.toString()
                },
                sell: {
                    trader: seller.address,
                    collateralToken: usdcAddress,
                    targetTokenId: "", // Will be set after market creation
                    amount: ethers.parseEther("2000").toString(),
                    price: ethers.parseEther("0.7").toString(),
                    isBuy: false,
                    nonce: "2",
                    deadline: deadline.toString()
                }
            },
            fillAmount: ethers.parseEther("1000").toString(),
            demoRealTokenAddress: demoTokenAddress,
            shouldDemoCancel: true
        }
    ];

    const allResults = [];

    for (let i = 0; i < scenarios.length; i++) {
        const scenario = scenarios[i];
        console.log(`\n🎯 SCENARIO ${i + 1}: ${scenario.tokenMarket.name}`);
        console.log("=".repeat(70));

        try {
            const result = await runCompleteWorkflow(scenario);
            allResults.push({ scenario: i + 1, success: true, result });
        } catch (error: any) {
            allResults.push({ scenario: i + 1, success: false, error: error.message });
            console.error(`❌ Scenario ${i + 1} failed:`, error.message);
        }

        // Wait between scenarios
        if (i < scenarios.length - 1) {
            console.log("\n⏳ Waiting 5 seconds before next scenario...");
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }

    console.log("\n📊 ========== ALL SCENARIOS SUMMARY ==========");
    console.table(allResults);

    return allResults;
}

// Main execution
async function main() {
    console.log("🚀 Starting Complete Pre-Market Trading Workflow Demo");
    console.log("📅 Timestamp:", new Date().toISOString());

    const [deployer] = await ethers.getSigners();
    console.log("📝 Deployer address:", deployer.address);

    // Check if we should run single scenario or multiple scenarios
    const runMultiple = process.env.RUN_MULTIPLE_SCENARIOS === "true";

    if (runMultiple) {
        console.log("🎯 Running multiple scenarios demo...");
        await runMultipleScenarios();
    } else {
        console.log("🎯 Running single scenario demo...");

        // Single scenario demo
        const [relayer, buyer, seller] = await ethers.getSigners();
        const deadline = Math.floor(Date.now() / 1000) + 3600;
        const usdcAddress = "0xA0b86a33E6426c8bf8fB4b6E2b78BB9db20CEaE3";
        const demoTokenAddress = "0x1234567890123456789012345678901234567890";

        const singleScenario: DemoConfig = {
            tokenMarket: {
                symbol: "DEMO-SINGLE",
                name: "Single Demo Token",
                settleTimeLimitDays: 14
            },
            orders: {
                buy: {
                    trader: buyer.address,
                    collateralToken: usdcAddress,
                    targetTokenId: "",
                    amount: ethers.parseEther("1000").toString(),
                    price: ethers.parseEther("0.5").toString(),
                    isBuy: true,
                    nonce: "1",
                    deadline: deadline.toString()
                },
                sell: {
                    trader: seller.address,
                    collateralToken: usdcAddress,
                    targetTokenId: "",
                    amount: ethers.parseEther("1000").toString(),
                    price: ethers.parseEther("0.4").toString(),
                    isBuy: false,
                    nonce: "1",
                    deadline: deadline.toString()
                }
            },
            fillAmount: ethers.parseEther("500").toString(),
            demoRealTokenAddress: demoTokenAddress,
            shouldDemoCancel: false
        };

        await runCompleteWorkflow(singleScenario);
    }
}

// Export for use in other scripts
export { runCompleteWorkflow, runMultipleScenarios, DemoConfig };

// Run if called directly
if (require.main === module) {
    main()
        .then(() => {
            console.log("🎉 Complete workflow demo finished successfully!");
            process.exit(0);
        })
        .catch((error) => {
            console.error("💥 Complete workflow demo failed:", error);
            process.exit(1);
        });
} 