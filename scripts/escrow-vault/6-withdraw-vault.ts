import { ethers } from "hardhat";
import { TypedDataDomain } from "ethers";

/**
 * @title Vault Withdraw Script (with Signature)
 * @notice Script để withdraw tokens từ EscrowVault sử dụng chữ ký EIP-712
 * @dev Hỗ trợ single và batch withdrawals.
 *      Trong script này, user ký và operator gửi giao dịch là cùng một account.
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
 * @notice Single token withdrawal using EIP-712 signature.
 * @dev The user signs the withdrawal request, and an operator submits it.
 *      For this script, the user and operator are the same signer.
 */
async function withdrawToken(config: WithdrawConfig): Promise<boolean> {
    console.log("🚀 Starting token withdrawal with signature...");

    // Get signer. For this script, we use the same account as user (signer) and operator (submitter).
    // In a production environment, the operator would be a separate, trusted backend wallet.
    const [operator, , user] = await ethers.getSigners();
    console.log("📝 User (signer) address:", user.address);
    console.log("👮 Operator (submitter) address:", operator.address);

    // Contract addresses
    const VAULT_ADDRESS = process.env.VAULT_CONTRACT;
    if (!VAULT_ADDRESS) {
        console.error("❌ Please set VAULT_CONTRACT in your .env file");
        return false;
    }

    // Get contract instances
    const vault: any = await ethers.getContractAt("EscrowVault", VAULT_ADDRESS);
    const token = await ethers.getContractAt("IERC20", config.token);

    try {
        const symbol = config.symbol || await token.symbol();
        const decimals = config.decimals !== undefined ? config.decimals : Number(await token.decimals());

        console.log("📊 Withdrawal Configuration:");
        console.log(`  - Token: ${config.token} (${symbol})`);
        console.log(`  - Amount: ${ethers.formatUnits(config.amount, decimals)} ${symbol}`);
        console.log(`  - Vault: ${VAULT_ADDRESS}`);

        // Check vault balance
        const vaultBalance = await vault.getBalance(user.address, config.token);
        const withdrawAmount = BigInt(config.amount);

        console.log(`🏦 Vault Balance: ${ethers.formatUnits(vaultBalance, decimals)} ${symbol}`);
        console.log(`📊 Withdraw Amount: ${ethers.formatUnits(withdrawAmount, decimals)} ${symbol}`);

        if (vaultBalance < withdrawAmount) {
            throw new Error(`Insufficient vault balance. Need: ${ethers.formatUnits(withdrawAmount, decimals)}, Have: ${ethers.formatUnits(vaultBalance, decimals)}`);
        }

        // Check current user balance
        const currentUserBalance = await token.balanceOf(user.address);
        console.log(`💰 Current User Balance: ${ethers.formatUnits(currentUserBalance, decimals)} ${symbol}`);

        // === EIP-712 Signature Generation ===

        // 1. Get nonce from contract
        const nonce = await vault.getNonce(user.address);
        console.log(`🔐 Current nonce for ${user.address}: ${nonce.toString()}`);

        // 2. Define EIP-712 domain
        const domain: TypedDataDomain = {
            name: "EscrowVault",
            version: "1",
            chainId: (await ethers.provider.getNetwork()).chainId,
            verifyingContract: VAULT_ADDRESS,
        };

        // 3. Define EIP-712 types
        const types = {
            WithdrawRequest: [
                { name: "user", type: "address" },
                { name: "token", type: "address" },
                { name: "amount", type: "uint256" },
                { name: "nonce", type: "uint256" },
            ],
        };

        // 4. Create the data to sign
        const request = {
            user: user.address,
            token: config.token,
            amount: config.amount,
            nonce,
        };
        // console.log("✍️  Signing request:", JSON.stringify(request, null, 2));

        // 5. Sign the data
        const signature = await user.signTypedData(domain, types, request);
        console.log("🖋️  User signature:", signature);

        // 6. Estimate gas (as operator)
        const gasEstimate = await vault.connect(operator).withdrawWithSignature.estimateGas(
            request,
            signature
        );
        console.log(`⛽ Gas estimate: ${gasEstimate.toString()}`);

        // 7. Send transaction (as operator)
        console.log("🔄 Operator submitting withdrawal...");
        const tx = await vault.connect(operator).withdrawWithSignature(
            request,
            signature,
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
                        topics: Array.from(log.topics),
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
            const newVaultBalance = await vault.getBalance(user.address, config.token);
            const newUserBalance = await token.balanceOf(user.address);

            console.log("\n📋 Updated Balances:");
            console.log(`🏦 Vault Balance: ${ethers.formatUnits(newVaultBalance, decimals)} ${symbol}`);
            console.log(`💰 User Balance: ${ethers.formatUnits(newUserBalance, decimals)} ${symbol}`);

            return true;
        } else {
            throw new Error("Transaction failed");
        }

    } catch (error: any) {

        const errorData = error.data;
        console.log("❌ Error data:", errorData);
        const parsedError = vault.interface.parseError(errorData);
        console.log("❌ Parsed error:", parsedError);

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

// Examples and main execution
async function main() {
    // Example token addresses (replace with real ones from your .env)
    const USDC_ADDRESS = process.env.USDC_ADDRESS || "0xA0b86a33E6426c8bf8fB4b6E2b78BB9db20CEaE3";

    // Single withdrawal example
    const singleWithdrawConfig: WithdrawConfig = {
        token: USDC_ADDRESS,
        amount: ethers.parseUnits("1", 6).toString(), // 1 USDC (6 decimals)
        symbol: "USDC",
        decimals: 6
    };

    console.log("🎯 Choose withdrawal operation (script will run demos):");
    console.log("1. Single Token Withdrawal");
    console.log("2. Withdraw Max Balance");
    console.log("3. Withdraw All Balances");
    console.log("4. Batch Token Withdrawal (uncomment to run)");
    console.log("5. Emergency Withdrawal (uncomment to run)");


    // NOTE: These demos will likely fail if you don't have funds deposited in the vault.
    // Use the `5-deposit-vault.ts` script first.

    // Demo single withdrawal
    console.log("\n🎯 Demo: Single token withdrawal");
    console.log(JSON.stringify(singleWithdrawConfig, null, 2));

    try {
        await withdrawToken(singleWithdrawConfig);
    } catch (error) {
        console.log("⚠️ Single withdrawal demo failed. Did you deposit first?");
    }

}

// Export functions for use in other scripts
export {
    withdrawToken,
    WithdrawConfig,
};

// Run if called directly
if (require.main === module) {
    main()
        .then(() => {
            console.log("\n🎉 Vault withdrawal script completed!");
            process.exit(0);
        })
        .catch((error) => {
            console.error("\n💥 Vault withdrawal script failed:", error);
            process.exit(1);
        });
} 