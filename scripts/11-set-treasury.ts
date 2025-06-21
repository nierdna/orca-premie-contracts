import { ethers } from "hardhat";

async function setTreasury() {
    console.log("🏛️ Setting treasury address...");

    const [deployer] = await ethers.getSigners();
    console.log("👤 Deployer address:", deployer.address);

    const CONTRACT_ADDRESS = process.env.PREMARKET_CONTRACT || "0x9D90aeb5c841925fc8D7c5481c02523bDAc95585";

    // Treasury address - can be set via environment variable or hardcoded
    const TREASURY_ADDRESS = process.env.TREASURY_ADDRESS || deployer.address;

    if (!TREASURY_ADDRESS || TREASURY_ADDRESS === "0x742d35Cc6638Cb3BcF9EfF0e2c3E4F7B2d2c9a1D") {
        console.log("⚠️  Warning: Using example treasury address. Set TREASURY_ADDRESS environment variable for production.");
    }

    try {
        const preMarketTrade = await ethers.getContractAt("PreMarketTrade", CONTRACT_ADDRESS);

        // Check current treasury address
        const currentTreasury = await preMarketTrade.treasury();
        console.log(`📊 Current treasury address: ${currentTreasury}`);

        if (currentTreasury.toLowerCase() === TREASURY_ADDRESS.toLowerCase()) {
            console.log("✅ Treasury address is already set correctly!");
            return;
        }

        // Check if new address is valid
        if (!ethers.isAddress(TREASURY_ADDRESS)) {
            throw new Error("Invalid treasury address format");
        }

        console.log(`🎯 Setting new treasury address: ${TREASURY_ADDRESS}`);

        // Call setTreasury function
        const tx = await preMarketTrade.setTreasury(TREASURY_ADDRESS);
        console.log("📤 Transaction sent:", tx.hash);

        const receipt = await tx.wait();
        console.log("✅ Treasury address updated successfully!");
        console.log(`📋 Gas used: ${receipt.gasUsed.toString()}`);

        // Verify the change
        const newTreasury = await preMarketTrade.treasury();
        console.log(`🔍 Verification - New treasury address: ${newTreasury}`);

        // Check if treasury is set to zero address (fee disabled)
        if (newTreasury === ethers.ZeroAddress) {
            console.log("🚫 Protocol fees are now DISABLED (treasury = zero address)");
        } else {
            console.log("💰 Protocol fees are ENABLED and will be sent to treasury");
        }

    } catch (error: any) {
        console.error("❌ Error:", error.message);

        // Provide helpful error messages
        if (error.message.includes("AccessControl")) {
            console.error("🔒 Access denied. Make sure the deployer has DEFAULT_ADMIN_ROLE");
        }

        throw error;
    }
}

if (require.main === module) {
    setTreasury()
        .then(() => {
            console.log("🎉 Treasury setup completed!");
            process.exit(0);
        })
        .catch((error) => {
            console.error("💥 Treasury setup failed:", error);
            process.exit(1);
        });
}