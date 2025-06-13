import { ethers } from "hardhat";

async function setupRelayerRole() {
    console.log("🔧 Setting up relayer role...");

    const [deployer, relayer] = await ethers.getSigners();
    console.log("👤 Deployer address:", deployer.address);
    console.log("🔗 Relayer address:", relayer.address);

    const CONTRACT_ADDRESS = process.env.PREMARKET_CONTRACT || "0x9D90aeb5c841925fc8D7c5481c02523bDAc95585";

    try {
        const preMarketTrade = await ethers.getContractAt("PreMarketTrade", CONTRACT_ADDRESS);

        // Get role hash
        const RELAYER_ROLE = await preMarketTrade.RELAYER_ROLE();
        console.log(`🔑 RELAYER_ROLE hash: ${RELAYER_ROLE}`);

        // Check current role status
        const hasRole = await preMarketTrade.hasRole(RELAYER_ROLE, relayer.address);
        console.log(`📊 Relayer has role: ${hasRole}`);

        if (hasRole) {
            console.log("✅ Relayer already has RELAYER_ROLE!");
            return;
        }

        // Grant role
        console.log("🎯 Granting RELAYER_ROLE to relayer...");
        const tx = await preMarketTrade.grantRole(RELAYER_ROLE, relayer.address);
        console.log("📤 Transaction sent:", tx.hash);

        const receipt = await tx.wait();
        console.log("✅ RELAYER_ROLE granted successfully!");
        console.log(`📋 Gas used: ${receipt.gasUsed.toString()}`);

        // Verify role was granted
        const hasRoleAfter = await preMarketTrade.hasRole(RELAYER_ROLE, relayer.address);
        console.log(`🔍 Verification - Relayer has role: ${hasRoleAfter}`);

    } catch (error: any) {
        console.error("❌ Error:", error.message);
        throw error;
    }
}

setupRelayerRole()
    .then(() => {
        console.log("🎉 Setup completed!");
        process.exit(0);
    })
    .catch((error) => {
        console.error("💥 Setup failed:", error);
        process.exit(1);
    }); 