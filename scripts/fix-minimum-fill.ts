import { ethers } from "hardhat";

async function fixMinimumFillAmount() {
    console.log("🔧 Fixing minimum fill amount...");

    const [deployer] = await ethers.getSigners();
    console.log("👤 Deployer address:", deployer.address);

    const CONTRACT_ADDRESS = process.env.PREMARKET_CONTRACT || "0x9D90aeb5c841925fc8D7c5481c02523bDAc95585";

    try {
        const preMarketTrade = await ethers.getContractAt("PreMarketTrade", CONTRACT_ADDRESS);

        // Check current minimum
        const currentMinimum = await preMarketTrade.minimumFillAmount();
        console.log(`📊 Current minimum fill amount: ${ethers.formatUnits(currentMinimum, 6)} USDC`);

        // Set new minimum (0.001 USDC = 1000 wei với 6 decimals)
        const newMinimum = ethers.parseUnits("0.001", 6); // 0.001 USDC
        console.log(`🎯 Setting new minimum to: ${ethers.formatUnits(newMinimum, 6)} USDC`);

        const tx = await preMarketTrade.setMinimumFillAmount(newMinimum);
        console.log("📤 Transaction sent:", tx.hash);

        const receipt = await tx.wait();
        console.log("✅ Minimum fill amount updated!");
        console.log(`📋 Gas used: ${receipt.gasUsed.toString()}`);

    } catch (error: any) {
        console.error("❌ Error:", error.message);
        throw error;
    }
}

fixMinimumFillAmount()
    .then(() => {
        console.log("🎉 Fix completed!");
        process.exit(0);
    })
    .catch((error) => {
        console.error("💥 Fix failed:", error);
        process.exit(1);
    }); 