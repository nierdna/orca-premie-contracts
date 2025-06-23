import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { PreMarketTradeV2, EscrowVault, IERC20Metadata } from "../../typechain-types";
import "dotenv/config";

/**
 * @title Cancellation Script for PreMarketTradeV2
 * @notice Script để thực thi chức năng `cancel` trên contract PreMarketTradeV2.
 * @dev Script này chuẩn bị dữ liệu cancellation, tạo chữ ký EIP-712 từ operator,
 *      và gửi giao dịch `cancel` từ tài khoản của buyer.
 */

// ============ Interfaces ============

/**
 * @notice Cấu hình cho một cancellation.
 */
interface CancellationConfig {
    orderIds: string[];         // Mảng các order ID (bytes32) để hủy
    collateralToken: string;    // Địa chỉ token dùng để thanh toán
    amount: string;             // Số lượng collateral để rút về (wei)
    deadline: number;           // Thời hạn của cancellation (timestamp)
}

/**
 * @notice Dữ liệu đầy đủ cho cancellation, bao gồm chữ ký.
 */
interface CancellationData extends CancellationConfig {
    buyer: string;              // Địa chỉ của buyer thực hiện cancel
    nonce: bigint;
    operatorSignature: string;
}

// ============ Helper Functions ============

/**
 * @notice Lấy các signers cần thiết (operator, buyer).
 * @dev Cấu hình các ví này trong hardhat.config.ts.
 */
async function getSigners() {
    const signers = await ethers.getSigners();
    const operator = signers[0]; // Giả sử ví đầu tiên là operator
    const buyer = signers[2];   // Giả sử ví thứ 3 là buyer (khớp với buyer trong settle)

    console.log("🔑 Operator address:", operator.address);
    console.log("🔑 Buyer address:", buyer.address);

    return { operator, buyer };
}

/**
 * @notice Tạo chữ ký EIP-712 cho dữ liệu cancellation.
 * @dev Chữ ký này được tạo bởi operator để xác thực cancellation.
 */
