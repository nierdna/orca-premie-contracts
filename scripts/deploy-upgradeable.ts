import { ethers, upgrades } from "hardhat";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);

    // Deploy EscrowVault trước (nếu chưa có)
    // console.log("\n1. Deploying EscrowVault...");
    // const EscrowVault = await ethers.getContractFactory("EscrowVault");
    // const vault = await EscrowVault.deploy();
    // await vault.waitForDeployment();
    // const vaultAddress = await vault.getAddress();
    const vaultAddress = '0x6B4792a57caBEbE6363ce3C0354D1494e63d0320';
    console.log("EscrowVault deployed to:", vaultAddress);

    // Deploy PreMarketTrade as upgradeable proxy
    console.log("\n2. Deploying PreMarketTrade (Upgradeable)...");
    const PreMarketTrade = await ethers.getContractFactory("PreMarketTrade");

    // Deploy với proxy pattern
    const preMarketTrade = await upgrades.deployProxy(
        PreMarketTrade,
        [
            vaultAddress,  // _vault
            deployer.address  // _admin
        ],
        {
            kind: 'uups',  // Sử dụng UUPS proxy pattern
            initializer: 'initialize'
        }
    );

    await preMarketTrade.waitForDeployment();
    const proxyAddress = await preMarketTrade.getAddress();
    console.log("PreMarketTrade Proxy deployed to:", proxyAddress);

    // Get implementation address
    const implementationAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);
    console.log("PreMarketTrade Implementation deployed to:", implementationAddress);

    // Verify contracts on testnet/mainnet
    console.log("\n3. Contract addresses summary:");
    console.log("EscrowVault:", vaultAddress);
    console.log("PreMarketTrade Proxy:", proxyAddress);
    console.log("PreMarketTrade Implementation:", implementationAddress);
    console.log("Admin:", deployer.address);

    return {
        vault: vaultAddress,
        proxy: proxyAddress,
        implementation: implementationAddress
    };
}

// Hàm upgrade contract (gọi riêng khi cần upgrade)
async function upgradeContract(proxyAddress: string) {
    console.log("Upgrading PreMarketTrade...");

    const PreMarketTradeV2 = await ethers.getContractFactory("PreMarketTrade");
    const upgraded = await upgrades.upgradeProxy(proxyAddress, PreMarketTradeV2);

    console.log("PreMarketTrade upgraded");
    const newImplAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);
    console.log("New implementation address:", newImplAddress);

    return upgraded;
}

upgradeContract('0x21C732c876Ee2CC0B5F13554f7d2f3045c7aBB9d')
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

// Export cho reuse
export { main as deployUpgradeable, upgradeContract }; 