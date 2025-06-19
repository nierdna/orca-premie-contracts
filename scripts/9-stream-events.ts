import { getAllEvents, streamEvents } from "aiia-vault-sdk/dist/utils";
import { ethers } from "ethers";
import json from "../artifacts/contracts/PreMarketTrade.sol/PreMarketTrade.json";
import { formatEvent } from "./utils/format-events";

const main = async () => {
    console.log('   ✅ Start stream events')
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

    const from = 27270140;

    console.log(`   ✅ From block: ${from}`)
    const whitelistEvents = ["OrdersMatched"];

    await streamEvents(
        {
            getProvider: getProvider,
            getAllEvents: async (fromBlock, toBlock,) => {
                return await getAllEvents(
                    getContract(),
                    getProvider,
                    getContract,
                    fromBlock,
                    toBlock,
                )
            },
            formatEvent: async (event) => {
                return await formatEvent(event, getProvider)
            },
            onEvent: async (event) => {
                console.log('✅ event', event)
            },
            saveLatestBlock: async (blockNumber) => {
                console.log('✅ latest block', blockNumber)
            },
            fromBlock: from,
            blockGap: 1000,
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
            process.exit(0);
        })
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}
