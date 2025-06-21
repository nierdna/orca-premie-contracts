import { getAllEvents, streamEvents } from "aiia-vault-sdk/dist/utils";
import { ethers } from "ethers";
import json from "../../artifacts/contracts/EscrowVault.sol/EscrowVault.json";
import { formatEvent } from "../utils/format-events";
import 'dotenv/config'
import { formatTokenAmount } from "../../utils/erc20-utils";

// Interfaces for formatted EscrowVault events
interface DepositedEvent {
    eventName: "Deposited";
    blockNumber: number;
    transactionHash: string;
    timestamp: number; // in seconds
    user: string;
    token: string;
    amount: bigint;
    newBalance: bigint;
}

interface WithdrawnEvent {
    eventName: "Withdrawn";
    blockNumber: number;
    transactionHash: string;
    timestamp: number; // in seconds
    user: string;
    token: string;
    amount: bigint;
    newBalance: bigint;
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
    newBalance: bigint;
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
    newBalance: bigint;
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
                            const formattedDepositAmount = formatTokenAmount(depositedEvent.amount, depositedEvent.token, getProvider());
                            const formattedDepositBalance = formatTokenAmount(depositedEvent.newBalance, depositedEvent.token, getProvider());

                            console.log(`   👤 User: ${depositedEvent.user}`);
                            console.log(`   🪙 Token: ${depositedEvent.token}`);
                            console.log(`   💰 Amount: ${formattedDepositAmount}`);
                            console.log(`   🏦 New Balance: ${formattedDepositBalance}`);
                            console.log(`   📈 Action: User deposited tokens into vault`);
                            break;

                        case 'Withdrawn':
                            const withdrawnEvent = event as WithdrawnEvent;
                            const formattedWithdrawAmount = formatTokenAmount(withdrawnEvent.amount, withdrawnEvent.token, getProvider());
                            const formattedWithdrawBalance = formatTokenAmount(withdrawnEvent.newBalance, withdrawnEvent.token, getProvider());

                            console.log(`   👤 User: ${withdrawnEvent.user}`);
                            console.log(`   🪙 Token: ${withdrawnEvent.token}`);
                            console.log(`   💰 Amount: ${formattedWithdrawAmount}`);
                            console.log(`   🏦 New Balance: ${formattedWithdrawBalance}`);
                            console.log(`   📉 Action: User withdrew tokens from vault`);
                            break;

                        case 'BalanceSlashed':
                            const slashedEvent = event as BalanceSlashedEvent;
                            const formattedSlashAmount = formatTokenAmount(slashedEvent.amount, slashedEvent.token, getProvider());
                            const formattedSlashBalance = formatTokenAmount(slashedEvent.newBalance, slashedEvent.token, getProvider());

                            console.log(`   👤 User: ${slashedEvent.user}`);
                            console.log(`   🪙 Token: ${slashedEvent.token}`);
                            console.log(`   💰 Amount: ${formattedSlashAmount}`);
                            console.log(`   🏦 New Balance: ${formattedSlashBalance}`);
                            console.log(`   🤖 Operator: ${slashedEvent.operator}`);
                            console.log(`   ⚡ Action: Balance slashed by trading contract`);
                            break;

                        case 'BalanceCredited':
                            const creditedEvent = event as BalanceCreditedEvent;
                            const formattedCreditAmount = formatTokenAmount(creditedEvent.amount, creditedEvent.token, getProvider());
                            const formattedCreditBalance = formatTokenAmount(creditedEvent.newBalance, creditedEvent.token, getProvider());

                            console.log(`   👤 User: ${creditedEvent.user}`);
                            console.log(`   🪙 Token: ${creditedEvent.token}`);
                            console.log(`   💰 Amount: ${formattedCreditAmount}`);
                            console.log(`   🏦 New Balance: ${formattedCreditBalance}`);
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
