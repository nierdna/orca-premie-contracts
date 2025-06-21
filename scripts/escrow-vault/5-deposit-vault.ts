import { ethers } from "hardhat";

/**
 * @title Vault Deposit Script
 * @notice Script để deposit tokens vào EscrowVault
 * @dev Hỗ trợ single và batch deposits với validation đầy đủ
 */

interface DepositConfig {
    token: string;           // Token address
    amount: string;          // Amount in wei format
    symbol?: string;         // Optional symbol for logging
    decimals?: number;       // Optional decimals for display
}

interface BatchDepositConfig {
    deposits: DepositConfig[];
    description?: string;
}

const getSigner = async () => {
    const [, , signer] = await ethers.getSigners();
    return signer;
}

/**
 * @notice Kiểm tra và approve token nếu cần thiết
 */
async function checkAndApproveToken(
    tokenAddress: string,
    userSigner: any,
    vaultAddress: string,
    amount: string,
    symbol: string = "TOKEN"
): Promise<boolean> {
    console.log(`🔍 Checking allowance for ${symbol}...`);

    const token = await ethers.getContractAt("IERC20", tokenAddress);
    const decimals = 6;

    // Check current allowance
    const currentAllowance = await token.allowance(userSigner.address, vaultAddress);
    const requiredAmount = BigInt(amount);

    console.log(`📊 Current allowance: ${ethers.formatUnits(currentAllowance, decimals)} ${symbol}`);
    console.log(`📊 Required amount: ${ethers.formatUnits(requiredAmount, decimals)} ${symbol}`);

    if (currentAllowance >= requiredAmount) {
        console.log(`✅ Sufficient allowance for ${symbol}`);
        return true;
    }

    // Need to approve
    console.log(`🔓 Approving ${symbol} for vault...`);

    // Check if we need to reset allowance to 0 first (some tokens require this)
    if (currentAllowance > 0) {
        console.log(`⚠️ Resetting allowance to 0 first for ${symbol}...`);
        const resetTx = await (token as any).connect(userSigner).approve(vaultAddress, 0);
        await resetTx.wait();
        console.log(`✅ Allowance reset for ${symbol}`);
    }

    // Approve required amount
    const approveTx = await (token as any).connect(userSigner).approve(vaultAddress, requiredAmount);
    console.log(`📤 Approval transaction sent: ${approveTx.hash}`);
    await approveTx.wait();

    // Verify approval
    const newAllowance = await token.allowance(userSigner.address, vaultAddress);
    if (newAllowance >= requiredAmount) {
        console.log(`✅ ${symbol} approved successfully!`);
        return true;
    } else {
        throw new Error(`❌ Approval failed for ${symbol}`);
    }
}

/**
 * @notice Single token deposit
 */
