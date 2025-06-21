import { ethers } from "hardhat";

async function updateVault() {
    console.log("🏦 Updating vault address...");

    const [deployer] = await ethers.getSigners();
    console.log("👤 Deployer address:", deployer.address);

    const CONTRACT_ADDRESS = process.env.V2_CONTRACT || "0x9D90aeb5c841925fc8D7c5481c02523bDAc95585";

    // New vault address - should be set via environment variable
    const NEW_VAULT_ADDRESS = process.env.ESCROW_VAULT_ADDRESS;

    if (!NEW_VAULT_ADDRESS) {
        throw new Error("NEW_VAULT_ADDRESS environment variable is required");
    }

    const preMarketTradeV2 = await ethers.getContractAt("PreMarketTradeV2", CONTRACT_ADDRESS);

    try {

        // Check current vault address
        const currentVault = await preMarketTradeV2.vault();
        console.log(`📊 Current vault address: ${currentVault}`);

        if (currentVault.toLowerCase() === NEW_VAULT_ADDRESS.toLowerCase()) {
            console.log("✅ Vault address is already set correctly!");
            return;
        }

        // Check if new address is valid
        if (!ethers.isAddress(NEW_VAULT_ADDRESS)) {
            throw new Error("Invalid vault address format");
        }

        // Verify the new vault is a valid EscrowVault contract
        try {
            const newVault = await ethers.getContractAt("EscrowVault", NEW_VAULT_ADDRESS);
            await newVault.VERSION(); // Try to call a function to verify it's the right contract
            console.log("✅ New vault contract verified");
        } catch (error) {
            console.warn("⚠️  Warning: Could not verify new vault contract. Proceeding anyway...");
        }

        console.log(`🎯 Setting new vault address: ${NEW_VAULT_ADDRESS}`);

        // Important: Warn about potential risks
        console.log("⚠️  IMPORTANT WARNINGS:");
        console.log("   - Make sure all funds are migrated from old vault to new vault");
        console.log("   - Consider pausing the contract during migration");
        console.log("   - Verify new vault has proper permissions and configuration");

        // Ask for confirmation in production
        if (process.env.NODE_ENV === "production") {
            console.log("🚨 Production environment detected!");
            console.log("   Please ensure you have completed the migration checklist:");
            console.log("   1. Paused the contract");
            console.log("   2. Migrated all funds from old vault to new vault");
            console.log("   3. Verified new vault configuration");
            console.log("   4. Tested with small amounts first");
        }

        // Call setVault function
        const tx = await preMarketTradeV2.setVault(NEW_VAULT_ADDRESS);
        console.log("📤 Transaction sent:", tx.hash);

        const receipt = await tx.wait();
        console.log("✅ Vault address updated successfully!");
        console.log(`📋 Gas used: ${receipt.gasUsed.toString()}`);

        // Verify the change
        const newVault = await preMarketTradeV2.vault();
        console.log(`🔍 Verification - New vault address: ${newVault}`);

        // Check if contract is paused
        const isPaused = await preMarketTradeV2.paused();
        if (isPaused) {
            console.log("⏸️  Contract is currently PAUSED - remember to unpause after migration");
        } else {
            console.log("▶️  Contract is ACTIVE - ensure migration is complete");
        }

    } catch (error: any) {
        console.error("❌ Error:", error.message);
        console.error("🔍 Error Data:", error);
        const errorInterface = preMarketTradeV2.interface;
        const decodedError = errorInterface.parseError(error.data);
        console.error("🎯 Decoded Custom Error:", decodedError!.name);
        console.error("📋 Error Arguments:", decodedError!.args);

        // Provide helpful error messages
        if (error.message.includes("AccessControl")) {
            console.error("🔒 Access denied. Make sure the deployer has DEFAULT_ADMIN_ROLE");
        } else if (error.message.includes("Invalid vault address")) {
            console.error("🏦 Invalid vault address provided");
        } else if (error.message.includes("Same vault address")) {
            console.error("🔄 New vault address is the same as current vault");
        }

        throw error;
    }
}

// Helper function to get migration checklist
function printMigrationChecklist() {
    console.log("\n📋 VAULT MIGRATION CHECKLIST:");
    console.log("   □ 1. Deploy new vault contract");
    console.log("   □ 2. Pause PreMarketTradeV2 contract");
    console.log("   □ 3. Calculate total funds in old vault");
    console.log("   □ 4. Transfer all tokens from old vault to new vault");
    console.log("   □ 5. Verify fund transfer completed");
    console.log("   □ 6. Update vault address using this script");
    console.log("   □ 7. Test with small amounts");
    console.log("   □ 8. Unpause PreMarketTradeV2 contract");
    console.log("   □ 9. Monitor for any issues");
    console.log("\n⚠️  NEVER update vault without completing migration first!");
}

if (require.main === module) {
    // Print checklist first
    printMigrationChecklist();

    updateVault()
        .then(() => {
            console.log("🎉 Vault update completed!");
            console.log("⚠️  Remember to verify all funds are accessible in new vault");
            process.exit(0);
        })
        .catch((error) => {
            console.error("💥 Vault update failed:", error);
            process.exit(1);
        });
}
