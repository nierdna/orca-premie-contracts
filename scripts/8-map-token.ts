import { ethers } from "hardhat";
import { PreMarketTrade } from "../typechain-types";

/**
 * @title Map Token Script
 * @notice Script để map địa chỉ token thật với tokenId trong pre-market
 * @dev Chỉ admin mới có thể map token, cần thiết để có thể settle trades
 */

interface TokenMappingConfig {
    tokenId: string;           // Token ID từ token market
    realTokenAddress: string;  // Địa chỉ token thật đã deploy
    symbol?: string;           // Symbol để verify (optional)
}

/**
 * @notice Map token thật với tokenId
 * @param config Cấu hình mapping
 * @returns Promise<void>
 */
async function mapToken(config: TokenMappingConfig): Promise<void> {
    console.log("🗺️ Bắt đầu map token...");

    // Get signer
    const [deployer] = await ethers.getSigners();
    console.log("📝 Địa chỉ deployer:", deployer.address);

    // Contract address - lấy từ environment
    const CONTRACT_ADDRESS = process.env.PREMARKET_CONTRACT || "YOUR_CONTRACT_ADDRESS";
    if (CONTRACT_ADDRESS === "YOUR_CONTRACT_ADDRESS") {
        throw new Error("⚠️ Vui lòng set PREMARKET_CONTRACT trong environment");
    }

    // Get contract instance
    const preMarketTrade = await ethers.getContractAt("PreMarketTrade", CONTRACT_ADDRESS) as unknown as PreMarketTrade;

    try {
        // Validate input
        if (!config.tokenId || config.tokenId.length === 0) {
            throw new Error("Token ID không được để trống");
        }

        if (!config.realTokenAddress || config.realTokenAddress.length === 0) {
            throw new Error("Địa chỉ token thật không được để trống");
        }

        // Validate address format
        if (!ethers.isAddress(config.realTokenAddress)) {
            throw new Error("Địa chỉ token không hợp lệ");
        }

        // Ensure tokenId is bytes32 format
        let tokenId: string;
        if (config.tokenId.startsWith("0x") && config.tokenId.length === 66) {
            tokenId = config.tokenId;
        } else {
            // Try to convert symbol to tokenId
            try {
                tokenId = await preMarketTrade.symbolToTokenId(config.tokenId);
                if (tokenId === "0x0000000000000000000000000000000000000000000000000000000000000000") {
                    throw new Error(`Symbol '${config.tokenId}' không tồn tại`);
                }
            } catch (error) {
                throw new Error(`Không thể tìm thấy tokenId cho symbol '${config.tokenId}'`);
            }
        }

        console.log("📊 Thông tin mapping:");
        console.log(`  - Token ID: ${tokenId}`);
        console.log(`  - Địa chỉ token thật: ${config.realTokenAddress}`);

        // Check if token exists
        const tokenInfo = await preMarketTrade.tokens(tokenId);
        if (!tokenInfo.exists) {
            throw new Error("Token market không tồn tại");
        }

        console.log("🔍 Thông tin token market hiện tại:");
        console.log(`  - Symbol: ${tokenInfo.symbol}`);
        console.log(`  - Name: ${tokenInfo.name}`);
        console.log(`  - Địa chỉ hiện tại: ${tokenInfo.realAddress}`);
        console.log(`  - Thời gian tạo: ${new Date(Number(tokenInfo.createdAt) * 1000).toISOString()}`);
        console.log(`  - Thời hạn settle: ${tokenInfo.settleTimeLimit} giây`);

        // Verify symbol if provided
        if (config.symbol && tokenInfo.symbol !== config.symbol) {
            console.log("⚠️ Warning: Symbol không khớp với token market");
            console.log(`  - Expected: ${config.symbol}`);
            console.log(`  - Actual: ${tokenInfo.symbol}`);
        }

        // Check if already mapped
        const [isMapped, currentAddress] = await preMarketTrade.isTokenMapped(tokenId);
        if (isMapped) {
            if (currentAddress.toLowerCase() === config.realTokenAddress.toLowerCase()) {
                console.log("✅ Token đã được map với địa chỉ này rồi");
                return;
            } else {
                throw new Error(`Token đã được map với địa chỉ khác: ${currentAddress}`);
            }
        }

        // Verify the real token contract exists and has basic ERC20 functions
        try {
            const tokenContract = await ethers.getContractAt("IERC20", config.realTokenAddress);

            // Try to get basic token info to verify it's a valid ERC20
            const [symbol, name, decimals] = await Promise.all([
                tokenContract.symbol().catch(() => "UNKNOWN"),
                tokenContract.name().catch(() => "UNKNOWN"),
                tokenContract.decimals().catch(() => 18)
            ]);

            console.log("🪙 Thông tin token thật:");
            console.log(`  - Symbol: ${symbol}`);
            console.log(`  - Name: ${name}`);
            console.log(`  - Decimals: ${decimals}`);

            // Verify symbol matches if both are available
            if (symbol !== "UNKNOWN" && tokenInfo.symbol !== "UNKNOWN" &&
                symbol.toLowerCase() !== tokenInfo.symbol.toLowerCase()) {
                console.log("⚠️ Warning: Symbol của token thật không khớp với token market");
                console.log(`  - Token market symbol: ${tokenInfo.symbol}`);
                console.log(`  - Real token symbol: ${symbol}`);
            }

        } catch (error) {
            console.log("⚠️ Warning: Không thể verify token contract, tiếp tục mapping...");
        }

        // Check admin role
        const DEFAULT_ADMIN_ROLE = await preMarketTrade.DEFAULT_ADMIN_ROLE();
        const hasAdminRole = await preMarketTrade.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);
        if (!hasAdminRole) {
            throw new Error("Địa chỉ hiện tại không có quyền admin để map token");
        }

        // Estimate gas
        const gasEstimate = await preMarketTrade.mapToken.estimateGas(tokenId, config.realTokenAddress);
        console.log(`⛽ Ước tính gas: ${gasEstimate.toString()}`);

        // Execute mapping
        console.log("🔄 Đang thực hiện mapping token...");
        const tx = await preMarketTrade.mapToken(tokenId, config.realTokenAddress, {
            gasLimit: gasEstimate + BigInt(20000) // Add buffer
        });

        console.log("📤 Transaction đã gửi:", tx.hash);
        console.log("⏳ Đang chờ confirmation...");

        const receipt = await tx.wait();

        if (receipt && receipt.status === 1) {
            console.log("✅ Map token thành công!");
            console.log(`📋 Transaction hash: ${tx.hash}`);
            console.log(`📊 Gas đã sử dụng: ${receipt.gasUsed.toString()}`);

            // Find TokenMapped event
            const logs = receipt.logs;
            for (const log of logs) {
                try {
                    const parsedLog = preMarketTrade.interface.parseLog({
                        topics: log.topics,
                        data: log.data
                    });

                    if (parsedLog && parsedLog.name === "TokenMapped") {
                        console.log(`🎯 Event TokenMapped:`);
                        console.log(`  - Token ID: ${parsedLog.args.tokenId}`);
                        console.log(`  - Real Address: ${parsedLog.args.realAddress}`);
                    }
                } catch (e) {
                    // Skip invalid logs
                }
            }

            // Verify mapping result
            const updatedTokenInfo = await preMarketTrade.tokens(tokenId);
            console.log("\n📋 Thông tin token sau khi map:");
            console.log(`  - Token ID: ${updatedTokenInfo.tokenId}`);
            console.log(`  - Symbol: ${updatedTokenInfo.symbol}`);
            console.log(`  - Name: ${updatedTokenInfo.name}`);
            console.log(`  - Địa chỉ thật: ${updatedTokenInfo.realAddress}`);
            console.log(`  - Thời gian mapping: ${new Date(Number(updatedTokenInfo.mappingTime) * 1000).toISOString()}`);
            console.log(`  - Thời hạn settle: ${updatedTokenInfo.settleTimeLimit} giây`);

            // Check mapping status
            const [verifyMapped, verifyAddress] = await preMarketTrade.isTokenMapped(tokenId);
            console.log(`\n✅ Trạng thái mapping: ${verifyMapped ? 'ĐÃ MAP' : 'CHƯA MAP'}`);
            console.log(`📍 Địa chỉ được map: ${verifyAddress}`);

        } else {
            throw new Error("Transaction thất bại");
        }

    } catch (error: any) {
        console.error("❌ Lỗi khi map token:");
        console.error(error.message);

        if (error.reason) {
            console.error("Lý do:", error.reason);
        }

        if (error.data) {
            try {
                const decodedError = preMarketTrade.interface.parseError(error.data);
                console.error("Chi tiết lỗi:", decodedError?.name, decodedError?.args);
            } catch (e) {
                console.error("Raw error data:", error.data);
            }
        }

        throw error;
    }
}

