import { getAllEvents, streamEvents } from "aiia-vault-sdk/dist/utils";
import { ethers } from "ethers";
import json from "../artifacts/contracts/PreMarketTrade.sol/PreMarketTrade.json";
import { formatEvent } from "./utils/format-events";
import 'dotenv/config'
import {
    OrderMatchedEvent,
    TokenMarketCreatedEvent,
    TokenMappedEvent,
    TradeSettledEvent,
    TradeCancelledEvent,
    RawEventData
} from "../types/events";

const main = async () => {
    console.log('   ✅ Start streaming all important PreMarketTrade events')
    const getProvider = () => {
        return new ethers.JsonRpcProvider(process.env.RPC_URL);
    };

    const getContract = () => {
        return new ethers.BaseContract(
            process.env.PREMARKET_CONTRACT || "",
            json.abi,
            getProvider()
        );
    };

    const from = 27292982;

    console.log(`   ✅ From block: ${from}`)

    // Whitelist all important events
    const whitelistEvents = [
        "OrdersMatched",        // Order matching
        "TokenMarketCreated",   // Create token market
        "TokenMapped",          // Map real token
        "TradeSettled",         // Settlement
        "TradeCancelled",       // Trade cancellation
    ];

    const events = await getAllEvents(
        getContract(),
        getProvider,
        getContract,
        from,
        from + 1000,
        whitelistEvents
    )

    console.log('events', events)
    // process.exit(0)

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
                    console.log(`\n🎯 ${event.eventName} Event:`);
                    console.log(`   📦 Block: ${event.blockNumber}`);
                    console.log(`   🔗 Tx: ${event.transactionHash}`);
                    console.log(`   ⏰ Time: ${new Date(event.timestamp * 1000).toISOString()}`);

                    // Event-specific logging with proper type checking
                    switch (event.eventName) {
                        case 'OrdersMatched':
                            const orderEvent = event as OrderMatchedEvent;
                            console.log(`   💰 Trade ID: ${orderEvent.tradeId}`);
                            console.log(`   👥 Buyer: ${orderEvent.buyer}`);
                            console.log(`   👥 Seller: ${orderEvent.seller}`);
                            console.log(`   🎯 Token ID: ${orderEvent.targetTokenId}`);
                            console.log(`   📊 Filled: ${orderEvent.filledAmount}`);
                            console.log(`   💵 Price: ${orderEvent.price}`);
                            break;

                        case 'TokenMarketCreated':
                            const tokenCreatedEvent = event as TokenMarketCreatedEvent;
                            console.log(`   🏷️  Token ID: ${tokenCreatedEvent.tokenId}`);
                            console.log(`   🔤 Symbol: ${tokenCreatedEvent.symbol}`);
                            console.log(`   📝 Name: ${tokenCreatedEvent.name}`);
                            console.log(`   ⏳ Settle Time: ${tokenCreatedEvent.settleTimeLimit}s`);
                            break;

                        case 'TokenMapped':
                            const tokenMappedEvent = event as TokenMappedEvent;
                            console.log(`   🏷️  Token ID: ${tokenMappedEvent.tokenId}`);
                            console.log(`   🎯 Real Token: ${tokenMappedEvent.realMint}`);
                            console.log(`   ⏰ Mapping Time: ${new Date(tokenMappedEvent.mappingTime * 1000).toISOString()}`);
                            break;

                        case 'TradeSettled':
                            const tradeSettledEvent = event as TradeSettledEvent;
                            console.log(`   💰 Trade ID: ${tradeSettledEvent.tradeId}`);
                            console.log(`   🎯 Target Token: ${tradeSettledEvent.targetMint}`);
                            console.log(`   📊 Amount: ${tradeSettledEvent.filledAmount}`);
                            console.log(`   🎁 Seller Reward: ${tradeSettledEvent.sellerReward}`);
                            break;

                        case 'TradeCancelled':
                            const tradeCancelledEvent = event as TradeCancelledEvent;
                            console.log(`   💰 Trade ID: ${tradeCancelledEvent.tradeId}`);
                            console.log(`   👥 Buyer: ${tradeCancelledEvent.buyer}`);
                            console.log(`   👥 Seller: ${tradeCancelledEvent.seller}`);
                            console.log(`   💸 Penalty: ${tradeCancelledEvent.penaltyAmount}`);
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
