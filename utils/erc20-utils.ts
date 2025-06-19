import { ethers } from "ethers";

// ERC20 ABI cho decimals function
const ERC20_DECIMALS_ABI = [
    "function decimals() view returns (uint8)"
];

// Cache để lưu decimals của các token đã query
const decimalsCache = new Map<string, number>();

/**
 * Get decimals of an ERC20 token with caching
 * @param tokenAddress - Address of the ERC20 token
 * @param provider - Ethers provider instance
 * @returns Promise resolving to the number of decimals
 */
export const getDecimals = async (
    tokenAddress: string,
    provider: ethers.Provider
): Promise<number> => {
    // Normalize address to lowercase for consistent caching
    const normalizedAddress = tokenAddress.toLowerCase();

    // Check cache first
    if (decimalsCache.has(normalizedAddress)) {
        return decimalsCache.get(normalizedAddress)!;
    }

    try {
        // Create contract instance
        const contract = new ethers.Contract(tokenAddress, ERC20_DECIMALS_ABI, provider);

        // Call decimals function
        const decimals = await contract.decimals();

        // Convert BigNumber to number and cache result
        const decimalsNumber = Number(decimals);
        decimalsCache.set(normalizedAddress, decimalsNumber);

        return decimalsNumber;
    } catch (error) {
        console.error(`Error getting decimals for token ${tokenAddress}:`, error);
        // Default to 18 decimals if failed (most common for ERC20)
        const defaultDecimals = 18;
        decimalsCache.set(normalizedAddress, defaultDecimals);
        return defaultDecimals;
    }
};

/**
 * Get decimals for multiple tokens at once
 * @param tokenAddresses - Array of token addresses
 * @param provider - Ethers provider instance
 * @returns Promise resolving to map of address -> decimals
 */
export const getMultipleDecimals = async (
    tokenAddresses: string[],
    provider: ethers.Provider
): Promise<Map<string, number>> => {
    const results = new Map<string, number>();

    // Use Promise.all for parallel execution
    const promises = tokenAddresses.map(async (address) => {
        const decimals = await getDecimals(address, provider);
        results.set(address.toLowerCase(), decimals);
    });

    await Promise.all(promises);
    return results;
};

/**
 * Format token amount with proper decimals
 * @param amount - Token amount in wei/smallest unit
 * @param tokenAddress - Address of the ERC20 token
 * @param provider - Ethers provider instance
 * @returns Promise resolving to formatted amount string
 */
export const formatTokenAmount = async (
    amount: bigint | string,
    tokenAddress: string,
    provider: ethers.Provider
): Promise<string> => {
    const decimals = await getDecimals(tokenAddress, provider);
    return ethers.formatUnits(amount, decimals);
};

/**
 * Parse token amount with proper decimals
 * @param amount - Human readable amount (e.g., "100.5")
 * @param tokenAddress - Address of the ERC20 token
 * @param provider - Ethers provider instance
 * @returns Promise resolving to parsed amount in wei/smallest unit
 */
export const parseTokenAmount = async (
    amount: string,
    tokenAddress: string,
    provider: ethers.Provider
): Promise<bigint> => {
    const decimals = await getDecimals(tokenAddress, provider);
    return ethers.parseUnits(amount, decimals);
};

/**
 * Clear decimals cache (useful for testing or if token decimals change)
 */
export const clearDecimalsCache = (): void => {
    decimalsCache.clear();
};

/**
 * Get current cache size
 */
export const getCacheSize = (): number => {
    return decimalsCache.size;
}; 