import { ethers } from "hardhat";

async function addTrader() {
    console.log("🔧 Adding trader to EscrowVault...");

    const [deployer] = await ethers.getSigners();
    console.log("👤 Deployer address:", deployer.address);

    // Contract addresses from environment or hardcoded
    const ESCROW_VAULT_ADDRESS = process.env.ESCROW_VAULT_ADDRESS || "0x5FbDB2315678afecb367f032d93F642f64180aa3";
    const TRADER_ADDRESS = process.env.TRADER_ADDRESS || process.env.PREMARKET_CONTRACT || "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";

    console.log("🏦 EscrowVault address:", ESCROW_VAULT_ADDRESS);
    console.log("🤖 Trader address:", TRADER_ADDRESS);

    try {
        const escrowVault = await ethers.getContractAt("EscrowVault", ESCROW_VAULT_ADDRESS);

        // Get role hashes
        const TRADER_ROLE = await escrowVault.TRADER_ROLE();
        const ADMIN_ROLE = await escrowVault.ADMIN_ROLE();
        console.log(`🔑 TRADER_ROLE hash: ${TRADER_ROLE}`);
        console.log(`🔑 ADMIN_ROLE hash: ${ADMIN_ROLE}`);

        // Check if deployer has admin role
        const hasAdminRole = await escrowVault.hasRole(ADMIN_ROLE, deployer.address);
        console.log(`📊 Deployer has ADMIN_ROLE: ${hasAdminRole}`);

        if (!hasAdminRole) {
            console.error("❌ Deployer doesn't have ADMIN_ROLE! Cannot add trader.");
            return;
        }

        // Check current trader role status
        const hasTraderRole = await escrowVault.hasRole(TRADER_ROLE, TRADER_ADDRESS);
        console.log(`📊 Trader has TRADER_ROLE: ${hasTraderRole}`);

        if (hasTraderRole) {
            console.log("✅ Trader already has TRADER_ROLE!");
            return;
        }

        // Add trader using addTrader function
        console.log("🎯 Adding trader to EscrowVault...");
        const tx = await escrowVault.addTrader(TRADER_ADDRESS);
        console.log("📤 Transaction sent:", tx.hash);

        const receipt = await tx.wait();
        console.log("✅ Trader added successfully!");
        console.log(`📋 Gas used: ${receipt.gasUsed.toString()}`);
        console.log(`📋 Block number: ${receipt.blockNumber}`);

        // Verify trader role was granted
        const hasTraderRoleAfter = await escrowVault.hasRole(TRADER_ROLE, TRADER_ADDRESS);
        console.log(`🔍 Verification - Trader has TRADER_ROLE: ${hasTraderRoleAfter}`);

        // Display role information
        console.log("\n📋 Role Summary:");
        console.log(`   🏦 EscrowVault: ${ESCROW_VAULT_ADDRESS}`);
        console.log(`   🤖 Trader: ${TRADER_ADDRESS}`);
        console.log(`   ✅ TRADER_ROLE granted: ${hasTraderRoleAfter}`);

    } catch (error: any) {
        console.error("❌ Error:", error.message);

        // Parse error details if available
        if (error.reason) {
            console.error("🔍 Reason:", error.reason);
        }
        if (error.code) {
            console.error("🔍 Error code:", error.code);
        }

        throw error;
    }
}

addTrader()
    .then(() => {
        console.log("🎉 Add trader completed!");
        process.exit(0);
    })
    .catch((error) => {
        console.error("💥 Add trader failed:", error);
        process.exit(1);
    }); 