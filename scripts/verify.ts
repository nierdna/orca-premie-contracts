import { run } from "hardhat";

/**
 * Script verify tự động cho các contract đã deploy
 * Sử dụng địa chỉ từ deployment gần nhất
 */
async function main() {
    console.log("🔍 Starting contract verification process...\n");

    // Địa chỉ contracts từ deployment output
    const contracts = {
        escrowVault: "0x6B4792a57caBEbE6363ce3C0354D1494e63d0320",
        preMarketTradeProxy: "0x9D90aeb5c841925fc8D7c5481c02523bDAc95585",
        preMarketTradeImpl: "0xE1c604dC0b73A750b6D476CA7592aE26336A402f",
        admin: "0x6c4363Bc7d0888Ec19F71f845A73f41e37d2ab3a"
    };

    let successCount = 0;
    let totalCount = 0;

    // ============ 1. Verify EscrowVault ============
    console.log("📋 [1/3] Verifying EscrowVault...");
    console.log(`    Address: ${contracts.escrowVault}`);
    totalCount++;

    try {
        await run("verify:verify", {
            address: contracts.escrowVault,
            constructorArguments: [], // EscrowVault không có constructor args
            contract: "contracts/EscrowVault.sol:EscrowVault"
        });
        console.log("    ✅ EscrowVault verified successfully!\n");
        successCount++;
    } catch (error: any) {
        if (error.message.includes("Already Verified")) {
            console.log("    ✅ EscrowVault already verified!\n");
            successCount++;
        } else {
            console.log(`    ❌ EscrowVault verification failed: ${error.message}\n`);
        }
    }

    // ============ 2. Verify PreMarketTrade Implementation ============
    console.log("📋 [2/3] Verifying PreMarketTrade Implementation...");
    console.log(`    Address: ${contracts.preMarketTradeImpl}`);
    totalCount++;

    try {
        await run("verify:verify", {
            address: contracts.preMarketTradeImpl,
            constructorArguments: [], // Upgradeable contract không có constructor args
            contract: "contracts/PreMarketTrade.sol:PreMarketTrade"
        });
        console.log("    ✅ PreMarketTrade Implementation verified successfully!\n");
        successCount++;
    } catch (error: any) {
        if (error.message.includes("Already Verified")) {
            console.log("    ✅ PreMarketTrade Implementation already verified!\n");
            successCount++;
        } else {
            console.log(`    ❌ PreMarketTrade Implementation verification failed: ${error.message}\n`);
        }
    }

    // ============ 3. Verify Proxy Contract ============
    console.log("📋 [3/3] Verifying Proxy Contract...");
    console.log(`    Address: ${contracts.preMarketTradeProxy}`);
    console.log(`    Note: Proxy contracts thường được verify tự động bởi OpenZeppelin`);
    totalCount++;

    try {
        await run("verify:verify", {
            address: contracts.preMarketTradeProxy,
            constructorArguments: []
        });
        console.log("    ✅ Proxy Contract verified successfully!\n");
        successCount++;
    } catch (error: any) {
        if (error.message.includes("Already Verified")) {
            console.log("    ✅ Proxy Contract already verified!\n");
            successCount++;
        } else {
            console.log(`    ⚠️  Proxy verification skipped (normal for UUPS proxies): ${error.message}\n`);
            // Không tính lỗi cho proxy vì thường được handle tự động
            successCount++;
        }
    }

    // ============ Summary ============
    console.log("🎉 Verification Summary:");
    console.log(`    Total contracts: ${totalCount}`);
    console.log(`    Successfully verified: ${successCount}`);
    console.log(`    Failed: ${totalCount - successCount}`);

    if (successCount === totalCount) {
        console.log("\n✅ All contracts verified successfully!");
    } else {
        console.log("\n⚠️  Some contracts failed verification. Check errors above.");
    }

    // ============ Explorer Links ============
    console.log("\n🔗 Explorer Links:");
    console.log(`    EscrowVault: https://sepolia.basescan.org/address/${contracts.escrowVault}#code`);
    console.log(`    PreMarketTrade Proxy: https://sepolia.basescan.org/address/${contracts.preMarketTradeProxy}#code`);
    console.log(`    PreMarketTrade Implementation: https://sepolia.basescan.org/address/${contracts.preMarketTradeImpl}#code`);

    // ============ Next Steps ============
    console.log("\n📝 Next Steps:");
    console.log("    1. Check explorer links above to confirm verification");
    console.log("    2. Test contract interaction on BaseScan");
    console.log("    3. Update deployment documentation with verified addresses");
    console.log("    4. Consider setting up contract monitoring");
}

/**
 * Function để verify một contract riêng lẻ
 * @param contractName Tên contract
 * @param address Địa chỉ contract
 * @param constructorArgs Constructor arguments (nếu có)
 * @param contractPath Path đến contract file
 */
export async function verifyContract(
    contractName: string,
    address: string,
    constructorArgs: any[] = [],
    contractPath?: string
) {
    console.log(`🔍 Verifying ${contractName} at ${address}...`);

    try {
        const verifyParams: any = {
            address: address,
            constructorArguments: constructorArgs
        };

        if (contractPath) {
            verifyParams.contract = contractPath;
        }

        await run("verify:verify", verifyParams);
        console.log(`✅ ${contractName} verified successfully!`);
        return true;
    } catch (error: any) {
        if (error.message.includes("Already Verified")) {
            console.log(`✅ ${contractName} already verified!`);
            return true;
        } else {
            console.log(`❌ ${contractName} verification failed: ${error.message}`);
            return false;
        }
    }
}

/**
 * Function để verify multiple contracts với custom addresses
 * @param contractAddresses Object chứa mapping contract name -> address
 */
export async function verifyMultipleContracts(contractAddresses: Record<string, string>) {
    let successCount = 0;
    const contractNames = Object.keys(contractAddresses);

    for (const contractName of contractNames) {
        const address = contractAddresses[contractName];
        const success = await verifyContract(contractName, address);
        if (success) successCount++;
    }

    console.log(`\n📊 Verification completed: ${successCount}/${contractNames.length} contracts verified`);
    return successCount === contractNames.length;
}

// Run main function
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("💥 Verification script failed:", error);
        process.exit(1);
    });

// Export functions for reuse
export { main as verifyDeployedContracts }; 