async function createCancellationSignature(
    tradeContract: PreMarketTradeV2,
    operator: HardhatEthersSigner,
    buyerAddress: string,
    cancelConfig: CancellationConfig
): Promise<{ signature: string; nonce: bigint }> {
    console.log("\n✍️  Creating EIP-712 cancellation signature...");

    const nonce = await tradeContract.operatorNonce();
    const chainId = (await ethers.provider.getNetwork()).chainId;

    const domain = {
        name: "PreMarketTradeV2",
        version: "2.0.0", // Phải khớp với version trong __EIP712_init
        chainId: chainId,
        verifyingContract: await tradeContract.getAddress()
    };

    // Types cho CancellationData struct trong contract
    const types = {
        Cancellation: [
            { name: 'orderIds', type: 'bytes32[]' }, // Contract hash mảng này
            { name: 'buyer', type: 'address' },
            { name: 'collateralToken', type: 'address' },
            { name: 'amount', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
        ]
    };

    // Dữ liệu để ký
    // Chú ý: contract hash các mảng trước khi đưa vào struct hash chính
    const value = {
        orderIds: cancelConfig.orderIds,
        buyer: buyerAddress,
        collateralToken: cancelConfig.collateralToken,
        amount: cancelConfig.amount,
        deadline: cancelConfig.deadline,
        nonce: nonce,
    };

    console.log("🖋️ Signing data:", value);
    const signature = await operator.signTypedData(domain, types, value);
    console.log("✅ Signature created:", signature);

    return { signature, nonce };
}


// ============ Main Execution Function ============

/**
 * @notice Thực thi cancellation.
 */
async function executeCancel(
    tradeContract: PreMarketTradeV2,
    buyer: HardhatEthersSigner,
    cancellationData: CancellationData
) {
    console.log("\n🚀 Executing cancellation...");

    try {
        const collateralToken = await ethers.getContractAt("IERC20Metadata", cancellationData.collateralToken) as unknown as IERC20Metadata;
        const vault = await ethers.getContractAt("EscrowVault", process.env.VAULT_CONTRACT!) as unknown as EscrowVault;
        const collateralDecimals = await collateralToken.decimals();

        // 1. Log initial state
        console.log("📊 Initial State:");
        const buyerCollateralBefore = await vault.getBalance(buyer.address, cancellationData.collateralToken);
        console.log(`  - Buyer collateral in vault: ${ethers.formatUnits(buyerCollateralBefore, collateralDecimals)}`);

        // 2. Prepare data for contract call
        const data = {
            orderIds: cancellationData.orderIds,
            buyer: cancellationData.buyer,
            collateralToken: cancellationData.collateralToken,
            amount: cancellationData.amount,
            deadline: cancellationData.deadline,
            nonce: cancellationData.nonce,
            operatorSignature: cancellationData.operatorSignature,
        };

        // 3. Estimate gas and execute
        console.log("\n⛽ Estimating gas for cancel...");
        const gasEstimate = await tradeContract.connect(buyer).cancel.estimateGas(data);
        console.log(`  - Gas estimate: ${gasEstimate.toString()}`);

        console.log("...Submitting cancel transaction...");
        const tx = await tradeContract.connect(buyer).cancel(data, {
            gasLimit: gasEstimate + BigInt(50000)
        });

        console.log(`📤 Transaction sent: ${tx.hash}`);
        console.log("⏳ Waiting for confirmation...");
        const receipt = await tx.wait();

        if (receipt && receipt.status === 1) {
            console.log("✅ Cancellation successful!");
            const cancellationEvent = receipt.logs?.find(
                log => (log as any).eventName === 'Cancellation'
            );
            if (cancellationEvent) {
                console.log("  - Cancellation Event found in transaction logs.");
            }
        } else {
            throw new Error(`Transaction failed: ${tx.hash}`);
        }

        // 4. Log final state
        console.log("\n📊 Final State:");
        const buyerCollateralAfter = await vault.getBalance(buyer.address, cancellationData.collateralToken);
        console.log(`  - Buyer collateral in vault: ${ethers.formatUnits(buyerCollateralAfter, collateralDecimals)}`);

    } catch (error: any) {
        console.error("❌ Error during cancellation:", error.message);
        if (error.data) {
            const decodedError = tradeContract.interface.parseError(error.data);
            console.error(`Contract Error: ${decodedError?.name}`, decodedError?.args);
        }
        throw error;
    }
}

// ============ Main Script ============
async function main() {
    console.log("--- PreMarketTradeV2 Cancellation Script ---");

    // Get contract addresses from .env
    const tradeContractAddress = process.env.V2_CONTRACT;
    const usdcAddress = process.env.USDC_ADDRESS; // Collateral Token

    if (!tradeContractAddress || !usdcAddress || !process.env.VAULT_CONTRACT) {
        throw new Error("Missing contract addresses in .env file");
    }

    // Get signers
    const { operator, buyer } = await getSigners();

    // Get contract instance
    const tradeContract = await ethers.getContractAt("PreMarketTradeV2", tradeContractAddress) as unknown as PreMarketTradeV2;

    // --- Prepare Cancellation Data ---
    // Dữ liệu này thường đến từ off-chain logic, ví dụ buyer yêu cầu hủy lệnh
    // và operator xác nhận.
    const cancelConfig: CancellationConfig = {
        orderIds: [ethers.id("ORDER_3"), ethers.id("ORDER_4")],
        collateralToken: usdcAddress,
        amount: ethers.parseUnits("5", 6).toString(), // Số tiền buyer muốn rút
        deadline: Math.floor(Date.now() / 1000) + 3600, // 1 giờ kể từ bây giờ
    };

    console.log("\n📋 Cancellation Configuration:", cancelConfig);

    // --- Create Signature ---
    const { signature, nonce } = await createCancellationSignature(tradeContract, operator, buyer.address, cancelConfig);

    const cancellationData: CancellationData = {
        ...cancelConfig,
        buyer: buyer.address,
        nonce: nonce,
        operatorSignature: signature
    };

    // --- Execute Cancellation ---
    await executeCancel(tradeContract, buyer, cancellationData);

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

export { executeCancel, createCancellationSignature, CancellationConfig };
