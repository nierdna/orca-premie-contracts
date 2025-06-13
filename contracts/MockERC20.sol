// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockERC20
 * @notice Mock ERC20 token contract dùng để test
 * @dev Cho phép mint token cho testing purposes
 */
contract MockERC20 is ERC20 {
    uint8 private _decimals;

    /**
     * @notice Constructor để tạo mock token
     * @param name Tên của token
     * @param symbol Symbol của token  
     * @param decimals_ Số decimals của token
     */
    constructor(
        string memory name, 
        string memory symbol, 
        uint8 decimals_
    ) ERC20(name, symbol) {
        _decimals = decimals_;
    }

    /**
     * @notice Override decimals function
     * @return Số decimals của token
     */
    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    /**
     * @notice Mint tokens cho address cụ thể (chỉ dùng để test)
     * @param to Địa chỉ nhận token
     * @param amount Số lượng token cần mint
     */
    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }

    /**
     * @notice Burn tokens từ address cụ thể (chỉ dùng để test)
     * @param from Địa chỉ bị burn token
     * @param amount Số lượng token cần burn
     */
    function burn(address from, uint256 amount) public {
        _burn(from, amount);
    }
} 