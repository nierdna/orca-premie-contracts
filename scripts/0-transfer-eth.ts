import { ethers } from "hardhat";

/**
 * Script đơn giản để chuyển ETH từ deployer sang user1
 * Chạy với: npx hardhat run scripts/0-transfer-eth.ts --network localhost
 */
async function main() {
    console.log("🚀 Bắt đầu chuyển ETH từ deployer sang user1...");

    // Lấy danh sách accounts từ hardhat
    const [deployer, , user1] = await ethers.getSigners();

    console.log("📋 Thông tin accounts:");
    console.log("Deployer address:", deployer.address);
    console.log("User1 address:", user1.address);

    // Kiểm tra balance trước khi chuyển
    const deployerBalanceBefore = await ethers.provider.getBalance(deployer.address);
    const user1BalanceBefore = await ethers.provider.getBalance(user1.address);

    console.log("\n💰 Balance trước khi chuyển:");
    console.log("Deployer balance:", ethers.formatEther(deployerBalanceBefore), "ETH");
    console.log("User1 balance:", ethers.formatEther(user1BalanceBefore), "ETH");

    // Số lượng ETH muốn chuyển (1 ETH)
    const transferAmount = ethers.parseEther("0.0001");

    console.log("\n📤 Đang chuyển", ethers.formatEther(transferAmount), "ETH từ deployer sang user1...");

    // Thực hiện chuyển ETH
    const tx = await deployer.sendTransaction({
        to: user1.address,
        value: transferAmount
    });

    console.log("Transaction hash:", tx.hash);

    // Chờ transaction được confirm
    const receipt = await tx.wait();
    console.log("✅ Transaction confirmed in block:", receipt?.blockNumber);

    // Kiểm tra balance sau khi chuyển
    const deployerBalanceAfter = await ethers.provider.getBalance(deployer.address);
    const user1BalanceAfter = await ethers.provider.getBalance(user1.address);

    console.log("\n💰 Balance sau khi chuyển:");
    console.log("Deployer balance:", ethers.formatEther(deployerBalanceAfter), "ETH");
    console.log("User1 balance:", ethers.formatEther(user1BalanceAfter), "ETH");

    // Tính toán gas fee đã sử dụng
    const gasUsed = receipt?.gasUsed || 0n;
    const gasPrice = receipt?.gasPrice || 0n;
    const gasFee = gasUsed * gasPrice;

    console.log("\n⛽ Chi phí gas:");
    console.log("Gas used:", gasUsed.toString());
    console.log("Gas fee:", ethers.formatEther(gasFee), "ETH");

    console.log("\n🎉 Chuyển ETH thành công!");
}

// Xử lý lỗi và chạy script
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Lỗi:", error);
        process.exit(1);
    });
