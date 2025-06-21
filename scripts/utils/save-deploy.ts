import { ethers } from "hardhat";
import { writeFileSync } from "fs";

/**
 * @title Deploy PreMarketTradeV2 Script - Ultra Simple Version
 * @notice Deploy the ultra-simplified PreMarketTradeV2 contract
 * @dev Only settle() and cancel() functions - all logic moved offchain
 */

export interface DeploymentConfig {
    // Core addresses
    vault?: string;
    admin: string;
    treasury: string;

    // Economic parameters
    protocolFeeBps: number;

    // Network configuration
    network: string;
    gasPrice?: string;
    gasLimit?: number;

    // Verification
    verify: boolean;
    apiKey?: string;
}


export async function saveDeploymentInfo(addresses: {

    preMarketTrade?: string;
    vault: string;
    implementation?: string;
}, config: DeploymentConfig) {
    const deploymentInfo = {
        network: config.network,
        timestamp: new Date().toISOString(),
        contracts: addresses,
        configuration: config,
        deployer: (await ethers.getSigners())[0].address
    };

    const filename = `deployments/premarket-trade-v2-ultra-simple-${config.network}-${Date.now()}.json`;
    writeFileSync(filename, JSON.stringify(deploymentInfo, null, 2));

    console.log(`📁 Deployment info saved to: ${filename}`);
}