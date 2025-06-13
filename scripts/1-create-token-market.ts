import { ethers } from "hardhat";
import { PreMarketTrade } from "../typechain-types";

/**
 * @title Create Token Market Script
 * @notice Script để tạo thị trường cho token chưa phát hành
 * @dev Tạo token market với symbol, name và thời gian settle
 */

interface TokenMarketConfig {
    symbol: string;
    name: string;
    settleTimeLimitDays: number; // Số ngày để settle sau khi token được map
}

async function createTokenMarket(config: TokenMarketConfig) {
    console.log("🚀 Starting token market creation...");

    // Get signer
    const [deployer] = await ethers.getSigners();
    console.log("📝 Deployer address:", deployer.address);

    // Contract address - cần update theo environment
    const CONTRACT_ADDRESS = process.env.PREMARKET_CONTRACT || "YOUR_CONTRACT_ADDRESS";

    // Get contract instance
    const preMarketTrade = await ethers.getContractAt("PreMarketTrade", CONTRACT_ADDRESS);

    try {
        // Validate input
        if (!config.symbol || config.symbol.length === 0) {
            throw new Error("Symbol không được để trống");
        }

        if (!config.name || config.name.length === 0) {
            throw new Error("Name không được để trống");
        }

        if (config.settleTimeLimitDays <= 0) {
            throw new Error("Settle time limit phải lớn hơn 0");
        }

        // Convert days to seconds
        const settleTimeLimit = config.settleTimeLimitDays * 24 * 60 * 60;

        console.log("📊 Token Market Configuration:");
        console.log(`  - Symbol: ${config.symbol}`);
        console.log(`  - Name: ${config.name}`);
        console.log(`  - Settle Time Limit: ${config.settleTimeLimitDays} days (${settleTimeLimit} seconds)`);

        // Check if symbol already exists
        try {
            const existingTokenId = await preMarketTrade.symbolToTokenId(config.symbol);
            if (existingTokenId !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
                console.log("⚠️ Warning: Symbol already exists with tokenId:", existingTokenId);
                return;
            }
        } catch (error) {
            // Symbol doesn't exist, continue
        }

        // Estimate gas
        const gasEstimate = await preMarketTrade.createTokenMarket.estimateGas(
            config.symbol,
            config.name,
            settleTimeLimit
        );

        console.log(`⛽ Gas estimate: ${gasEstimate.toString()}`);

        // Create token market
        console.log("🔄 Creating token market...");
        const tx = await preMarketTrade.createTokenMarket(
            config.symbol,
            config.name,
            settleTimeLimit,
            {
                gasLimit: gasEstimate + BigInt(50000) // Add buffer
            }
        );

        console.log("📤 Transaction sent:", tx.hash);
        console.log("⏳ Waiting for confirmation...");

        const receipt = await tx.wait();

        if (receipt && receipt.status === 1) {
            console.log("✅ Token market created successfully!");
            console.log(`📋 Transaction hash: ${tx.hash}`);
            console.log(`📊 Gas used: ${receipt.gasUsed.toString()}`);

            // Find TokenMarketCreated event
            const logs = receipt.logs;
            for (const log of logs) {
                try {
                    const parsedLog = preMarketTrade.interface.parseLog({
                        topics: log.topics,
                        data: log.data
                    });

                    if (parsedLog && parsedLog.name === "TokenMarketCreated") {
                        const tokenId = parsedLog.args.tokenId;
                        console.log(`🎯 Token ID: ${tokenId}`);
                        console.log(`🏷️ Symbol: ${parsedLog.args.symbol}`);
                        console.log(`📛 Name: ${parsedLog.args.name}`);
                        console.log(`⏰ Settle Time Limit: ${parsedLog.args.settleTimeLimit} seconds`);

                        // Verify token info
                        const tokenInfo = await preMarketTrade.tokens(tokenId);
                        console.log("\n📋 Verified Token Info:");
                        console.log(`  - Token ID: ${tokenInfo.tokenId}`);
                        console.log(`  - Symbol: ${tokenInfo.symbol}`);
                        console.log(`  - Name: ${tokenInfo.name}`);
                        console.log(`  - Real Address: ${tokenInfo.realAddress}`);
                        console.log(`  - Mapping Time: ${tokenInfo.mappingTime}`);
                        console.log(`  - Settle Time Limit: ${tokenInfo.settleTimeLimit} seconds`);
                        console.log(`  - Created At: ${new Date(Number(tokenInfo.createdAt) * 1000).toISOString()}`);
                        console.log(`  - Exists: ${tokenInfo.exists}`);

                        return tokenId;
                    }
                } catch (e) {
                    // Skip invalid logs
                }
            }
        } else {
            throw new Error("Transaction failed");
        }

    } catch (error: any) {
        console.error("❌ Error creating token market:");
        console.error(error.message);

        if (error.reason) {
            console.error("Reason:", error.reason);
        }

        throw error;
    }
}

// Examples và main execution
async function main() {
    // Example configurations
    const examples: TokenMarketConfig[] = [
        {
            symbol: "NEW-TOKEN",
            name: "New Token Protocol",
            settleTimeLimitDays: 30
        },
        {
            symbol: "DEGEN-V2",
            name: "Degen Protocol V2",
            settleTimeLimitDays: 7
        },
        {
            symbol: "AI-COIN",
            name: "AI Blockchain Token",
            settleTimeLimitDays: 14
        }
    ];

    // Chọn config để test (có thể thay đổi index)
    const selectedConfig = examples[0];

    console.log("🎯 Creating token market with configuration:");
    console.log(JSON.stringify(selectedConfig, null, 2));

    await createTokenMarket(selectedConfig);
}

// Export function for use in other scripts
export { createTokenMarket, TokenMarketConfig };

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