/**
 * @notice Lấy danh sách token chưa được map
 */
async function listUnmappedTokens(): Promise<void> {
    console.log("📋 Đang lấy danh sách token chưa map...");

    const CONTRACT_ADDRESS = process.env.PREMARKET_CONTRACT || "YOUR_CONTRACT_ADDRESS";
    if (CONTRACT_ADDRESS === "YOUR_CONTRACT_ADDRESS") {
        throw new Error("⚠️ Vui lòng set PREMARKET_CONTRACT trong environment");
    }

    const preMarketTrade = await ethers.getContractAt("PreMarketTrade", CONTRACT_ADDRESS) as unknown as PreMarketTrade;

    // Lấy events TokenMarketCreated để tìm tất cả tokens
    const filter = preMarketTrade.filters.TokenMarketCreated();
    const events = await preMarketTrade.queryFilter(filter, 0);

    console.log(`🔍 Tìm thấy ${events.length} token markets`);

    const unmappedTokens: Array<{
        tokenId: string;
        symbol: string;
        name: string;
        settleTimeLimit: number;
        createdAt: Date;
    }> = [];

    for (const event of events) {
        if (event.args) {
            const tokenId = event.args.tokenId;
            const [isMapped] = await preMarketTrade.isTokenMapped(tokenId);

            if (!isMapped) {
                const tokenInfo = await preMarketTrade.tokens(tokenId);
                unmappedTokens.push({
                    tokenId: tokenId,
                    symbol: tokenInfo.symbol,
                    name: tokenInfo.name,
                    settleTimeLimit: Number(tokenInfo.settleTimeLimit),
                    createdAt: new Date(Number(tokenInfo.createdAt) * 1000)
                });
            }
        }
    }

    if (unmappedTokens.length === 0) {
        console.log("✅ Tất cả token đều đã được map");
        return;
    }

    console.log(`\n📋 ${unmappedTokens.length} token chưa được map:`);
    unmappedTokens.forEach((token, index) => {
        console.log(`\n${index + 1}. ${token.symbol} (${token.name})`);
        console.log(`   Token ID: ${token.tokenId}`);
        console.log(`   Thời hạn settle: ${token.settleTimeLimit / (24 * 60 * 60)} ngày`);
        console.log(`   Tạo lúc: ${token.createdAt.toISOString()}`);
    });
}

