import { ethers } from "hardhat";

/**
 * @title Vault Withdraw Script
 * @notice Script để withdraw tokens từ EscrowVault
 * @dev Hỗ trợ single và batch withdrawals với validation đầy đủ
 */

interface WithdrawConfig {
    token: string;           // Token address
    amount: string;          // Amount in wei format
    symbol?: string;         // Optional symbol for logging
    decimals?: number;       // Optional decimals for display
}

interface BatchWithdrawConfig {
    withdrawals: WithdrawConfig[];
    description?: string;
}

/**
 * @notice Single token withdrawal
 */
async function withdrawToken(config: WithdrawConfig): Promise<boolean> {
    console.log("🚀 Starting token withdrawal...");

    // Get signer
    const [withdrawer] = await ethers.getSigners();
    console.log("📝 Withdrawer address:", withdrawer.address);

    // Contract addresses
    const VAULT_ADDRESS = process.env.VAULT_CONTRACT || "YOUR_VAULT_ADDRESS";

    // Get contract instances
    const vault = await ethers.getContractAt("EscrowVault", VAULT_ADDRESS);
    const token = await ethers.getContractAt("IERC20", config.token);

    try {
        const symbol = config.symbol || "TOKEN";
        const decimals = config.decimals || 18;

        console.log("📊 Withdrawal Configuration:");
        console.log(`  - Token: ${config.token}`);
        console.log(`  - Symbol: ${symbol}`);
        console.log(`  - Amount: ${ethers.formatUnits(config.amount, decimals)} ${symbol}`);
        console.log(`  - Vault: ${VAULT_ADDRESS}`);

        // Check vault balance
        const vaultBalance = await vault.getBalance(withdrawer.address, config.token);
        const withdrawAmount = BigInt(config.amount);

        console.log(`🏦 Vault Balance: ${ethers.formatUnits(vaultBalance, decimals)} ${symbol}`);
        console.log(`📊 Withdraw Amount: ${ethers.formatUnits(withdrawAmount, decimals)} ${symbol}`);

        if (vaultBalance < withdrawAmount) {
            throw new Error(`Insufficient vault balance. Need: ${ethers.formatUnits(withdrawAmount, decimals)}, Have: ${ethers.formatUnits(vaultBalance, decimals)}`);
        }

        // Check current user balance
        const currentUserBalance = await token.balanceOf(withdrawer.address);
        console.log(`💰 Current User Balance: ${ethers.formatUnits(currentUserBalance, decimals)} ${symbol}`);

        // Estimate gas
        const gasEstimate = await (vault as any).connect(withdrawer).withdraw.estimateGas(
            config.token,
            config.amount
        );

        console.log(`⛽ Gas estimate: ${gasEstimate.toString()}`);

        // Withdraw
        console.log("🔄 Withdrawing tokens...");
        const tx = await (vault as any).connect(withdrawer).withdraw(
            config.token,
            config.amount,
            {
                gasLimit: gasEstimate + BigInt(20000) // Add buffer
            }
        );

        console.log("📤 Transaction sent:", tx.hash);
        console.log("⏳ Waiting for confirmation...");

        const receipt = await tx.wait();

        if (receipt && receipt.status === 1) {
            console.log("✅ Withdrawal successful!");
            console.log(`📋 Transaction hash: ${tx.hash}`);
            console.log(`📊 Gas used: ${receipt.gasUsed.toString()}`);

            // Find Withdrawn event
            const logs = receipt.logs;
            for (const log of logs) {
                try {
                    const parsedLog = vault.interface.parseLog({
                        topics: log.topics,
                        data: log.data
                    });

                    if (parsedLog && parsedLog.name === "Withdrawn") {
                        console.log(`🎯 Withdrawn Event:`);
                        console.log(`  - User: ${parsedLog.args.user}`);
                        console.log(`  - Token: ${parsedLog.args.token}`);
                        console.log(`  - Amount: ${ethers.formatUnits(parsedLog.args.amount, decimals)} ${symbol}`);
                    }
                } catch (e) {
                    // Skip invalid logs
                }
            }

            // Get updated balances
            const newVaultBalance = await vault.getBalance(withdrawer.address, config.token);
            const newUserBalance = await token.balanceOf(withdrawer.address);

            console.log("\n📋 Updated Balances:");
            console.log(`🏦 Vault Balance: ${ethers.formatUnits(newVaultBalance, decimals)} ${symbol}`);
            console.log(`💰 User Balance: ${ethers.formatUnits(newUserBalance, decimals)} ${symbol}`);

            return true;
        } else {
            throw new Error("Transaction failed");
        }

    } catch (error: any) {
        console.error("❌ Error withdrawing token:");
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

/**
 * @notice Batch withdraw multiple tokens
 */
async function batchWithdraw(config: BatchWithdrawConfig): Promise<boolean[]> {
    console.log(`🚀 Starting batch withdrawal for ${config.withdrawals.length} tokens...`);
    console.log(`📋 Description: ${config.description || "Batch withdrawal operation"}`);

    const results = [];

    for (let i = 0; i < config.withdrawals.length; i++) {
        const withdrawConfig = config.withdrawals[i];
        console.log(`\n[${i + 1}/${config.withdrawals.length}] Withdrawing ${withdrawConfig.symbol || 'TOKEN'}...`);

        try {
            const result = await withdrawToken(withdrawConfig);
            results.push(result);
            console.log(`✅ Withdrawal ${i + 1} successful`);
        } catch (error: any) {
            results.push(false);
            console.error(`❌ Withdrawal ${i + 1} failed: ${error.message}`);
        }

        // Add delay between withdrawals
        if (i < config.withdrawals.length - 1) {
            console.log("⏳ Waiting 2 seconds before next withdrawal...");
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    return results;
}

/**
 * @notice Withdraw maximum available balance cho một token
 */
async function withdrawMaxBalance(
    tokenAddress: string,
    symbol: string = "TOKEN",
    decimals: number = 18
): Promise<boolean> {
    console.log(`🚀 Withdrawing maximum balance for ${symbol}...`);

    const [withdrawer] = await ethers.getSigners();
    const VAULT_ADDRESS = process.env.VAULT_CONTRACT || "YOUR_VAULT_ADDRESS";
    const vault = await ethers.getContractAt("EscrowVault", VAULT_ADDRESS);

    try {
        // Get current vault balance
        const vaultBalance = await vault.getBalance(withdrawer.address, tokenAddress);

        if (vaultBalance === BigInt(0)) {
            console.log(`⚠️ No balance found in vault for ${symbol}`);
            return false;
        }

        console.log(`🏦 Maximum withdrawable: ${ethers.formatUnits(vaultBalance, decimals)} ${symbol}`);

        // Use the max balance as withdrawal amount
        const withdrawConfig: WithdrawConfig = {
            token: tokenAddress,
            amount: vaultBalance.toString(),
            symbol: symbol,
            decimals: decimals
        };

        return await withdrawToken(withdrawConfig);

    } catch (error: any) {
        console.error(`❌ Error withdrawing max balance for ${symbol}:`, error.message);
        throw error;
    }
}

/**
 * @notice Withdraw all available balances for multiple tokens
 */
async function withdrawAllBalances(
    tokens: string[],
    symbols: string[] = [],
    decimals: number[] = []
): Promise<boolean[]> {
    console.log(`🚀 Withdrawing all balances for ${tokens.length} tokens...`);

    const results = [];

    for (let i = 0; i < tokens.length; i++) {
        const tokenAddress = tokens[i];
        const symbol = symbols[i] || `TOKEN-${i}`;
        const tokenDecimals = decimals[i] || 18;

        console.log(`\n[${i + 1}/${tokens.length}] Withdrawing all ${symbol}...`);

        try {
            const result = await withdrawMaxBalance(tokenAddress, symbol, tokenDecimals);
            results.push(result);
            console.log(`✅ ${symbol} withdrawal ${result ? 'successful' : 'skipped (no balance)'}`);
        } catch (error: any) {
            results.push(false);
            console.error(`❌ ${symbol} withdrawal failed: ${error.message}`);
        }

        // Add delay between withdrawals
        if (i < tokens.length - 1) {
            console.log("⏳ Waiting 2 seconds before next withdrawal...");
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    return results;
}

/**
 * @notice Emergency withdraw function cho specific amount
 */
async function emergencyWithdraw(
    tokenAddress: string,
    amount: string,
    symbol: string = "TOKEN",
    decimals: number = 18
): Promise<boolean> {
    console.log(`🚨 Emergency withdrawal for ${symbol}...`);

    const withdrawConfig: WithdrawConfig = {
        token: tokenAddress,
        amount: amount,
        symbol: symbol,
        decimals: decimals
    };

    console.log(`⚠️ Emergency withdrawal amount: ${ethers.formatUnits(amount, decimals)} ${symbol}`);
    console.log(`⚠️ This is an emergency operation!`);

    return await withdrawToken(withdrawConfig);
}

// Examples và main execution
async function main() {
    const [deployer] = await ethers.getSigners();

    // Example token addresses (replace with real ones)
    const USDC_ADDRESS = process.env.USDC_ADDRESS || "0xA0b86a33E6426c8bf8fB4b6E2b78BB9db20CEaE3";
    const USDT_ADDRESS = process.env.USDT_ADDRESS || "0xdAC17F958D2ee523a2206206994597C13D831ec7";

    // Single withdrawal example
    const singleWithdrawConfig: WithdrawConfig = {
        token: USDC_ADDRESS,
        amount: ethers.parseUnits("500", 6).toString(), // 500 USDC (6 decimals)
        symbol: "USDC",
        decimals: 6
    };

    // Batch withdrawal example
    const batchWithdrawConfig: BatchWithdrawConfig = {
        withdrawals: [
            {
                token: USDC_ADDRESS,
                amount: ethers.parseUnits("250", 6).toString(),
                symbol: "USDC",
                decimals: 6
            },
            {
                token: USDT_ADDRESS,
                amount: ethers.parseUnits("500", 6).toString(),
                symbol: "USDT",
                decimals: 6
            }
        ],
        description: "Partial withdrawal for liquidity needs"
    };

    console.log("🎯 Choose withdrawal operation:");
    console.log("1. Single Token Withdrawal");
    console.log("2. Batch Token Withdrawal");
    console.log("3. Withdraw Max Balance");
    console.log("4. Withdraw All Balances");
    console.log("5. Emergency Withdrawal");

    // Demo single withdrawal
    console.log("\n🎯 Demo: Single token withdrawal");
    console.log(JSON.stringify(singleWithdrawConfig, null, 2));

    try {
        await withdrawToken(singleWithdrawConfig);
    } catch (error) {
        console.log("⚠️ Single withdrawal demo failed (expected if no vault balance)");
    }

    // Demo max balance withdrawal
    console.log("\n🎯 Demo: Withdraw max balance");
    try {
        await withdrawMaxBalance(USDC_ADDRESS, "USDC", 6);
    } catch (error) {
        console.log("⚠️ Max balance withdrawal demo failed");
    }

    // Demo withdraw all balances
    console.log("\n🎯 Demo: Withdraw all balances");
    try {
        const results = await withdrawAllBalances(
            [USDC_ADDRESS, USDT_ADDRESS],
            ["USDC", "USDT"],
            [6, 6]
        );
        console.log("📊 Withdraw all results:", results);
    } catch (error) {
        console.log("⚠️ Withdraw all demo failed");
    }

    // Batch withdrawal (uncomment to use)
    // console.log("\n🎯 Demo: Batch withdrawal");
    // try {
    //   const results = await batchWithdraw(batchWithdrawConfig);
    //   console.log("📊 Batch withdrawal results:", results);
    // } catch (error) {
    //   console.log("⚠️ Batch withdrawal demo failed");
    // }

    // Emergency withdrawal (uncomment if needed)
    // console.log("\n🚨 Demo: Emergency withdrawal");
    // try {
    //   await emergencyWithdraw(
    //     USDC_ADDRESS,
    //     ethers.parseUnits("100", 6).toString(),
    //     "USDC",
    //     6
    //   );
    // } catch (error) {
    //   console.log("⚠️ Emergency withdrawal demo failed");
    // }
}

// Export functions for use in other scripts
export {
    withdrawToken,
    batchWithdraw,
    withdrawMaxBalance,
    withdrawAllBalances,
    emergencyWithdraw,
    WithdrawConfig,
    BatchWithdrawConfig
};

// Run if called directly
if (require.main === module) {
    main()
        .then(() => {
            console.log("🎉 Vault withdrawal script completed successfully!");
            process.exit(0);
        })
        .catch((error) => {
            console.error("💥 Vault withdrawal script failed:", error);
            process.exit(1);
        });
} 