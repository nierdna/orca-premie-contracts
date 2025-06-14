import { ethers } from "hardhat";
import { PreMarketTrade } from "../typechain-types";

/**
 * @title Match Orders Script
 * @notice Script để khớp lệnh buy/sell trong pre-market trading
 * @dev Sử dụng EIP-712 signatures và hỗ trợ partial fill
 */

// Constants
const DECIMALS = 6; // USDC decimals

interface OrderInfo {
    trader: string;
    collateralToken: string;
    targetTokenId: string;
    amount: string; // Wei format
    price: string; // Wei format (price per unit)
    isBuy: boolean;
    nonce: string;
    deadline: string; // Unix timestamp
}

interface MatchOrdersConfig {
    buyOrder: OrderInfo;
    sellOrder: OrderInfo;
    fillAmount?: string; // Optional - 0 means auto calculate max possible
}

/**
 * @notice Generate EIP-712 signature cho một order
 */
async function signOrder(
    order: OrderInfo,
    signer: any,
    contractAddress: string,
    chainId: number
): Promise<string> {
    // EIP-712 domain
    const domain = {
        name: "PreMarketTrade",
        version: "1",
        chainId: chainId,
        verifyingContract: contractAddress
    };

    // Order types for EIP-712
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

    // Order value object
    const value = {
        trader: order.trader,
        collateralToken: order.collateralToken,
        targetTokenId: order.targetTokenId,
        amount: order.amount,
        price: order.price,
        isBuy: order.isBuy,
        nonce: order.nonce,
        deadline: order.deadline
    };

    console.log("🔐 Signing order with EIP-712...");
    console.log("Domain:", domain);
    console.log("Value:", value);

    return await signer.signTypedData(domain, types, value);
}

/**
 * @notice Khớp hai lệnh buy/sell
 */