// Main execution với examples
async function main() {
    const command = process.argv[2];

    if (command === "list") {
        await listUnmappedTokens();
        return;
    }

    // Example configurations cho mapping
    const examples: TokenMappingConfig[] = [
        {
            tokenId: process.env.TOKEN_ID!, // Hoặc symbol
            realTokenAddress: "0xd01ceeEa03fbadfA1B5aa5C1891a683c02f38C8f", // Địa chỉ token thật
            // symbol: "NEW-TOKEN" // Optional verification
        },
        // {
        //     tokenId: "DEGEN-V2", // Sử dụng symbol thay vì tokenId
        //     realTokenAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        //     symbol: "DEGEN-V2"
        // }
    ];

    // Chọn config để test (có thể thay đổi index hoặc truyền từ command line)
    let selectedConfig: TokenMappingConfig;

    if (process.argv.length >= 5) {
        // Truyền params từ command line: npm run script tokenId realAddress [symbol]
        selectedConfig = {
            tokenId: process.argv[3],
            realTokenAddress: process.argv[4],
            symbol: process.argv[5] || undefined
        };
    } else {
        // Sử dụng example
        selectedConfig = examples[0];
        console.log("💡 Sử dụng example config. Để truyền params: npm run script <tokenId> <realAddress> [symbol]");
    }

    console.log("🎯 Map token với cấu hình:");
    console.log(JSON.stringify(selectedConfig, null, 2));

    await mapToken(selectedConfig);
}

// Export functions cho reuse
export { mapToken, listUnmappedTokens, TokenMappingConfig };

// Run if called directly
if (require.main === module) {
    main()
        .then(() => {
            console.log("🎉 Script hoàn thành thành công!");
            process.exit(0);
        })
        .catch((error) => {
            console.error("💥 Script thất bại:", error);
            process.exit(1);
        });
}
