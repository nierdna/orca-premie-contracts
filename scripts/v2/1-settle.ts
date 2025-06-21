import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { PreMarketTradeV2, EscrowVault, IERC20Metadata } from "../../typechain-types";
import "dotenv/config";

/**
 * @title Settlement Script for PreMarketTradeV2
 * @notice Script để thực thi chức năng `settle` trên contract PreMarketTradeV2.
 * @dev Script này chuẩn bị dữ liệu settlement, tạo chữ ký EIP-712 từ operator,
 *      và gửi giao dịch `settle` từ tài khoản của seller.
 */

// ============ Interfaces ============

/**
 * @notice Cấu hình cho một settlement.
 */
interface SettlementConfig {
    orderIds: string[];         // Mảng các order ID (bytes32)
    buyers: string[];           // Mảng địa chỉ của các buyer
    amounts: string[];          // Mảng số lượng token target cho mỗi buyer (wei)
    collateralToken: string;    // Địa chỉ token dùng để thanh toán
    targetToken: string;        // Địa chỉ token được mua/bán
    totalPayment: string;       // Tổng số tiền thanh toán (wei)
    deadline: number;           // Thời hạn của settlement (timestamp)
}

/**
 * @notice Dữ liệu đầy đủ cho settlement, bao gồm chữ ký.
 */
interface SettlementData extends SettlementConfig {
    nonce: bigint;
    operatorSignature: string;
}

// ============ Helper Functions ============

/**
 * @notice Lấy các signers cần thiết (operator, seller, buyers).
 * @dev Cấu hình các ví này trong hardhat.config.ts.
 */
async function getSigners() {
    const signers = await ethers.getSigners();
    const operator = signers[0]; // Giả sử ví thứ 2 là operator
    const seller = signers[1];   // Giả sử ví thứ 3 là seller
    const buyers = [signers[2], signers[2]]; // Giả sử ví 4, 5 là buyers

    console.log("🔑 Operator address:", operator.address);
    console.log("🔑 Seller address:", seller.address);
    console.log("🔑 Buyer 1 address:", buyers[0].address);
    console.log("🔑 Buyer 2 address:", buyers[1].address);

    return { operator, seller, buyers };
}

/**
 * @notice Kiểm tra và approve token cho contract PreMarketTrade.
 */
async function checkAndApproveToken(
    tokenAddress: string,
    owner: HardhatEthersSigner,
    spenderAddress: string,
    amount: string,
    tokenSymbol: string = "TOKEN"
): Promise<void> {
    console.log(`\n🔍 Checking allowance for seller to spend ${tokenSymbol}...`);
    const token = await ethers.getContractAt("IERC20Metadata", tokenAddress) as unknown as IERC20Metadata;
    const currentAllowance = await token.allowance(owner.address, spenderAddress);

    if (currentAllowance >= BigInt(amount)) {
        console.log(`✅ Sufficient allowance for ${tokenSymbol}.`);
        return;
    }

    const decimals = await token.decimals();
    console.log(`🔓 Approving ${ethers.formatUnits(amount, decimals)} ${tokenSymbol} for PreMarketTrade contract...`);
    const approveTx = await token.connect(owner).approve(spenderAddress, amount);
    await approveTx.wait();
    console.log(`✅ Approval successful for ${tokenSymbol}. Tx: ${approveTx.hash}`);
}


/**
 * @notice Tạo chữ ký EIP-712 cho dữ liệu settlement.
 * @dev Chữ ký này được tạo bởi operator để xác thực settlement.
 */
