import { ethers } from "hardhat";

async function setProtocolFee() {
    console.log("💰 Setting protocol fee...");

    const [deployer] = await ethers.getSigners();
    console.log("👤 Deployer address:", deployer.address);

    const CONTRACT_ADDRESS = process.env.PREMARKET_CONTRACT || "0x9D90aeb5c841925fc8D7c5481c02523bDAc95585";

    // Protocol fee in basis points - can be set via environment variable or hardcoded
    // Default: 50 basis points = 0.5%
    const PROTOCOL_FEE_BPS = process.env.PROTOCOL_FEE_BPS ? parseInt(process.env.PROTOCOL_FEE_BPS) : 500;

    // Validate fee range (0-100 basis points = 0-1%)
    // if (PROTOCOL_FEE_BPS < 0 || PROTOCOL_FEE_BPS > 100) {
    //     throw new Error("Protocol fee must be between 0 and 100 basis points (0-1%)");
    // }

    console.log(`🎯 Setting protocol fee to: ${PROTOCOL_FEE_BPS} basis points (${(PROTOCOL_FEE_BPS / 100).toFixed(2)}%)`);

    try {
        const preMarketTrade = await ethers.getContractAt("PreMarketTrade", CONTRACT_ADDRESS);

        // Check current protocol fee
        const currentFeeBps = await preMarketTrade.protocolFeeBps();
        console.log(`📊 Current protocol fee: ${currentFeeBps} basis points (${(Number(currentFeeBps) / 100).toFixed(2)}%)`);

        if (Number(currentFeeBps) === PROTOCOL_FEE_BPS) {
            console.log("✅ Protocol fee is already set correctly!");
            return;
        }

        // Call setProtocolFee function
        const tx = await preMarketTrade.setProtocolFee(PROTOCOL_FEE_BPS);
        console.log("📤 Transaction sent:", tx.hash);

        const receipt = await tx.wait();
        console.log("✅ Protocol fee updated successfully!");
        console.log(`📋 Gas used: ${receipt.gasUsed.toString()}`);

        // Verify the change
        const newFeeBps = await preMarketTrade.protocolFeeBps();
        console.log(`🔍 Verification - New protocol fee: ${newFeeBps} basis points (${(Number(newFeeBps) / 100).toFixed(2)}%)`);

        // Show fee status
        if (Number(newFeeBps) === 0) {
            console.log("🚫 Protocol fees are now DISABLED (0% fee)");
        } else {
            console.log(`💰 Protocol fees are ENABLED at ${(Number(newFeeBps) / 100).toFixed(2)}%`);
        }

        // Show treasury status
        const treasury = await preMarketTrade.treasury();
        if (treasury === ethers.ZeroAddress) {
            console.log("⚠️  Warning: Treasury is set to zero address, fees will not be collected even if fee > 0");
        } else {
            console.log(`🏛️ Fees will be sent to treasury: ${treasury}`);
        }

    } catch (error: any) {
        console.error("❌ Error:", error.message);

        // Provide helpful error messages
        if (error.message.includes("AccessControl")) {
            console.error("🔒 Access denied. Make sure the deployer has DEFAULT_ADMIN_ROLE");
        } else if (error.message.includes("InvalidRewardParameters")) {
            console.error("📊 Invalid fee: Protocol fee must be between 0 and 100 basis points (0-1%)");
        }

        throw error;
    }
}

if (require.main === module) {
    setProtocolFee()
        .then(() => {
            console.log("🎉 Protocol fee setup completed!");
            process.exit(0);
        })
        .catch((error) => {
            console.error("💥 Protocol fee setup failed:", error);
            process.exit(1);
        });
}
