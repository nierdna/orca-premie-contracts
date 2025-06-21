import { getAllEvents, streamEvents } from "aiia-vault-sdk/dist/utils";
import { ethers } from "ethers";
import json from "../../artifacts/contracts/EscrowVault.sol/EscrowVault.json";
import { formatEvent } from "../utils/format-events";
import 'dotenv/config'

// Cache for token decimals to avoid repeated calls
const tokenDecimalsCache = new Map<string, number>();

/**
 * @notice Get token decimals with caching
 * @param tokenAddress Token contract address
 * @param provider Ethereum provider
 * @returns Token decimals (default 18 if not available)
 */
async function getTokenDecimals(tokenAddress: string, provider: ethers.JsonRpcProvider): Promise<number> {
    if (tokenDecimalsCache.has(tokenAddress)) {
        return tokenDecimalsCache.get(tokenAddress)!;
    }

    try {
        // Standard ERC20 decimals() function ABI
        const decimalsAbi = ["function decimals() view returns (uint8)"];
        const tokenContract = new ethers.Contract(tokenAddress, decimalsAbi, provider);
        const decimals = await tokenContract.decimals();
        tokenDecimalsCache.set(tokenAddress, Number(decimals));
        return Number(decimals);
    } catch (error) {
        console.warn(`⚠️  Could not get decimals for token ${tokenAddress}, using default 18`);
        tokenDecimalsCache.set(tokenAddress, 18);
        return 18;
    }
}

/**
 * @notice Format token amount with proper decimals
 * @param amount Raw token amount (BigInt)
 * @param decimals Token decimals
 * @returns Formatted amount string
 */
function formatTokenAmount(amount: bigint, decimals: number): string {
    const divisor = BigInt(10 ** decimals);
    const wholePart = amount / divisor;
    const fractionalPart = amount % divisor;

    if (fractionalPart === 0n) {
        return wholePart.toString();
    }

    // Convert fractional part to string with leading zeros
    const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
    // Remove trailing zeros
    const trimmedFractional = fractionalStr.replace(/0+$/, '');

    if (trimmedFractional === '') {
        return wholePart.toString();
    }

    return `${wholePart}.${trimmedFractional}`;
}

/**
 * @notice Get token symbol with caching
 * @param tokenAddress Token contract address  
 * @param provider Ethereum provider
 * @returns Token symbol (default "TOKEN" if not available)
 */
async function getTokenSymbol(tokenAddress: string, provider: ethers.JsonRpcProvider): Promise<string> {
    try {
        const symbolAbi = ["function symbol() view returns (string)"];
        const tokenContract = new ethers.Contract(tokenAddress, symbolAbi, provider);
        const symbol = await tokenContract.symbol();
        return symbol;
    } catch (error) {
        return "TOKEN";
    }
}

// Interfaces for formatted EscrowVault events
interface DepositedEvent {
    eventName: "Deposited";
    blockNumber: number;
    transactionHash: string;
    timestamp: number; // in seconds
    user: string;
    token: string;
    amount: bigint;
}

interface WithdrawnEvent {
    eventName: "Withdrawn";
    blockNumber: number;
    transactionHash: string;
    timestamp: number; // in seconds
    user: string;
    token: string;
    amount: bigint;
}

interface BalanceSlashedEvent {
    eventName: "BalanceSlashed";
    blockNumber: number;
    transactionHash: string;
    timestamp: number; // in seconds
    user: string;
    token: string;
    amount: bigint;
    operator: string;
}

interface BalanceCreditedEvent {
    eventName: "BalanceCredited";
    blockNumber: number;
    transactionHash: string;
    timestamp: number; // in seconds
    user: string;
    token: string;
    amount: bigint;
    operator: string;
}