async function createSettlementSignature(
    tradeContract: PreMarketTradeV2,
    operator: HardhatEthersSigner,
    settlement: SettlementConfig
): Promise<{ signature: string; nonce: bigint }> {
    console.log("\n✍️  Creating EIP-712 settlement signature...");

    const nonce = await tradeContract.operatorNonce();
    const chainId = (await ethers.provider.getNetwork()).chainId;

    const domain = {
        name: "PreMarketTradeV2",
        version: "2.0.0",
        chainId: chainId,
        verifyingContract: await tradeContract.getAddress()
    };

    // The types for the Settlement struct in the contract
    const types = {
        Settlement: [
            { name: 'orderIds', type: 'bytes32[]' },
            { name: 'buyers', type: 'address[]' },
            { name: 'amounts', type: 'uint256[]' },
            { name: 'collateralToken', type: 'address' },
            { name: 'targetToken', type: 'address' },
            { name: 'totalPayment', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
        ]
    };

    // The data to sign
    const value = {
        orderIds: settlement.orderIds,
        buyers: settlement.buyers,
        amounts: settlement.amounts,
        collateralToken: settlement.collateralToken,
        targetToken: settlement.targetToken,
        totalPayment: settlement.totalPayment,
        deadline: settlement.deadline,
        nonce: nonce,
    };

    console.log("🖋️ Signing data:", value);
    const signature = await operator.signTypedData(domain, types, value);
    console.log("✅ Signature created:", signature);

    return { signature, nonce };
}

// ============ Main Execution Function ============

/**
 * @notice Thực thi settlement.
 */
async function executeSettle(
    tradeContract: PreMarketTradeV2,
    seller: HardhatEthersSigner,
    settlementData: SettlementData
) {
    console.log("\n🚀 Executing settlement...");

    try {
        const targetToken = await ethers.getContractAt("IERC20Metadata", settlementData.targetToken) as unknown as IERC20Metadata;
        const collateralToken = await ethers.getContractAt("IERC20Metadata", settlementData.collateralToken) as unknown as IERC20Metadata;
        const vault = await ethers.getContractAt("EscrowVault", process.env.VAULT_CONTRACT!) as unknown as EscrowVault;
        const targetDecimals = await targetToken.decimals();
        const collateralDecimals = await collateralToken.decimals();

        // 1. Log initial state
        console.log("�� Initial State:");
        const sellerTokenBefore = await targetToken.balanceOf(seller.address);
        console.log(`  - Seller target token balance: ${ethers.formatUnits(sellerTokenBefore, targetDecimals)}`);
        const sellerCollateralBefore = await vault.getBalance(seller.address, settlementData.collateralToken);
        console.log(`  - Seller collateral in vault: ${ethers.formatUnits(sellerCollateralBefore, collateralDecimals)}`);

        for (let i = 0; i < settlementData.buyers.length; i++) {
            const buyerTokenBefore = await targetToken.balanceOf(settlementData.buyers[i]);
            console.log(`  - Buyer ${i + 1} target token balance: ${ethers.formatUnits(buyerTokenBefore, targetDecimals)}`);
        }

        // 2. Approve tokens if necessary
        const totalAmountToSell = settlementData.amounts.reduce((sum, amount) => sum + BigInt(amount), BigInt(0));
        await checkAndApproveToken(
            settlementData.targetToken,
            seller,
            await tradeContract.getAddress(),
            totalAmountToSell.toString(),
            "TARGET"
        );

        // 3. Prepare data for contract call
        const data = {
            orderIds: settlementData.orderIds,
            buyers: settlementData.buyers,
            amounts: settlementData.amounts,
            collateralToken: settlementData.collateralToken,
            targetToken: settlementData.targetToken,
            totalPayment: settlementData.totalPayment,
            deadline: settlementData.deadline,
            nonce: settlementData.nonce,
            operatorSignature: settlementData.operatorSignature,
        };

        // 4. Estimate gas and execute
        console.log("\n⛽ Estimating gas for settle...");
        const gasEstimate = await tradeContract.connect(seller).settle.estimateGas(data);
        console.log(`  - Gas estimate: ${gasEstimate.toString()}`);

        console.log("...Submitting settle transaction...");
        const tx = await tradeContract.connect(seller).settle(data, {
            gasLimit: gasEstimate + BigInt(50000)
        });

        console.log(`📤 Transaction sent: ${tx.hash}`);
        console.log("⏳ Waiting for confirmation...");
        const receipt = await tx.wait();

        if (receipt && receipt.status === 1) {
            console.log("✅ Settlement successful!");
            const settlementEvent = receipt.logs?.find(
                log => (log as any).eventName === 'Settlement'
            );
            if (settlementEvent) {
                console.log("  - Settlement Event found in transaction logs.");
            }
        } else {
            throw new Error(`Transaction failed: ${tx.hash}`);
        }

        // 5. Log final state
        console.log("\n📊 Final State:");
        const sellerTokenAfter = await targetToken.balanceOf(seller.address);
        console.log(`  - Seller target token balance: ${ethers.formatUnits(sellerTokenAfter, targetDecimals)}`);
        const sellerCollateralAfter = await vault.getBalance(seller.address, settlementData.collateralToken);
        console.log(`  - Seller collateral in vault: ${ethers.formatUnits(sellerCollateralAfter, collateralDecimals)}`);

        for (let i = 0; i < settlementData.buyers.length; i++) {
            const buyerTokenAfter = await targetToken.balanceOf(settlementData.buyers[i]);
            console.log(`  - Buyer ${i + 1} target token balance: ${ethers.formatUnits(buyerTokenAfter, targetDecimals)}`);
        }

    } catch (error: any) {
        console.error("❌ Error during settlement:", error.message);
        if (error.data) {
            const decodedError = tradeContract.interface.parseError(error.data);
            console.error(`Contract Error: ${decodedError?.name}`, decodedError?.args);
        }
        throw error;
    }
}

// ============ Main Script ============
async function main() {
    console.log("--- PreMarketTradeV2 Settlement Script ---");

    // Get contract addresses from .env
    const tradeContractAddress = process.env.V2_CONTRACT;
    const usdcAddress = process.env.USDC_ADDRESS; // Collateral Token
    const wethAddress = process.env.WETH_ADDRESS; // Target Token

    if (!tradeContractAddress || !usdcAddress || !wethAddress || !process.env.VAULT_CONTRACT) {
        throw new Error("Missing contract addresses in .env file");
    }

    // Get signers
    const { operator, seller, buyers } = await getSigners();

    // Get contract instance
    const tradeContract = await ethers.getContractAt("PreMarketTradeV2", tradeContractAddress) as unknown as PreMarketTradeV2;

    // --- Prepare Settlement Data ---
    // This data would typically come from an off-chain matching engine.
    const settlementConfig: SettlementConfig = {
        orderIds: [ethers.id("ORDER_1"), ethers.id("ORDER_2")],
        buyers: [buyers[0].address, buyers[1].address],
        amounts: [
            ethers.parseUnits("1", 6).toString(), // Buyer 1 buys 1 TARGET
            ethers.parseUnits("1.5", 6).toString()  // Buyer 2 buys 1.5 TARGET
        ],
        collateralToken: usdcAddress,
        targetToken: wethAddress,
        totalPayment: ethers.parseUnits("5", 6).toString(), // Total collateral from buyers
        deadline: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    };

    console.log("\n📋 Settlement Configuration:", settlementConfig);

    // --- Create Signature ---
    const { signature, nonce } = await createSettlementSignature(tradeContract, operator, settlementConfig);

    const settlementData: SettlementData = {
        ...settlementConfig,
        nonce: nonce,
        operatorSignature: signature
    };

    // --- Execute Settlement ---
    await executeSettle(tradeContract, seller, settlementData);

    console.log("\n--- Script finished ---");
}

if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch(error => {
            console.error(error);
            process.exit(1);
        });
}

export { executeSettle, createSettlementSignature, SettlementConfig };
