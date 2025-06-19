import { ethers } from "ethers";
import json from "../artifacts/contracts/PreMarketTrade.sol/PreMarketTrade.json";
import { formatEvent } from "./utils/format-events";
import { OrderMatchedEvent, RawEventData } from "../types/events";
import 'dotenv/config';

/**
 * Parse transaction by hash and extract events
 * @param txHash - Transaction hash to parse
 * @returns Array of parsed events
 */
async function parseTransactionEvents(txHash: string): Promise<OrderMatchedEvent[]> {
    console.log(`🔍 Parsing transaction: ${txHash}`);

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

    const provider = getProvider();
    const contract = getContract();
    const parsedEvents: OrderMatchedEvent[] = [];

    try {
        // Get transaction receipt
        console.log('📄 Getting transaction receipt...');
        const receipt = await provider.getTransactionReceipt(txHash);

        if (!receipt) {
            throw new Error('Transaction receipt not found');
        }

        console.log(`✅ Receipt found - Block: ${receipt.blockNumber}, Status: ${receipt.status}`);

        if (receipt.status === 0) {
            throw new Error('Transaction failed');
        }

        // Get block timestamp
        console.log('⏰ Getting block timestamp...');
        const block = await provider.getBlock(receipt.blockNumber);
        if (!block) {
            throw new Error('Block not found');
        }

        // Filter and parse contract events from logs
        console.log('🔎 Parsing contract events...');
        let eventCount = 0;

        for (const log of receipt.logs) {
            try {
                // Check if log is from our contract
                if (log.address.toLowerCase() !== (process.env.PREMARKET_CONTRACT || "").toLowerCase()) {
                    continue;
                }

                // Parse the log using contract interface
                const parsedLog = contract.interface.parseLog({
                    topics: log.topics,
                    data: log.data
                });

                if (!parsedLog) {
                    continue;
                }

                console.log(`📝 Found event: ${parsedLog.name}`);
                eventCount++;

                // Only process OrdersMatched events for now
                if (parsedLog.name === 'OrdersMatched') {
                    // Create raw event data structure
                    const rawEventData: RawEventData = {
                        eventName: parsedLog.name,
                        blockNumber: receipt.blockNumber,
                        transactionHash: receipt.hash,
                        timestamp: block.timestamp,
                        sender: receipt.from,
                        args: {
                            // Map parsed args to expected format
                            tradeId: parsedLog.args.tradeId?.toString() || '',
                            buyOrderHash: parsedLog.args.buyOrderHash || '',
                            sellOrderHash: parsedLog.args.sellOrderHash || '',
                            buyer: parsedLog.args.buyer || '',
                            seller: parsedLog.args.seller || '',
                            targetTokenId: parsedLog.args.targetTokenId || '',
                            amount: parsedLog.args.amount?.toString() || '0',
                            price: parsedLog.args.price?.toString() || '0',
                            collateralToken: parsedLog.args.collateralToken || '',
                            filledAmount: parsedLog.args.filledAmount?.toString() || '0',
                            buyerTotalFilled: parsedLog.args.buyerTotalFilled?.toString() || '0',
                            sellerTotalFilled: parsedLog.args.sellerTotalFilled?.toString() || '0',
                            buyerCollateral: parsedLog.args.buyerCollateral?.toString() || '0',
                            sellerCollateral: parsedLog.args.sellerCollateral?.toString() || '0'
                        }
                    };

                    // Format event (if formatEvent function exists)
                    let formattedEvent = rawEventData;
                    try {
                        formattedEvent = await formatEvent(rawEventData, getProvider);
                    } catch (error) {
                        console.warn(`⚠️  Could not format event, using raw data: ${error}`);
                    }

                    // Create OrderMatchedEvent instance
                    const orderEvent = new OrderMatchedEvent(formattedEvent as RawEventData);
                    parsedEvents.push(orderEvent);

                    console.log(`✅ Parsed OrdersMatched event: ${orderEvent.toString()}`);
                }
            } catch (error) {
                console.warn(`⚠️  Could not parse log: ${error instanceof Error ? error.message : error}`);
            }
        }

        console.log(`📊 Summary: Found ${eventCount} total events, ${parsedEvents.length} OrdersMatched events`);
        return parsedEvents;

    } catch (error) {
        console.error(`❌ Error parsing transaction: ${error instanceof Error ? error.message : error}`);
        throw error;
    }
}

/**
 * Parse multiple transactions
 * @param txHashes - Array of transaction hashes
 * @returns Array of all parsed events
 */
async function parseMultipleTransactions(txHashes: string[]): Promise<OrderMatchedEvent[]> {
    console.log(`🔍 Parsing ${txHashes.length} transactions...`);

    const allEvents: OrderMatchedEvent[] = [];
    const errors: string[] = [];

    for (let i = 0; i < txHashes.length; i++) {
        const txHash = txHashes[i];
        console.log(`\n[${i + 1}/${txHashes.length}] Processing: ${txHash}`);

        try {
            const events = await parseTransactionEvents(txHash);
            allEvents.push(...events);
            console.log(`✅ Successfully parsed ${events.length} events from tx ${i + 1}`);
        } catch (error) {
            const errorMsg = `Transaction ${i + 1} (${txHash}): ${error instanceof Error ? error.message : error}`;
            errors.push(errorMsg);
            console.error(`❌ ${errorMsg}`);
        }
    }

    console.log(`\n📈 Batch Results:`);
    console.log(`- Total Transactions: ${txHashes.length}`);
    console.log(`- Successfully Parsed: ${txHashes.length - errors.length}`);
    console.log(`- Failed: ${errors.length}`);
    console.log(`- Total Events: ${allEvents.length}`);

    if (errors.length > 0) {
        console.log(`\n❌ Errors:`);
        errors.forEach(error => console.log(`  - ${error}`));
    }

    return allEvents;
}

/**
 * Get transaction events by hash with detailed information
 * @param txHash - Transaction hash
 * @returns Detailed transaction information with events
 */
async function getTransactionDetails(txHash: string) {
    console.log(`🔍 Getting detailed transaction info: ${txHash}`);

    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

    try {
        const receipt = await provider.getTransactionReceipt(txHash);

        if (!receipt) {
            throw new Error('Transaction or receipt not found');
        }

        const events = await parseTransactionEvents(txHash);

        return events;
    } catch (error) {
        console.error(`❌ Error getting transaction details: ${error}`);
        throw error;
    }
}

// Main execution function
const main = async () => {
    const details = await getTransactionDetails("0x76cb9bb167de4e3a05aea2098c4a8459700eecfca7ddf459b98f0955c32e5812");
    console.log('✅ details', details)
};

// Export functions for use in other scripts
export { parseTransactionEvents, parseMultipleTransactions, getTransactionDetails };

// Run if called directly
if (require.main === module) {
    main()
        .then(() => {
            console.log('\n✅ Script completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Script failed:', error);
            process.exit(1);
        });
} 