async function matchOrders(config: MatchOrdersConfig) {
    console.log("🚀 Starting orders matching...");

    // Get signers
    const [relayer, buyer, seller] = await ethers.getSigners();
    console.log("📝 Relayer address:", relayer.address);
    console.log("👤 Buyer address:", buyer.address);
    console.log("👤 Seller address:", seller.address);

    // Contract address
    const CONTRACT_ADDRESS = process.env.PREMARKET_CONTRACT || "0x9D90aeb5c841925fc8D7c5481c02523bDAc95585";

    // Get contract instance
    const preMarketTrade = await ethers.getContractAt("PreMarketTrade", CONTRACT_ADDRESS);

    // Get network info
    const network = await ethers.provider.getNetwork();
    const chainId = Number(network.chainId);

    try {
        // Validate orders compatibility
        if (config.buyOrder.isBuy === false) {
            throw new Error("Buy order phải có isBuy = true");
        }

        if (config.sellOrder.isBuy === true) {
            throw new Error("Sell order phải có isBuy = false");
        }

        if (config.buyOrder.targetTokenId !== config.sellOrder.targetTokenId) {
            throw new Error("Target token ID phải giống nhau");
        }

        if (config.buyOrder.collateralToken !== config.sellOrder.collateralToken) {
            throw new Error("Collateral token phải giống nhau");
        }

        if (BigInt(config.buyOrder.price) < BigInt(config.sellOrder.price)) {
            throw new Error("Buy price phải >= sell price để có thể khớp");
        }

        console.log("📊 Order Matching Configuration:");
        console.log("Buy Order:", config.buyOrder);
        console.log("Sell Order:", config.sellOrder);
        console.log("Fill Amount:", config.fillAmount || "Auto calculate");

        // Check token exists
        const tokenInfo = await preMarketTrade.tokens(config.buyOrder.targetTokenId);
        if (!tokenInfo.exists) {
            throw new Error(`Token ${config.buyOrder.targetTokenId} chưa được tạo market`);
        }

        console.log("🎯 Token Info:");
        console.log(`  - Symbol: ${tokenInfo.symbol}`);
        console.log(`  - Name: ${tokenInfo.name}`);

        // Sign orders
        console.log("🔏 Generating signatures...");

        // Assume buyer signs buy order, seller signs sell order
        const buySignature = await signOrder(
            config.buyOrder,
            buyer, // Should be actual buyer signer
            CONTRACT_ADDRESS,
            chainId
        );

        const sellSignature = await signOrder(
            config.sellOrder,
            seller, // Should be actual seller signer
            CONTRACT_ADDRESS,
            chainId
        );

        console.log("✅ Signatures generated");

        // Prepare order structs for contract call
        const buyOrderStruct = [
            config.buyOrder.trader,
            config.buyOrder.collateralToken,
            config.buyOrder.targetTokenId,
            config.buyOrder.amount,
            config.buyOrder.price,
            config.buyOrder.isBuy,
            config.buyOrder.nonce,
            config.buyOrder.deadline
        ];

        const sellOrderStruct = [
            config.sellOrder.trader,
            config.sellOrder.collateralToken,
            config.sellOrder.targetTokenId,
            config.sellOrder.amount,
            config.sellOrder.price,
            config.sellOrder.isBuy,
            config.sellOrder.nonce,
            config.sellOrder.deadline
        ];

        const fillAmount = config.fillAmount || "0"; // 0 means auto calculate

        // Estimate gas
        const gasEstimate = await (preMarketTrade as any).connect(relayer).matchOrders.estimateGas(
            buyOrderStruct,
            sellOrderStruct,
            buySignature,
            sellSignature,
            fillAmount
        );

        console.log(`⛽ Gas estimate: ${gasEstimate.toString()}`);

        // Match orders
        console.log("🔄 Matching orders...");
        const tx = await (preMarketTrade as any).connect(relayer).matchOrders(
            buyOrderStruct,
            sellOrderStruct,
            buySignature,
            sellSignature,
            fillAmount,
            {
                gasLimit: gasEstimate + BigInt(100000) // Add buffer
            }
        );

        console.log("📤 Transaction sent:", tx.hash);
        console.log("⏳ Waiting for confirmation...");

        const receipt = await tx.wait();

        if (receipt && receipt.status === 1) {
            console.log("✅ Orders matched successfully!");
            console.log(`📋 Transaction hash: ${tx.hash}`);
            console.log(`📊 Gas used: ${receipt.gasUsed.toString()}`);

            // Find OrdersMatched event
            const logs = receipt.logs;
            for (const log of logs) {
                try {
                    const parsedLog = preMarketTrade.interface.parseLog({
                        topics: log.topics,
                        data: log.data
                    });

                    if (parsedLog && parsedLog.name === "OrdersMatched") {
                        const tradeId = parsedLog.args.tradeId;
                        console.log(`🎯 Trade ID: ${tradeId}`);
                        console.log(`👤 Buyer: ${parsedLog.args.buyer}`);
                        console.log(`👤 Seller: ${parsedLog.args.seller}`);
                        console.log(`🪙 Target Token ID: ${parsedLog.args.targetTokenId}`);
                        console.log(`📈 Amount: ${ethers.formatUnits(parsedLog.args.amount, DECIMALS)}`);
                        console.log(`💰 Price: ${ethers.formatUnits(parsedLog.args.price, DECIMALS)}`);
                        console.log(`🪙 Collateral Token: ${parsedLog.args.collateralToken}`);
                        console.log(`📊 Filled Amount: ${ethers.formatUnits(parsedLog.args.filledAmount, DECIMALS)}`);
                        console.log(`💎 Buyer Collateral: ${ethers.formatUnits(parsedLog.args.buyerCollateral, DECIMALS)}`);
                        console.log(`💎 Seller Collateral: ${ethers.formatUnits(parsedLog.args.sellerCollateral, DECIMALS)}`);

                        // Get trade info
                        const tradeInfo = await preMarketTrade.trades(tradeId);
                        console.log("\n📋 Trade Info:");
                        console.log(`  - Match Time: ${new Date(Number(tradeInfo.matchTime) * 1000).toISOString()}`);
                        console.log(`  - Settled: ${tradeInfo.settled}`);
                        console.log(`  - Target Token: ${tradeInfo.targetToken}`);

                        return tradeId;
                    }
                } catch (e) {
                    // Skip invalid logs
                }
            }
        } else {
            throw new Error("Transaction failed");
        }

    } catch (error: any) {
        console.error("❌ Error matching orders:");
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

// Example orders và main execution
async function main() {
    const [relayer, buyer, seller] = await ethers.getSigners();

    // Current timestamp + 1 hour
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    // Example token ID (thay bằng token ID thực từ script 1)
    const targetTokenId = process.env.TOKEN_ID!;

    // Example USDC address (thay bằng address thực)
    const usdcAddress = process.env.USDC_ADDRESS || "0xA0b86a33E6426c8bf8fB4b6E2b78BB9db20CEaE3";

    const example: MatchOrdersConfig = {
        buyOrder: {
            trader: buyer.address,
            collateralToken: usdcAddress,
            targetTokenId: targetTokenId,
            amount: ethers.parseUnits("10", DECIMALS).toString(), // 10 tokens
            price: ethers.parseUnits("0.5", DECIMALS).toString(), // 0.5 USDC per token
            isBuy: true,
            nonce: "1",
            deadline: deadline.toString()
        },
        sellOrder: {
            trader: seller.address,
            collateralToken: usdcAddress,
            targetTokenId: targetTokenId,
            amount: ethers.parseUnits("10", DECIMALS).toString(), // 10 tokens
            price: ethers.parseUnits("0.5", DECIMALS).toString(), // 0.5 USDC per token
            isBuy: false,
            nonce: "1",
            deadline: deadline.toString()
        },
        fillAmount: ethers.parseUnits("5", DECIMALS).toString() // Fill 5 tokens
    };

    console.log("🎯 Matching orders with configuration:");
    console.log("Buy Order:", example.buyOrder);
    console.log("Sell Order:", example.sellOrder);

    await matchOrders(example);
}

// Export function for use in other scripts
export { matchOrders, MatchOrdersConfig, OrderInfo, signOrder };

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