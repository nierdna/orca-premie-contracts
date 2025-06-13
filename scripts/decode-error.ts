import { ethers } from "hardhat";

async function decodeError() {
    console.log("🔍 Decoding error selector...");

    const errorData = "0xe2517d3f0000000000000000000000009d90aeb5c841925fc8d7c5481c02523bdac95585facaf2747a7486cf5730e9265973fb54447d3ace6e7e4711f6360826b0731941";
    const CONTRACT_ADDRESS = process.env.PREMARKET_CONTRACT || "0x9D90aeb5c841925fc8D7c5481c02523bDAc95585";

    try {
        const preMarketTrade = await ethers.getContractAt("PreMarketTrade", CONTRACT_ADDRESS);

        // Get interface để decode
        const iface = preMarketTrade.interface;

        console.log(`Error data: ${errorData}`);
        console.log(`Error selector: ${errorData.slice(0, 10)}`);

        // Try to decode with interface first
        try {
            const decoded = iface.parseError(errorData);
            console.log(`\n✅ Decoded error:`, decoded);
            console.log(`Error name: ${decoded.name}`);
            console.log(`Error args:`, decoded.args);
            return;
        } catch (decodeError) {
            console.log(`\n❌ Could not decode error with interface`);
        }

        // List các custom errors có thể có
        const possibleErrors = [
            "IncompatibleOrders()",
            "OrderExpired()",
            "ZeroAmount()",
            "SelfTrade()",
            "TokenNotExists()",
            "InvalidFillAmount()",
            "BelowMinimumFill()",
            "OrderAlreadyUsed()",
            "InvalidSignature()",
            "TradeNotFound()",
            "TradeAlreadySettled()",
            "OnlySellerCanSettle()",
            "OnlyBuyerCanCancel()",
            "TokenAlreadyMapped()",
            "GracePeriodNotExpired()",
            "PriceOutOfBounds()",
            "InvalidCollateralRatio()",
            "InvalidRewardParameters()",
            "InsufficientBalance()",
            "InsufficientBalance(address,address)",
            "InsufficientVaultBalance(address,address,uint256,uint256)"
        ];

        // Tính toán selector cho từng error
        console.log("\n🧮 Calculating error selectors:");
        for (const errorSig of possibleErrors) {
            const selector = ethers.id(errorSig).slice(0, 10);
            console.log(`${errorSig}: ${selector}`);

            if (selector === errorData.slice(0, 10)) {
                console.log(`\n✅ FOUND MATCH: ${errorSig}`);
                console.log(`🔍 This error means the transaction failed due to: ${errorSig.replace('()', '')}`);

                // Try to decode parameters manually if it has parameters
                if (errorSig.includes('(address,address')) {
                    const paramData = errorData.slice(10); // Remove selector
                    console.log(`Parameters data: ${paramData}`);
                    try {
                        const decoded = ethers.AbiCoder.defaultAbiCoder().decode(['address', 'address'], '0x' + paramData);
                        console.log(`Decoded parameters: ${decoded}`);
                    } catch (e) {
                        console.log(`Could not decode parameters automatically`);
                    }
                }
                return;
            }
        }

        console.log(`\n❌ Error selector ${errorData.slice(0, 10)} not found in common errors`);

        // Manual check for specific selector
        const selector = errorData.slice(0, 10);
        if (selector === "0xe2517d3f") {
            console.log("\n🔍 Manual decode attempt for selector 0xe2517d3f");
            // This could be InsufficientBalance with parameters
            const paramData = errorData.slice(10);
            console.log(`Parameter data: ${paramData}`);

            // Try decoding as (address, address)
            try {
                const decoded = ethers.AbiCoder.defaultAbiCoder().decode(['address', 'address'], '0x' + paramData);
                console.log(`Decoded as (address, address): ${decoded}`);
            } catch (e) {
                console.log(`Not (address, address) format`);
            }

            // Try decoding as (address, address, uint256, uint256)
            try {
                const decoded = ethers.AbiCoder.defaultAbiCoder().decode(['address', 'address', 'uint256', 'uint256'], '0x' + paramData);
                console.log(`Decoded as (address, address, uint256, uint256): ${decoded}`);
            } catch (e) {
                console.log(`Not (address, address, uint256, uint256) format`);
            }
        }

    } catch (error: any) {
        console.error("❌ Error:", error.message);
    }
}

decodeError()
    .then(() => {
        console.log("🎉 Decode completed!");
        process.exit(0);
    })
    .catch((error) => {
        console.error("💥 Decode failed:", error);
        process.exit(1);
    }); 