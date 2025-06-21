import { ethers, upgrades } from "hardhat";
import { DeploymentConfig, saveDeploymentInfo } from "../utils/save-deploy";



async function deployPreMarketTradeV2(config: DeploymentConfig): Promise<{
    preMarketTrade: string;
    vault: string;
    implementation: string;
}> {
    console.log("🚀 Starting PreMarketTradeV2 Ultra-Simple deployment...");
    console.log("📋 Configuration:", JSON.stringify(config, null, 2));

    // Get deployer
    const [deployer] = await ethers.getSigners();
    console.log("👤 Deployer address:", deployer.address);
    console.log("💰 Deployer balance:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)), "ETH");

    // Deploy or use existing vault
    const vaultAddress = config.vault!;

    // Deploy PreMarketTradeV2
    console.log("📦 Deploying PreMarketTradeV2 Ultra-Simple...");

    const PreMarketTradeV2 = await ethers.getContractFactory("PreMarketTradeV2");

    // Deploy with proxy (ultra-simple version only needs 3 parameters)
    const preMarketTrade = await upgrades.deployProxy(
        PreMarketTradeV2,
        [
            vaultAddress,
            config.admin,
            config.treasury,
            config.admin
        ],
        {
            initializer: "initialize",
            kind: "uups"
        }
    );

    await preMarketTrade.waitForDeployment();
    const preMarketTradeAddress = await preMarketTrade.getAddress();

    console.log(`✅ PreMarketTradeV2 Ultra-Simple deployed at: ${preMarketTradeAddress}`);

    // Get implementation address
    const implementationAddress = await upgrades.erc1967.getImplementationAddress(preMarketTradeAddress);
    console.log(`📋 Implementation address: ${implementationAddress}`);

    // Configure protocol fee if different from default
    if (config.protocolFeeBps !== 50) {
        console.log("⚙️ Updating protocol fee...");
        const protocolFeeTx = await preMarketTrade.setProtocolFee(config.protocolFeeBps);
        await protocolFeeTx.wait();
        console.log("✅ Protocol fee updated");
    }

    // Grant vault permissions if we deployed it
    if (!config.vault) {
        console.log("⚙️ Granting vault permissions...");
        const vault = await ethers.getContractAt("EscrowVault", vaultAddress);

        // Grant SPENDER_ROLE to PreMarketTradeV2
        const SPENDER_ROLE = await vault.SPENDER_ROLE();
        const grantTx = await vault.grantRole(SPENDER_ROLE, preMarketTradeAddress);
        await grantTx.wait();

        console.log("✅ Vault permissions granted");
    }

    return {
        preMarketTrade: preMarketTradeAddress,
        vault: vaultAddress,
        implementation: implementationAddress
    };
}



async function main() {
    const [deployer] = await ethers.getSigners();
    // Configuration for different networks
    const configs: Record<string, DeploymentConfig> = {
        'base-sepolia': {
            admin: deployer.address,
            treasury: deployer.address,
            protocolFeeBps: 500, // 5% for testnet
            vault: process.env.ESCROW_VAULT_ADDRESS!,
            network: "base-sepolia",
            gasPrice: "20000000000", // 20 gwei
            verify: true,
            apiKey: process.env.ETHERSCAN_API_KEY
        },

    };

    // Get network from command line or environment
    const networkName = process.env.HARDHAT_NETWORK || "localhost";
    const config = configs[networkName];

    if (!config) {
        throw new Error(`No configuration found for network: ${networkName}`);
    }

    // Validate required addresses
    if (!config.admin) {
        throw new Error("Admin address is required");
    }

    if (!config.treasury) {
        throw new Error("Treasury address is required");
    }

    try {
        // Deploy contracts
        const addresses = await deployPreMarketTradeV2(config);

        // Verify contracts
        // await verifyContracts(addresses, config);

        // Save deployment info
        await saveDeploymentInfo(addresses, config);

        console.log("\n🎉 Ultra-Simple Deployment Summary:");
        console.log("=".repeat(50));
        console.log(`📍 Network: ${config.network}`);
        console.log(`🏛️ PreMarketTradeV2: ${addresses.preMarketTrade}`);
        console.log(`🏦 EscrowVault: ${addresses.vault}`);
        console.log(`📋 Implementation: ${addresses.implementation}`);
        console.log(`👤 Admin: ${config.admin}`);
        console.log(`💰 Treasury: ${config.treasury}`);
        console.log(`💸 Protocol Fee: ${config.protocolFeeBps / 100}%`);
        console.log("=".repeat(50));

        console.log("\n📝 Ultra-Simple Usage:");
        console.log("1. Users deposit collateral into EscrowVault");
        console.log("2. Offchain system handles all matching logic");
        console.log("3. Sellers call settle() to complete trades");
        console.log("4. Buyers call cancel() to withdraw after deadlines");
        console.log("5. All complex logic is handled offchain");

        // Export addresses for other scripts
        process.env.PREMARKET_V2_ADDRESS = addresses.preMarketTrade;
        process.env.VAULT_ADDRESS = addresses.vault;

    } catch (error) {
        console.error("❌ Deployment failed:", error);
        process.exit(1);
    }
}

// Hàm upgrade contract (gọi riêng khi cần upgrade)
async function upgradeContract(proxyAddress: string) {
    console.log("Upgrading PreMarketTradeV2...");

    const PreMarketTradeV2 = await ethers.getContractFactory("PreMarketTradeV2");
    const upgraded = await upgrades.upgradeProxy(proxyAddress, PreMarketTradeV2);

    console.log("PreMarketTradeV2 upgraded");
    const newImplAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);
    console.log("New implementation address:", newImplAddress);

    return upgraded;
}

// Export functions for use in other scripts
export {
    deployPreMarketTradeV2,
    saveDeploymentInfo
};

// Run if called directly
if (require.main === module) {
    upgradeContract('0x7eE4Fe459d6438e6E757Cc0f1144907c308d7f6B')
        .then(() => {
            console.log("🎉 Ultra-Simple Deployment completed successfully!");
            process.exit(0);
        })
        .catch((error) => {
            console.error("💥 Deployment failed:", error);
            process.exit(1);
        });
} 