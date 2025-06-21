import { ethers } from "hardhat";
import { saveDeploymentInfo } from "../utils/save-deploy";

const main = async () => {
    console.log("\n1. Deploying EscrowVault...");
    const EscrowVault = await ethers.getContractFactory("EscrowVault");
    const vault = await EscrowVault.deploy();
    await vault.waitForDeployment();
    const vaultAddress = await vault.getAddress();
    console.log("EscrowVault deployed to:", vaultAddress);
    await saveDeploymentInfo(
        {
            vault: vaultAddress
        },
        {

        } as any
    )
}

if (require.main === module) {
    main()
        .then(() => {
            process.exit(0);
        })
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}