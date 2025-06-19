import { ethers } from "ethers";
import { normalizeAndConvert } from "../../utils/address-utils";
import { formatTokenAmount } from "../../utils/erc20-utils";

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
            console.error("Error formatting event amount:", error);
        }
    }

    event.args = { ...event.args, ...processedArgs };

    return event;
};