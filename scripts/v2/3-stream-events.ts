import { getAllEvents, streamEvents } from "aiia-vault-sdk/dist/utils";
import { ethers } from "ethers";
import json from "../../artifacts/contracts/PreMarketTradeV2.sol/PreMarketTradeV2.json";
import { formatEvent } from "../utils/format-events";
import 'dotenv/config'

// Interfaces for formatted V2 events
interface SettlementEvent {
    eventName: "Settlement";
    blockNumber: number;
    transactionHash: string;
    timestamp: number; // in seconds
    settlementHash: string;
    orderIds: string[];
    seller: string;
    targetToken: string;
    buyers: string[];
    amounts: bigint[];
    totalPayment: bigint;
    protocolFee: bigint;
}

interface CancellationEvent {
    eventName: "Cancellation";
    blockNumber: number;
    transactionHash: string;
    timestamp: number; // in seconds
    cancellationHash: string;
    orderIds: string[];
    buyer: string;
    collateralToken: string;
    amount: bigint;
    protocolFee: bigint;
}

interface ProtocolFeeUpdatedEvent {
    eventName: "ProtocolFeeUpdated";
    blockNumber: number;
    transactionHash: string;
    timestamp: number; // in seconds
    oldFee: bigint;
    newFee: bigint;
}

interface TreasuryUpdatedEvent {
    eventName: "TreasuryUpdated";
    blockNumber: number;
    transactionHash: string;
    timestamp: number; // in seconds
    oldTreasury: string;
    newTreasury: string;
}


const main = async () => {
    console.log('   ✅ Start streaming all important PreMarketTradeV2 events')
    const getProvider = () => {
        return new ethers.JsonRpcProvider(process.env.RPC_URL);
    };

    const getContract = () => {
        return new ethers.BaseContract(
            process.env.V2_CONTRACT || "",
            json.abi,
            getProvider()
        );
    };

    const from = Number(process.env.FROM_BLOCK) || 1;

    console.log(`   ✅ From block: ${from}`)

    // Whitelist all important events
    const whitelistEvents = [
        "Settlement",
        "Cancellation",
        "ProtocolFeeUpdated",
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
                    console.log(`\n🎯 ${event.eventName} Event (V2):`);
                    console.log(`   📦 Block: ${event.blockNumber}`);
                    console.log(`   🔗 Tx: ${event.transactionHash}`);
                    console.log(`   ⏰ Time: ${new Date(event.timestamp * 1000).toISOString()}`);

                    // Event-specific logging with proper type checking
                    switch (event.eventName) {
                        case 'Settlement':
                            const settlementEvent = event as SettlementEvent;
                            console.log(`   #️⃣ Settlement Hash: ${settlementEvent.settlementHash}`);
                            console.log(`   👥 Seller: ${settlementEvent.seller}`);
                            console.log(`   🎯 Target Token: ${settlementEvent.targetToken}`);
                            console.log(`   👥 Buyers: ${settlementEvent.buyers.join(', ')}`);
                            console.log(`   📊 Amounts: ${settlementEvent.amounts.map(a => a.toString()).join(', ')}`);
                            console.log(`   💵 Total Payment: ${settlementEvent.totalPayment.toString()}`);
                            console.log(`   💸 Protocol Fee: ${settlementEvent.protocolFee.toString()}`);
                            break;

                        case 'Cancellation':
                            const cancellationEvent = event as CancellationEvent;
                            console.log(`   #️⃣ Cancellation Hash: ${cancellationEvent.cancellationHash}`);
                            console.log(`   👥 Buyer: ${cancellationEvent.buyer}`);
                            console.log(`   🪙 Collateral Token: ${cancellationEvent.collateralToken}`);
                            console.log(`   📊 Amount: ${cancellationEvent.amount.toString()}`);
                            console.log(`   💸 Protocol Fee: ${cancellationEvent.protocolFee.toString()}`);
                            break;

                        case 'ProtocolFeeUpdated':
                            const feeUpdatedEvent = event as ProtocolFeeUpdatedEvent;
                            console.log(`   📉 Old Fee (Bps): ${feeUpdatedEvent.oldFee.toString()}`);
                            console.log(`   📈 New Fee (Bps): ${feeUpdatedEvent.newFee.toString()}`);
                            break;

                        case 'TreasuryUpdated':
                            const treasuryUpdatedEvent = event as TreasuryUpdatedEvent;
                            console.log(`   🏦 Old Treasury: ${treasuryUpdatedEvent.oldTreasury}`);
                            console.log(`   🏦 New Treasury: ${treasuryUpdatedEvent.newTreasury}`);
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
