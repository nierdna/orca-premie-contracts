import { ethers } from "ethers";
import { normalizeAndConvert } from "../../utils/address-utils";
import { formatTokenAmount } from "../../utils/erc20-utils";
import {
    OrderMatchedEvent,
    TokenMarketCreatedEvent,
    TokenMappedEvent,
    TradeSettledEvent,
    TradeCancelledEvent,
    RawEventData
} from "../../types/events";

export const formatEvent = async (event: any, getProvider: () => ethers.JsonRpcProvider) => {
    const processedArgs = normalizeAndConvert(event.args, {
        preserveOnOverflow: true,
        warningOnOverflow: false,
    });

    if (
        processedArgs.collateralToken &&
        processedArgs.amount &&
        event.eventName === "OrdersMatched"
    ) {
        try {
            const amountStr =
                typeof processedArgs.amount === "number"
                    ? processedArgs.amount.toString()
                    : (processedArgs.amount as string);

            const formattedAmount = await formatTokenAmount(
                amountStr,
                processedArgs.collateralToken as string,
                getProvider()
            );

            processedArgs.buyerTotalFilled = await formatTokenAmount(
                processedArgs.buyerTotalFilled,
                processedArgs.collateralToken as string,
                getProvider()
            );

            processedArgs.sellerTotalFilled = await formatTokenAmount(
                processedArgs.sellerTotalFilled,
                processedArgs.collateralToken as string,
                getProvider()
            );

            processedArgs.buyerCollateral = await formatTokenAmount(
                processedArgs.buyerCollateral,
                processedArgs.collateralToken as string,
                getProvider()
            );

            processedArgs.sellerCollateral = await formatTokenAmount(
                processedArgs.sellerCollateral,
                processedArgs.collateralToken as string,
                getProvider()
            );

            processedArgs.filledAmount = await formatTokenAmount(
                processedArgs.filledAmount,
                processedArgs.collateralToken as string,
                getProvider()
            );

            processedArgs.amount = formattedAmount;

            processedArgs.price = ethers.formatUnits(processedArgs.price, 6);

            processedArgs.tradeId = processedArgs.tradeId.toString();
        } catch (error) {
            console.error("Error formatting OrdersMatched event:", error);
        }
    }

    if (event.eventName === "TradeSettled" || event.eventName === "TradeCancelled") {
        try {
            if (processedArgs.tradeId) {
                processedArgs.tradeId = processedArgs.tradeId.toString();
            }

            if (processedArgs.sellerReward) {
                processedArgs.sellerReward = await formatTokenAmount(processedArgs.sellerReward, processedArgs.targetToken as string, getProvider());
            }
            if (processedArgs.penaltyAmount) {
                processedArgs.penaltyAmount = await formatTokenAmount(processedArgs.penaltyAmount, processedArgs.collateralToken as string, getProvider());
            }
        } catch (error) {
            console.error(`Error formatting ${event.eventName} event:`, error);
        }
    }

    if (event.eventName === "TokenMarketCreated") {
        try {
            if (processedArgs.settleTimeLimit) {
                processedArgs.settleTimeLimit = Number(processedArgs.settleTimeLimit);
            }
            if (processedArgs.createdAt) {
                processedArgs.createdAt = Number(processedArgs.createdAt);
            }
        } catch (error) {
            console.error("Error formatting TokenMarketCreated event:", error);
        }
    }

    if (event.eventName === "TokenMapped") {
        try {
            if (processedArgs.mappingTime) {
                processedArgs.mappingTime = Number(processedArgs.mappingTime);
            }
        } catch (error) {
            console.error("Error formatting TokenMapped event:", error);
        }
    }

    event.args = { ...event.args, ...processedArgs };

    const rawData = event as RawEventData;

    try {
        switch (rawData.eventName) {
            case 'OrdersMatched':
                return new OrderMatchedEvent(rawData);

            case 'TokenMarketCreated':
                return new TokenMarketCreatedEvent(rawData);

            case 'TokenMapped':
                return new TokenMappedEvent(rawData);

            case 'TradeSettled':
                return new TradeSettledEvent(rawData);

            case 'TradeCancelled':
                return new TradeCancelledEvent(rawData);

            default:
                console.warn(`⚠️  Unknown event type: ${rawData.eventName}`);
                return rawData;
        }
    } catch (error) {
        console.error(`Error creating typed event for ${rawData.eventName}:`, error);
        return rawData;
    }
};