const main = async () => {
    console.log('   ✅ Start streaming all important EscrowVault events')
    const getProvider = () => {
        return new ethers.JsonRpcProvider(process.env.RPC_URL);
    };

    const getContract = () => {
        return new ethers.BaseContract(
            process.env.ESCROW_VAULT_CONTRACT || "",
            json.abi,
            getProvider()
        );
    };

    const from = Number(process.env.FROM_BLOCK) || 1;

    console.log(`   ✅ From block: ${from}`)

    // Whitelist all important events
    const whitelistEvents = [
        "Deposited",
        "Withdrawn",
        "BalanceSlashed",
        "BalanceCredited"
    ];

    await streamEvents(
        {
            getProvider: getProvider,
            getAllEvents: async (fromBlock, toBlock, whitelistEvents) => {
                const events = await getAllEvents(
                    getContract(),
                    getProvider,
                    getContract,
                    fromBlock,
                    toBlock,
                    whitelistEvents
                )
                return events
            },
            formatEvent: async (event) => {
                return await formatEvent(event, getProvider);
            },
            onEvent: async (event: any) => {
                // Enhanced logging for different event types
                if (event.eventName) {
                    console.log(`\n🏦 ${event.eventName} Event (EscrowVault):`);
                    console.log(`   📦 Block: ${event.blockNumber}`);
                    console.log(`   🔗 Tx: ${event.transactionHash}`);
                    console.log(`   ⏰ Time: ${new Date(event.timestamp * 1000).toISOString()}`);

                    // Event-specific logging with proper type checking
                    switch (event.eventName) {
                        case 'Deposited':
                            const depositedEvent = event as DepositedEvent;
                            const depositDecimals = await getTokenDecimals(depositedEvent.token, getProvider());
                            const depositSymbol = await getTokenSymbol(depositedEvent.token, getProvider());
                            const formattedDepositAmount = formatTokenAmount(depositedEvent.amount, depositDecimals);

                            console.log(`   👤 User: ${depositedEvent.user}`);
                            console.log(`   🪙 Token: ${depositedEvent.token}`);
                            console.log(`   💰 Amount: ${formattedDepositAmount} ${depositSymbol}`);
                            console.log(`   📈 Action: User deposited tokens into vault`);
                            break;

                        case 'Withdrawn':
                            const withdrawnEvent = event as WithdrawnEvent;
                            const withdrawDecimals = await getTokenDecimals(withdrawnEvent.token, getProvider());
                            const withdrawSymbol = await getTokenSymbol(withdrawnEvent.token, getProvider());
                            const formattedWithdrawAmount = formatTokenAmount(withdrawnEvent.amount, withdrawDecimals);

                            console.log(`   👤 User: ${withdrawnEvent.user}`);
                            console.log(`   🪙 Token: ${withdrawnEvent.token}`);
                            console.log(`   💰 Amount: ${formattedWithdrawAmount} ${withdrawSymbol}`);
                            console.log(`   📉 Action: User withdrew tokens from vault`);
                            break;

                        case 'BalanceSlashed':
                            const slashedEvent = event as BalanceSlashedEvent;
                            const slashDecimals = await getTokenDecimals(slashedEvent.token, getProvider());
                            const slashSymbol = await getTokenSymbol(slashedEvent.token, getProvider());
                            const formattedSlashAmount = formatTokenAmount(slashedEvent.amount, slashDecimals);

                            console.log(`   👤 User: ${slashedEvent.user}`);
                            console.log(`   🪙 Token: ${slashedEvent.token}`);
                            console.log(`   💰 Amount: ${formattedSlashAmount} ${slashSymbol}`);
                            console.log(`   🤖 Operator: ${slashedEvent.operator}`);
                            console.log(`   ⚡ Action: Balance slashed by trading contract`);
                            break;

                        case 'BalanceCredited':
                            const creditedEvent = event as BalanceCreditedEvent;
                            const creditDecimals = await getTokenDecimals(creditedEvent.token, getProvider());
                            const creditSymbol = await getTokenSymbol(creditedEvent.token, getProvider());
                            const formattedCreditAmount = formatTokenAmount(creditedEvent.amount, creditDecimals);

                            console.log(`   👤 User: ${creditedEvent.user}`);
                            console.log(`   🪙 Token: ${creditedEvent.token}`);
                            console.log(`   💰 Amount: ${formattedCreditAmount} ${creditSymbol}`);
                            console.log(`   🤖 Operator: ${creditedEvent.operator}`);
                            console.log(`   🎁 Action: Balance credited by trading contract`);
                            break;

                        default:
                            console.log(`   📄 Event Data:`, event);
                    }
                } else {
                    console.log('✅ Raw event:', event);
                }
            },
            saveLatestBlock: async (blockNumber) => {
                console.log(`💾 Saved latest block: ${blockNumber}`);
            },
            fromBlock: from,
            blockGap: 1,
            whitelistEvents: whitelistEvents,
            shouldContinue: async () => {
                return true
            }
        }
    );
};

if (require.main === module) {
    main()
        .then(() => {
            console.log('\n✅ Event streaming completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.trace('\n❌ Event streaming failed:', error);
            process.exit(1);
        });
}
