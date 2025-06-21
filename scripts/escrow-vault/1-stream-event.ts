import { getAllEvents, streamEvents } from "aiia-vault-sdk/dist/utils";
import { ethers } from "ethers";
import json from "../../artifacts/contracts/EscrowVault.sol/EscrowVault.json";
import { formatEvent } from "../utils/format-events";
import 'dotenv/config'
import { formatTokenAmount } from "../../utils/erc20-utils";

// Interfaces for formatted EscrowVault events

interface EvmEvent<T> {
    eventName: string;
    blockNumber: number;
    transactionHash: string;
    timestamp: number; // in seconds
    sender: any;
    args: T;
}

interface DepositedEvent {
    user: string;
    token: string;
    amount: bigint;
    newBalance: bigint;
}

interface WithdrawnEvent {
    user: string;
    token: string;
    amount: bigint;
    newBalance: bigint;
}

interface BalanceSlashedEvent {
    user: string;
    token: string;
    amount: bigint;
    operator: string;
    newBalance: bigint;
}

interface BalanceCreditedEvent {
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
            process.env.ESCROW_VAULT_ADDRESS || "",
            json.abi,
            getProvider()
        );
    };

    const from = 27371315;

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
                            const depositedEvent = event as EvmEvent<DepositedEvent>;
                            console.log("Deposited event:", depositedEvent);
                            const formattedDepositAmount = await formatTokenAmount(depositedEvent.args.amount, depositedEvent.args.token, getProvider());
                            const formattedDepositBalance = await formatTokenAmount(depositedEvent.args.newBalance, depositedEvent.args.token, getProvider());

                            console.log(`   👤 User: ${depositedEvent.args.user}`);
                            console.log(`   🪙 Token: ${depositedEvent.args.token}`);
                            console.log(`   💰 Amount: ${formattedDepositAmount}`);
                            console.log(`   🏦 New Balance: ${formattedDepositBalance}`);
                            console.log(`   📈 Action: User deposited tokens into vault`);
                            break;

                        case 'Withdrawn':
                            const withdrawnEvent = event as EvmEvent<WithdrawnEvent>;
                            const formattedWithdrawAmount = await formatTokenAmount(withdrawnEvent.args.amount, withdrawnEvent.args.token, getProvider());
                            const formattedWithdrawBalance = await formatTokenAmount(withdrawnEvent.args.newBalance, withdrawnEvent.args.token, getProvider());

                            console.log(`   👤 User: ${withdrawnEvent.args.user}`);
                            console.log(`   🪙 Token: ${withdrawnEvent.args.token}`);
                            console.log(`   💰 Amount: ${formattedWithdrawAmount}`);
                            console.log(`   🏦 New Balance: ${formattedWithdrawBalance}`);
                            console.log(`   📉 Action: User withdrew tokens from vault`);
                            break;

                        case 'BalanceSlashed':
                            const slashedEvent = event as EvmEvent<BalanceSlashedEvent>;
                            const formattedSlashAmount = await formatTokenAmount(slashedEvent.args.amount, slashedEvent.args.token, getProvider());
                            const formattedSlashBalance = await formatTokenAmount(slashedEvent.args.newBalance, slashedEvent.args.token, getProvider());
                            console.log(`   🪙 Token: ${slashedEvent.args.token}`);
                            console.log(`   💰 Amount: ${formattedSlashAmount}`);
                            console.log(`   🏦 New Balance: ${formattedSlashBalance}`);
                            console.log(`   🤖 Operator: ${slashedEvent.args.operator}`);
                            console.log(`   ⚡ Action: Balance slashed by trading contract`);
                            break;

                        case 'BalanceCredited':
                            const creditedEvent = event as EvmEvent<BalanceCreditedEvent>;
                            const formattedCreditAmount = await formatTokenAmount(creditedEvent.args.amount, creditedEvent.args.token, getProvider());
                            const formattedCreditBalance = await formatTokenAmount(creditedEvent.args.newBalance, creditedEvent.args.token, getProvider());

                            console.log(`   👤 User: ${creditedEvent.args.user}`);
                            console.log(`   🪙 Token: ${creditedEvent.args.token}`);
                            console.log(`   💰 Amount: ${formattedCreditAmount}`);
                            console.log(`   🏦 New Balance: ${formattedCreditBalance}`);
                            console.log(`   🤖 Operator: ${creditedEvent.args.operator}`);
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
