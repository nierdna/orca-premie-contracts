import { ethers } from "ethers";

export interface OrderInfo {
    trader: string;
    collateralToken: string;
    targetTokenId: string;
    amount: string; // Wei format
    price: string; // Wei format (price per unit)
    isBuy: boolean;
    nonce: string;
    deadline: string; // Unix timestamp
}

// EIP-712 constants
const EIP712_DOMAIN_TYPEHASH = ethers.keccak256(
    ethers.toUtf8Bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
);

const PREORDER_TYPEHASH = ethers.keccak256(
    ethers.toUtf8Bytes("PreOrder(address trader,address collateralToken,bytes32 targetTokenId,uint256 amount,uint256 price,bool isBuy,uint256 nonce,uint256 deadline)")
);

/**
 * @notice Tính toán domain separator theo EIP-712
 * @param name Contract name
 * @param version Contract version
 * @param chainId Chain ID
 * @param contractAddress Contract address
 * @returns Domain separator hash
 */
export function _buildDomainSeparator(
    name: string,
    version: string,
    chainId: number,
    contractAddress: string
): string {
    return ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
            ["bytes32", "bytes32", "bytes32", "uint256", "address"],
            [
                EIP712_DOMAIN_TYPEHASH,
                ethers.keccak256(ethers.toUtf8Bytes(name)),
                ethers.keccak256(ethers.toUtf8Bytes(version)),
                chainId,
                contractAddress
            ]
        )
    );
}

/**
 * @notice Tính toán struct hash của PreOrder
 * @param order Order data
 * @returns Struct hash
 */
export function _getOrderStructHash(order: OrderInfo): string {
    return ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
            ["bytes32", "address", "address", "bytes32", "uint256", "uint256", "bool", "uint256", "uint256"],
            [
                PREORDER_TYPEHASH,
                order.trader,
                order.collateralToken,
                order.targetTokenId,
                order.amount,
                order.price,
                order.isBuy,
                order.nonce,
                order.deadline
            ]
        )
    );
}

/**
 * @notice Tính toán final hash theo EIP-712 (tương tự _hashTypedDataV4 trong OpenZeppelin)
 * @param domainSeparator Domain separator
 * @param structHash Struct hash
 * @returns Final EIP-712 hash
 */
export function _hashTypedDataV4(domainSeparator: string, structHash: string): string {
    return ethers.keccak256(
        ethers.concat([
            ethers.toUtf8Bytes("\x19\x01"), // EIP-712 prefix
            domainSeparator,
            structHash
        ])
    );
}

/**
 * @notice Tính toán complete order hash để verify signature
 * @param order Order data
 * @param contractAddress Contract address
 * @param chainId Chain ID
 * @returns Complete order hash
 */
export function calculateOrderHash(
    order: OrderInfo,
    contractAddress: string,
    chainId: number
): string {
    const domainSeparator = _buildDomainSeparator(
        "PreMarketTrade",
        "1",
        chainId,
        contractAddress
    );

    const structHash = _getOrderStructHash(order);

    return _hashTypedDataV4(domainSeparator, structHash);
}

/**
 * @notice Verify signature của order
 * @param order Order data
 * @param signature Signature to verify
 * @param contractAddress Contract address
 * @param chainId Chain ID
 * @returns True if signature is valid
 */
function verifyOrderSignature(
    order: OrderInfo,
    signature: string,
    contractAddress: string,
    chainId: number
): string {
    const orderHash = calculateOrderHash(order, contractAddress, chainId);
    return ethers.recoverAddress(orderHash, signature);
}