async function depositToken(config: DepositConfig): Promise<boolean> {
    console.log("🚀 Starting token deposit...");

    // Get signer
    const depositor = await getSigner();
    console.log("📝 Depositor address:", depositor.address);

    // Contract addresses
    const VAULT_ADDRESS = process.env.VAULT_CONTRACT || "YOUR_VAULT_ADDRESS";

    // Get contract instances
    const vault = await ethers.getContractAt("EscrowVault", VAULT_ADDRESS);
    const token = await ethers.getContractAt("IERC20", config.token);

    try {
        const symbol = config.symbol || "TOKEN";
        const decimals = config.decimals || 18;

        console.log("📊 Deposit Configuration:");
        console.log(`  - Token: ${config.token}`);
        console.log(`  - Symbol: ${symbol}`);
        console.log(`  - Amount: ${ethers.formatUnits(config.amount, decimals)} ${symbol}`);
        console.log(`  - Vault: ${VAULT_ADDRESS}`);

        // Check user balance
        const userBalance = await token.balanceOf(depositor.address);
        const depositAmount = BigInt(config.amount);

        console.log(`💰 User Balance: ${ethers.formatUnits(userBalance, decimals)} ${symbol}`);
        console.log(`📊 Deposit Amount: ${ethers.formatUnits(depositAmount, decimals)} ${symbol}`);

        if (userBalance < depositAmount) {
            throw new Error(`Insufficient balance. Need: ${ethers.formatUnits(depositAmount, decimals)}, Have: ${ethers.formatUnits(userBalance, decimals)}`);
        }

        // Check current vault balance
        const currentVaultBalance = await vault.getBalance(depositor.address, config.token);
        console.log(`🏦 Current Vault Balance: ${ethers.formatUnits(currentVaultBalance, decimals)} ${symbol}`);

        // Check and approve token
        await checkAndApproveToken(
            config.token,
            depositor,
            VAULT_ADDRESS,
            config.amount,
            symbol
        );

        // Estimate gas
        const gasEstimate = await (vault as any).connect(depositor).deposit.estimateGas(
            config.token,
            config.amount
        );

        console.log(`⛽ Gas estimate: ${gasEstimate.toString()}`);

        // Deposit
        console.log("🔄 Depositing tokens...");
        const tx = await (vault as any).connect(depositor).deposit(
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
            console.log("✅ Deposit successful!");
            console.log(`📋 Transaction hash: ${tx.hash}`);
            console.log(`📊 Gas used: ${receipt.gasUsed.toString()}`);

            // Find Deposited event
            const logs = receipt.logs;
            for (const log of logs) {
                try {
                    const parsedLog = vault.interface.parseLog({
                        topics: log.topics,
                        data: log.data
                    });

                    if (parsedLog && parsedLog.name === "Deposited") {
                        console.log(`🎯 Deposited Event:`);
                        console.log(`  - User: ${parsedLog.args.user}`);
                        console.log(`  - Token: ${parsedLog.args.token}`);
                        console.log(`  - Amount: ${ethers.formatUnits(parsedLog.args.amount, decimals)} ${symbol}`);
                    }
                } catch (e) {
                    // Skip invalid logs
                }
            }

            // Get updated balances
            const newVaultBalance = await vault.getBalance(depositor.address, config.token);
            const newUserBalance = await token.balanceOf(depositor.address);

            console.log("\n📋 Updated Balances:");
            console.log(`🏦 Vault Balance: ${ethers.formatUnits(newVaultBalance, decimals)} ${symbol}`);
            console.log(`💰 User Balance: ${ethers.formatUnits(newUserBalance, decimals)} ${symbol}`);

            return true;
        } else {
            throw new Error("Transaction failed");
        }

    } catch (error: any) {
        console.error("❌ Error depositing token:");
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
 * @notice Batch deposit multiple tokens
 */
async function batchDeposit(config: BatchDepositConfig): Promise<boolean[]> {
    console.log(`🚀 Starting batch deposit for ${config.deposits.length} tokens...`);
    console.log(`📋 Description: ${config.description || "Batch deposit operation"}`);

    const results = [];

    for (let i = 0; i < config.deposits.length; i++) {
        const depositConfig = config.deposits[i];
        console.log(`\n[${i + 1}/${config.deposits.length}] Depositing ${depositConfig.symbol || 'TOKEN'}...`);

        try {
            const result = await depositToken(depositConfig);
            results.push(result);
            console.log(`✅ Deposit ${i + 1} successful`);
        } catch (error: any) {
            results.push(false);
            console.error(`❌ Deposit ${i + 1} failed: ${error.message}`);
        }

        // Add delay between deposits
        if (i < config.deposits.length - 1) {
            console.log("⏳ Waiting 2 seconds before next deposit...");
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    return results;
}

/**
 * @notice Kiểm tra vault balance cho multiple tokens
 */
async function checkVaultBalances(
    userAddress: string,
    tokens: string[],
    symbols: string[] = []
) {
    console.log("🔍 Checking vault balances...");

    const VAULT_ADDRESS = process.env.VAULT_CONTRACT || "YOUR_VAULT_ADDRESS";
    const vault = await ethers.getContractAt("EscrowVault", VAULT_ADDRESS);

    try {
        // Get balances
        const balances = await vault.getBalances(userAddress, tokens);

        console.log(`📊 Vault Balances for ${userAddress}:`);
        for (let i = 0; i < tokens.length; i++) {
            const symbol = symbols[i] || `TOKEN-${i}`;
            console.log(`  - ${symbol}: ${ethers.formatEther(balances[i])}`);
        }

        return balances;
    } catch (error: any) {
        console.error("❌ Error checking balances:", error.message);
        throw error;
    }
}

/**
 * @notice Reconcile vault token balance
 */
async function reconcileVaultToken(tokenAddress: string, symbol: string = "TOKEN") {
    console.log(`🔍 Reconciling vault balance for ${symbol}...`);

    const VAULT_ADDRESS = process.env.VAULT_CONTRACT || "YOUR_VAULT_ADDRESS";
    const vault = await ethers.getContractAt("EscrowVault", VAULT_ADDRESS);

    try {
        const reconcileResult = await vault.reconcileToken(tokenAddress);

        console.log(`📊 Reconciliation Result for ${symbol}:`);
        console.log(`  - Contract Balance: ${ethers.formatEther(reconcileResult.contractBalance)}`);
        console.log(`  - Recorded Deposits: ${ethers.formatEther(reconcileResult.recordedDeposits)}`);
        console.log(`  - Is Balanced: ${reconcileResult.isBalanced ? '✅' : '❌'}`);

        if (!reconcileResult.isBalanced) {
            console.log("⚠️ Warning: Vault balance mismatch detected!");
        }

        return reconcileResult;
    } catch (error: any) {
        console.error("❌ Error reconciling:", error.message);
        throw error;
    }
}

// Examples và main execution
async function main() {
    const deployer = await getSigner();

    // Example token addresses (replace with real ones)
    const USDC_ADDRESS = process.env.USDC_ADDRESS || "0xA0b86a33E6426c8bf8fB4b6E2b78BB9db20CEaE3";
    const USDT_ADDRESS = process.env.USDT_ADDRESS || "0xdAC17F958D2ee523a2206206994597C13D831ec7";

    // Single deposit example
    const singleDepositConfig: DepositConfig = {
        token: USDC_ADDRESS,
        amount: ethers.parseUnits("1000", 6).toString(), // 1000 USDC (6 decimals)
        symbol: "USDC",
        decimals: 6
    };

    // Batch deposit example
    const batchDepositConfig: BatchDepositConfig = {
        deposits: [
            {
                token: USDC_ADDRESS,
                amount: ethers.parseUnits("500", 6).toString(),
                symbol: "USDC",
                decimals: 6
            },
            {
                token: USDT_ADDRESS,
                amount: ethers.parseUnits("1000", 6).toString(),
                symbol: "USDT",
                decimals: 6
            }
        ],
        description: "Initial collateral deposit for trading"
    };

    console.log("🎯 Choose deposit operation:");
    console.log("1. Single Token Deposit");
    console.log("2. Batch Token Deposit");
    console.log("3. Check Vault Balances");
    console.log("4. Reconcile Vault");

    // Demo single deposit
    console.log("\n🎯 Demo: Single token deposit");
    console.log(JSON.stringify(singleDepositConfig, null, 2));

    try {
        await depositToken(singleDepositConfig);
    } catch (error) {
        console.log("⚠️ Single deposit demo failed (expected if no tokens)");
    }

    // Demo balance checking
    console.log("\n🎯 Demo: Check vault balances");
    try {
        await checkVaultBalances(
            deployer.address,
            [USDC_ADDRESS, USDT_ADDRESS],
            ["USDC", "USDT"]
        );
    } catch (error) {
        console.log("⚠️ Balance check demo failed");
    }

    // Demo reconciliation
    console.log("\n🎯 Demo: Reconcile vault");
    try {
        await reconcileVaultToken(USDC_ADDRESS, "USDC");
    } catch (error) {
        console.log("⚠️ Reconcile demo failed");
    }

    // Batch deposit (uncomment to use)
    // console.log("\n🎯 Demo: Batch deposit");
    // try {
    //   const results = await batchDeposit(batchDepositConfig);
    //   console.log("📊 Batch deposit results:", results);
    // } catch (error) {
    //   console.log("⚠️ Batch deposit demo failed");
    // }
}

// Export functions for use in other scripts
export {
    depositToken,
    batchDeposit,
    checkVaultBalances,
    reconcileVaultToken,
    checkAndApproveToken,
    DepositConfig,
    BatchDepositConfig
};

// Run if called directly
if (require.main === module) {
    main()
        .then(() => {
            console.log("🎉 Vault deposit script completed successfully!");
            process.exit(0);
        })
        .catch((error) => {
            console.error("💥 Vault deposit script failed:", error);
            process.exit(1);
        });
} 