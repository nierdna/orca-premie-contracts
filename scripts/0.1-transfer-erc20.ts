import { ethers } from "hardhat";

/**
 * Script đơn giản để chuyển ERC20 token từ deployer sang user1
 * Chạy với: npx hardhat run scripts/0.1-transfer-erc20.ts --network localhost
 */
async function main() {
    console.log("🚀 Bắt đầu deploy MockERC20 và chuyển token từ deployer sang user1...");

    // Lấy danh sách accounts từ hardhat
    const [deployer, user1,] = await ethers.getSigners();

    console.log("📋 Thông tin accounts:");
    console.log("Deployer address:", deployer.address);
    console.log("User1 address:", user1.address);

    // Deploy MockERC20 contract
    console.log("\n📜 Đang deploy MockERC20 contract...");
    const abi = [
        "function mint(address to, uint256 amount) public",
        "function balanceOf(address account) public view returns (uint256)",
        "function transfer(address to, uint256 amount) public returns (bool)",
        "function decimals() public view returns (uint8)",
        "function name() public view returns (string)",
        "function symbol() public view returns (string)",
        "function totalSupply() public view returns (uint256)",
        "function transferFrom(address from, address to, uint256 amount) public returns (bool)",
    ];
    const mockToken = new ethers.Contract("0x2fEe5278e6552aA879137a95F550E7736541C303", abi, deployer) as any;
    const tokenAddress = await mockToken.getAddress();
    console.log("✅ MockERC20 deployed tại địa chỉ:", tokenAddress);
    const decimals = await mockToken.decimals();
    console.log("Decimals:", decimals);

    const deployerBalanceBefore = await mockToken.balanceOf(deployer.address);
    const user1BalanceBefore = await mockToken.balanceOf(user1.address);

    console.log("\n💰 Token balance trước khi chuyển:");
    console.log("Deployer balance:", ethers.formatUnits(deployerBalanceBefore, decimals), "MOCK");
    console.log("User1 balance:", ethers.formatUnits(user1BalanceBefore, decimals), "MOCK");

    // Số lượng token muốn chuyển (100 MOCK)
    const transferAmount = ethers.parseUnits("10000", decimals);

    console.log("\n📤 Đang chuyển", ethers.formatUnits(transferAmount, decimals), "MOCK từ deployer sang user1...");

    // Thực hiện chuyển ERC20 token
    const tx = await mockToken.connect(deployer).transfer(user1.address, transferAmount);

    console.log("Transaction hash:", tx.hash);

    // Chờ transaction được confirm
    const receipt = await tx.wait();
    console.log("✅ Transaction confirmed in block:", receipt?.blockNumber);

    // Kiểm tra balance sau khi chuyển
    const deployerBalanceAfter = await mockToken.balanceOf(deployer.address);
    const user1BalanceAfter = await mockToken.balanceOf(user1.address);

    console.log("\n💰 Token balance sau khi chuyển:");
    console.log("Deployer balance:", ethers.formatUnits(deployerBalanceAfter, decimals), "MOCK");
    console.log("User1 balance:", ethers.formatUnits(user1BalanceAfter, decimals), "MOCK");

    // Tính toán gas fee đã sử dụng
    const gasUsed = receipt?.gasUsed || 0n;
    const gasPrice = receipt?.gasPrice || 0n;
    const gasFee = gasUsed * gasPrice;

    console.log("\n⛽ Chi phí gas cho transfer:");
    console.log("Gas used:", gasUsed.toString());
    console.log("Gas fee:", ethers.formatEther(gasFee), "ETH");

    // Hiển thị thông tin token contract
    const tokenName = await mockToken.name();
    const tokenSymbol = await mockToken.symbol();
    const tokenDecimals = await mockToken.decimals();
    const totalSupply = await mockToken.totalSupply();

    console.log("\n📊 Thông tin token contract:");
    console.log("Contract address:", tokenAddress);
    console.log("Token name:", tokenName);
    console.log("Token symbol:", tokenSymbol);
    console.log("Decimals:", tokenDecimals);
    console.log("Total supply:", ethers.formatUnits(totalSupply, decimals), tokenSymbol);

    console.log("\n🎉 Chuyển ERC20 token thành công!");
}

// Xử lý lỗi và chạy script
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Lỗi:", error);
        process.exit(1);
    });
