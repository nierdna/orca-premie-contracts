// Event interfaces and types for PreMarketTrade contract

/**
 * Interface cho raw event data từ blockchain (Ethereum format)
 */
export interface RawEventData {
    eventName: string;
    blockNumber: number;
    transactionHash: string;
    args: Record<string, any>;
    timestamp: number;
    sender: string;
}

/**
 * Interface cho Solana-style event data
 */
export interface SolanaEventData {
    data: Record<string, any>;
    name: string;
    signature: string;
    slot: number;
    blockTime: number;
    txHash: string;
    collateralDecimals?: number;
}

/**
 * Union type cho tất cả event formats
 */
export type EventInput = RawEventData | SolanaEventData;

/**
 * Interface cho OrdersMatched event arguments (Ethereum format)
 */
export interface OrdersMatchedArgs {
    tradeId: string;
    buyOrderHash: string;
    sellOrderHash: string;
    buyer: string;
    seller: string;
    targetTokenId: string;
    amount: string;
    price: string;
    collateralToken: string;
    filledAmount: string;
    buyerTotalFilled: string;
    sellerTotalFilled: string;
    buyerCollateral: string;
    sellerCollateral: string;
}

/**
 * Interface cho OrdersMatched event arguments (Solana format)
 */
export interface SolanaOrdersMatchedArgs {
    tradeId: string;
    buyer: string;
    seller: string;
    tokenId: string;
    collateralMint: string;
    filledAmount: number;
    price: number;
    buyerCollateral: number;
    sellerCollateral: number;
    matchTime: number;
    buyOrderHash: string;
    sellOrderHash: string;
}

/**
 * Interface cho TokenMarketCreated event arguments (Solana format)
 */
export interface SolanaTokenMarketCreatedArgs {
    tokenId: string;
    symbol: string;
    name: string;
    settleTimeLimit: number;
    createdAt: number;
}

/**
 * Interface cho TokenMapped event arguments (Solana format)
 */
export interface SolanaTokenMappedArgs {
    tokenId: string;
    realMint: string;
    mappingTime: number;
}

/**
 * Interface cho TradeSettled event arguments (Solana format)
 */
export interface SolanaTradeSettledArgs {
    tradeId: string;
    tokenId: string;
    buyer: string;
    seller: string;
    targetMint: string;
    filledAmount: number;
    sellerReward: number;
    settlementTime: number;
}

/**
 * Interface cho OrderCancelled event arguments (Solana format)
 */
export interface SolanaOrderCancelledArgs {
    orderHash: number[];
    trader: string;
    tokenId: string;
    collateralReleased: number;
    cancellationTime: number;
}

/**
 * Interface cho TradeCancelled event arguments (Solana format)
 */
export interface SolanaTradeCancelledArgs {
    tradeId: string;
    tokenId: string;
    buyer: string;
    seller: string;
    penaltyAmount: number;
    cancellationTime: number;
}

/**
 * Interface cho OrderPartiallyFilled event arguments
 */
export interface OrderPartiallyFilledArgs {
    orderHash: string;
    trader: string;
    filledAmount: number;
    remainingAmount: number;
}

/**
 * Interface chuẩn cho tất cả blockchain events
 */
export interface IBlockchainEvent {
    eventName: string;
    blockNumber: number;
    transactionHash: string;
    timestamp: number;
    sender: string;

    // Methods
    toJSON(): object;
    toString(): string;
    isValid(): boolean;
}

/**
 * Class cho OrdersMatched event với đầy đủ type safety và validation
 * Support cả Ethereum và Solana formats
 */
export class OrderMatchedEvent implements IBlockchainEvent {
    public readonly eventName: string = 'OrdersMatched';
    public readonly blockNumber: number;
    public readonly transactionHash: string;
    public readonly timestamp: number;
    public readonly sender: string;
    public readonly collateralDecimals?: number;

    // Event-specific properties (normalized)
    public readonly tradeId: string;
    public readonly buyOrderHash: string;
    public readonly sellOrderHash: string;
    public readonly buyer: string;
    public readonly seller: string;
    public readonly targetTokenId: string;
    public readonly amount: string;
    public readonly price: string;
    public readonly collateralToken: string;
    public readonly filledAmount: string;
    public readonly buyerTotalFilled: string;
    public readonly sellerTotalFilled: string;
    public readonly buyerCollateral: string;
    public readonly sellerCollateral: string;

    constructor(data: EventInput) {
        // Detect format and normalize
        const normalized = this.normalizeEventData(data);

        // Validate event name
        if (normalized.eventName !== 'OrdersMatched') {
            throw new Error(`Invalid event name: expected 'OrdersMatched', got '${normalized.eventName}'`);
        }

        // Assign base properties
        this.blockNumber = normalized.blockNumber;
        this.transactionHash = normalized.transactionHash;
        this.timestamp = normalized.timestamp;
        this.sender = normalized.sender;
        this.collateralDecimals = normalized.collateralDecimals;

        // Assign event-specific properties with validation
        const args = normalized.args;

        this.tradeId = this.validateStringField(args.tradeId, 'tradeId');
        this.buyOrderHash = args.buyOrderHash;
        this.sellOrderHash = args.sellOrderHash;
        this.buyer = this.validateAddressOrBase58(args.buyer, 'buyer');
        this.seller = this.validateAddressOrBase58(args.seller, 'seller');
        this.targetTokenId = this.validateHashOrBase58(args.targetTokenId, 'targetTokenId');
        this.amount = this.validateAmount(args.amount, 'amount');
        this.price = this.validateAmount(args.price, 'price');
        this.collateralToken = this.validateAddressOrBase58(args.collateralToken, 'collateralToken');
        this.filledAmount = this.validateAmount(args.filledAmount, 'filledAmount');
        this.buyerTotalFilled = this.validateAmount(args.buyerTotalFilled, 'buyerTotalFilled');
        this.sellerTotalFilled = this.validateAmount(args.sellerTotalFilled, 'sellerTotalFilled');
        this.buyerCollateral = this.validateAmount(args.buyerCollateral, 'buyerCollateral');
        this.sellerCollateral = this.validateAmount(args.sellerCollateral, 'sellerCollateral');
    }

    /**
     * Normalize different event formats to unified structure
     */
    private normalizeEventData(data: EventInput): RawEventData & { collateralDecimals?: number } {
        // Check if it's Solana format
        if ('data' in data && 'name' in data && 'slot' in data) {
            const solanaData = data as SolanaEventData;
            const solanaArgs = solanaData.data as SolanaOrdersMatchedArgs;

            return {
                eventName: solanaData.name,
                blockNumber: solanaData.slot,
                transactionHash: solanaData.txHash,
                timestamp: solanaData.blockTime,
                sender: solanaData.signature, // Use signature as sender for Solana
                collateralDecimals: solanaData.collateralDecimals,
                args: {
                    tradeId: solanaArgs.tradeId,
                    buyOrderHash: solanaArgs.buyOrderHash,
                    sellOrderHash: solanaArgs.sellOrderHash,
                    buyer: solanaArgs.buyer,
                    seller: solanaArgs.seller,
                    targetTokenId: solanaArgs.tokenId,
                    amount: solanaArgs.filledAmount.toString(), // Convert to string for consistency
                    price: solanaArgs.price.toString(),
                    collateralToken: solanaArgs.collateralMint,
                    filledAmount: solanaArgs.filledAmount.toString(),
                    buyerTotalFilled: solanaArgs.filledAmount.toString(), // Assume same as filled for Solana
                    sellerTotalFilled: solanaArgs.filledAmount.toString(),
                    buyerCollateral: solanaArgs.buyerCollateral.toString(),
                    sellerCollateral: solanaArgs.sellerCollateral.toString()
                }
            };
        }

        // It's already Ethereum format
        return data as RawEventData;
    }

    /**
     * Validate string field không empty
     */
    private validateStringField(value: string, fieldName: string): string {
        if (!value || typeof value !== 'string') {
            throw new Error(`Invalid ${fieldName}: must be a non-empty string ${value}`);
        }
        return value;
    }

    /**
     * Validate hash format (supports both Ethereum hex and Solana Base58)
     */
    private validateHashOrBase58(hash: string, fieldName: string): string {
        if (!hash || typeof hash !== 'string') {
            throw new Error(`Invalid ${fieldName}: must be a string ${hash}`);
        }

        // Check if it's Ethereum hex format
        if (hash.startsWith('0x')) {
            if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) {
                throw new Error(`Invalid ${fieldName}: must be a valid Ethereum hash`);
            }
            return hash.toLowerCase();
        }

        // Check if it's Solana Base58 format (32-64 chars, Base58 alphabet)
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(hash)) {
            throw new Error(`Invalid ${fieldName}: must be a valid Solana Base58 string`);
        }

        return hash;
    }

    /**
     * Validate address format (supports both Ethereum and Solana addresses)
     */
    private validateAddressOrBase58(address: string, fieldName: string): string {
        if (!address || typeof address !== 'string') {
            throw new Error(`Invalid ${fieldName}: must be a string ${address}`);
        }

        // Check if it's Ethereum address format
        if (address.startsWith('0x')) {
            if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
                throw new Error(`Invalid ${fieldName}: must be a valid Ethereum address`);
            }
            return address.toLowerCase();
        }

        // Check if it's Solana address format (32-44 chars, Base58 alphabet)
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
            throw new Error(`Invalid ${fieldName}: must be a valid Solana address`);
        }

        return address;
    }

    /**
     * Validate amount format (number as string)
     */
    private validateAmount(amount: string, fieldName: string): string {
        if (!amount || typeof amount !== 'string') {
            throw new Error(`Invalid ${fieldName}: must be a string`);
        }
        if (isNaN(Number(amount)) || Number(amount) < 0) {
            throw new Error(`Invalid ${fieldName}: must be a valid positive number`);
        }
        return amount;
    }

    /**
     * Check if this is a complete fill
     */
    public isCompleteFill(): boolean {
        return Number(this.filledAmount) === Number(this.amount);
    }

    /**
     * Check if this is a partial fill
     */
    public isPartialFill(): boolean {
        return Number(this.filledAmount) < Number(this.amount) && Number(this.filledAmount) > 0;
    }

    /**
     * Get fill percentage
     */
    public getFillPercentage(): number {
        return (Number(this.filledAmount) / Number(this.amount)) * 100;
    }

    /**
     * Get total collateral used
     */
    public getTotalCollateral(): number {
        return Number(this.buyerCollateral) + Number(this.sellerCollateral);
    }

    /**
     * Check if event data is valid
     */
    public isValid(): boolean {
        try {
            return this.blockNumber > 0 &&
                this.transactionHash.length === 66 &&
                this.timestamp > 0 &&
                Number(this.amount) > 0 &&
                Number(this.filledAmount) > 0;
        } catch (error) {
            return false;
        }
    }

    /**
     * Convert to JSON object
     */
    public toJSON(): object {
        return {
            eventName: this.eventName,
            blockNumber: this.blockNumber,
            transactionHash: this.transactionHash,
            timestamp: this.timestamp,
            sender: this.sender,
            tradeData: {
                tradeId: this.tradeId,
                buyOrderHash: this.buyOrderHash,
                sellOrderHash: this.sellOrderHash,
                buyer: this.buyer,
                seller: this.seller,
                targetTokenId: this.targetTokenId,
                amount: this.amount,
                price: this.price,
                collateralToken: this.collateralToken,
                filledAmount: this.filledAmount,
                buyerTotalFilled: this.buyerTotalFilled,
                sellerTotalFilled: this.sellerTotalFilled,
                buyerCollateral: this.buyerCollateral,
                sellerCollateral: this.sellerCollateral
            }
        };
    }

    /**
     * Convert to readable string format
     */
    public toString(): string {
        return `OrderMatchedEvent(tradeId: ${this.tradeId}, amount: ${this.filledAmount}/${this.amount}, price: ${this.price}, block: ${this.blockNumber})`;
    }

    /**
     * Static factory method để tạo instance từ raw data
     */
    public static fromRawData(data: EventInput): OrderMatchedEvent {
        return new OrderMatchedEvent(data);
    }

    /**
     * Static method để validate raw data trước khi tạo instance
     */
    public static validateRawData(data: any): data is EventInput {
        // Check for Ethereum format
        if (data &&
            typeof data === 'object' &&
            typeof data.eventName === 'string' &&
            typeof data.blockNumber === 'number' &&
            typeof data.transactionHash === 'string' &&
            typeof data.timestamp === 'number' &&
            typeof data.sender === 'string' &&
            data.args && typeof data.args === 'object') {
            return true;
        }

        // Check for Solana format
        if (data &&
            typeof data === 'object' &&
            typeof data.name === 'string' &&
            typeof data.slot === 'number' &&
            typeof data.txHash === 'string' &&
            typeof data.blockTime === 'number' &&
            typeof data.signature === 'string' &&
            data.data && typeof data.data === 'object') {
            return true;
        }

        return false;
    }
}

/**
 * Class cho TokenMarketCreated event - khi tạo token market mới
 */
export class TokenMarketCreatedEvent implements IBlockchainEvent {
    public readonly eventName: string = 'TokenMarketCreated';
    public readonly blockNumber: number;
    public readonly transactionHash: string;
    public readonly timestamp: number;
    public readonly sender: string;

    // Event-specific properties
    public readonly tokenId: string;
    public readonly symbol: string;
    public readonly name: string;
    public readonly settleTimeLimit: number;
    public readonly createdAt: number;

    constructor(data: EventInput) {
        const normalized = this.normalizeEventData(data);

        if (normalized.eventName !== 'TokenMarketCreated') {
            throw new Error(`Invalid event name: expected 'TokenMarketCreated', got '${normalized.eventName}'`);
        }

        this.blockNumber = normalized.blockNumber;
        this.transactionHash = normalized.transactionHash;
        this.timestamp = normalized.timestamp;
        this.sender = normalized.sender;

        const args = normalized.args;
        this.tokenId = this.validateAddressOrBase58(args.tokenId, 'tokenId');
        this.symbol = this.validateStringField(args.symbol, 'symbol');
        this.name = this.validateStringField(args.name, 'name');
        this.settleTimeLimit = Number(args.settleTimeLimit);
        this.createdAt = Number(args.createdAt);
    }

    private normalizeEventData(data: EventInput): RawEventData {
        if ('data' in data && 'name' in data && 'slot' in data) {
            const solanaData = data as SolanaEventData;
            const solanaArgs = solanaData.data as SolanaTokenMarketCreatedArgs;

            return {
                eventName: solanaData.name,
                blockNumber: solanaData.slot,
                transactionHash: solanaData.txHash,
                timestamp: solanaData.blockTime,
                sender: solanaData.signature,
                args: {
                    tokenId: solanaArgs.tokenId,
                    symbol: solanaArgs.symbol,
                    name: solanaArgs.name,
                    settleTimeLimit: solanaArgs.settleTimeLimit,
                    createdAt: solanaArgs.createdAt
                }
            };
        }
        return data as RawEventData;
    }

    private validateStringField(value: string, fieldName: string): string {
        if (!value || typeof value !== 'string') {
            throw new Error(`Invalid ${fieldName}: must be a non-empty string`);
        }
        return value;
    }

    private validateAddressOrBase58(address: string, fieldName: string): string {
        if (!address || typeof address !== 'string') {
            throw new Error(`Invalid ${fieldName}: must be a string`);
        }
        // Basic validation for Solana address format
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
            throw new Error(`Invalid ${fieldName}: must be a valid Solana address`);
        }
        return address;
    }

    public isValid(): boolean {
        return this.blockNumber > 0 &&
            this.tokenId.length > 0 &&
            this.symbol.length > 0 &&
            this.name.length > 0;
    }

    public toJSON(): object {
        return {
            eventName: this.eventName,
            blockNumber: this.blockNumber,
            transactionHash: this.transactionHash,
            timestamp: this.timestamp,
            sender: this.sender,
            tokenData: {
                tokenId: this.tokenId,
                symbol: this.symbol,
                name: this.name,
                settleTimeLimit: this.settleTimeLimit,
                createdAt: this.createdAt
            }
        };
    }

    public toString(): string {
        return `TokenMarketCreatedEvent(tokenId: ${this.tokenId}, symbol: ${this.symbol}, name: ${this.name})`;
    }

    public static fromRawData(data: EventInput): TokenMarketCreatedEvent {
        return new TokenMarketCreatedEvent(data);
    }
}

/**
 * Class cho TokenMapped event - khi map token thật với market
 */
export class TokenMappedEvent implements IBlockchainEvent {
    public readonly eventName: string = 'TokenMapped';
    public readonly blockNumber: number;
    public readonly transactionHash: string;
    public readonly timestamp: number;
    public readonly sender: string;

    // Event-specific properties
    public readonly tokenId: string;
    public readonly realMint: string;
    public readonly mappingTime: number;

    constructor(data: EventInput) {
        const normalized = this.normalizeEventData(data);

        if (normalized.eventName !== 'TokenMapped') {
            throw new Error(`Invalid event name: expected 'TokenMapped', got '${normalized.eventName}'`);
        }

        this.blockNumber = normalized.blockNumber;
        this.transactionHash = normalized.transactionHash;
        this.timestamp = normalized.timestamp;
        this.sender = normalized.sender;

        const args = normalized.args;
        this.tokenId = this.validateAddressOrBase58(args.tokenId, 'tokenId');
        this.realMint = this.validateAddressOrBase58(args.realMint, 'realMint');
        this.mappingTime = Number(args.mappingTime);
    }

    private normalizeEventData(data: EventInput): RawEventData {
        if ('data' in data && 'name' in data && 'slot' in data) {
            const solanaData = data as SolanaEventData;
            const solanaArgs = solanaData.data as SolanaTokenMappedArgs;

            return {
                eventName: solanaData.name,
                blockNumber: solanaData.slot,
                transactionHash: solanaData.txHash,
                timestamp: solanaData.blockTime,
                sender: solanaData.signature,
                args: {
                    tokenId: solanaArgs.tokenId,
                    realMint: solanaArgs.realMint,
                    mappingTime: solanaArgs.mappingTime
                }
            };
        }
        return data as RawEventData;
    }

    private validateAddressOrBase58(address: string, fieldName: string): string {
        if (!address || typeof address !== 'string') {
            throw new Error(`Invalid ${fieldName}: must be a string`);
        }
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
            throw new Error(`Invalid ${fieldName}: must be a valid Solana address`);
        }
        return address;
    }

    public isValid(): boolean {
        return this.blockNumber > 0 &&
            this.tokenId.length > 0 &&
            this.realMint.length > 0 &&
            this.mappingTime > 0;
    }

    public toJSON(): object {
        return {
            eventName: this.eventName,
            blockNumber: this.blockNumber,
            transactionHash: this.transactionHash,
            timestamp: this.timestamp,
            sender: this.sender,
            mappingData: {
                tokenId: this.tokenId,
                realMint: this.realMint,
                mappingTime: this.mappingTime
            }
        };
    }

    public toString(): string {
        return `TokenMappedEvent(tokenId: ${this.tokenId}, realMint: ${this.realMint})`;
    }

    public static fromRawData(data: EventInput): TokenMappedEvent {
        return new TokenMappedEvent(data);
    }
}

/**
 * Class cho TradeSettled event - khi settle trade thành công
 */
export class TradeSettledEvent implements IBlockchainEvent {
    public readonly eventName: string = 'TradeSettled';
    public readonly blockNumber: number;
    public readonly transactionHash: string;
    public readonly timestamp: number;
    public readonly sender: string;
    public readonly collateralDecimals?: number;

    // Event-specific properties
    public readonly tradeId: string;
    public readonly tokenId: string;
    public readonly buyer: string;
    public readonly seller: string;
    public readonly targetMint: string;
    public readonly filledAmount: string;
    public readonly sellerReward: string;
    public readonly settlementTime: number;

    constructor(data: EventInput) {
        const normalized = this.normalizeEventData(data);

        if (normalized.eventName !== 'TradeSettled') {
            throw new Error(`Invalid event name: expected 'TradeSettled', got '${normalized.eventName}'`);
        }

        this.blockNumber = normalized.blockNumber;
        this.transactionHash = normalized.transactionHash;
        this.timestamp = normalized.timestamp;
        this.sender = normalized.sender;
        this.collateralDecimals = normalized.collateralDecimals;

        const args = normalized.args;
        this.tradeId = this.validateAddressOrBase58(args.tradeId, 'tradeId');
        this.tokenId = this.validateAddressOrBase58(args.tokenId, 'tokenId');
        this.buyer = this.validateAddressOrBase58(args.buyer, 'buyer');
        this.seller = this.validateAddressOrBase58(args.seller, 'seller');
        this.targetMint = this.validateAddressOrBase58(args.targetMint, 'targetMint');
        this.filledAmount = this.validateAmount(args.filledAmount, 'filledAmount');
        this.sellerReward = this.validateAmount(args.sellerReward, 'sellerReward');
        this.settlementTime = Number(args.settlementTime);
    }

    private normalizeEventData(data: EventInput): RawEventData & { collateralDecimals?: number } {
        if ('data' in data && 'name' in data && 'slot' in data) {
            const solanaData = data as SolanaEventData;
            const solanaArgs = solanaData.data as SolanaTradeSettledArgs;

            return {
                eventName: solanaData.name,
                blockNumber: solanaData.slot,
                transactionHash: solanaData.txHash,
                timestamp: solanaData.blockTime,
                sender: solanaData.signature,
                collateralDecimals: solanaData.collateralDecimals,
                args: {
                    tradeId: solanaArgs.tradeId,
                    tokenId: solanaArgs.tokenId,
                    buyer: solanaArgs.buyer,
                    seller: solanaArgs.seller,
                    targetMint: solanaArgs.targetMint,
                    filledAmount: solanaArgs.filledAmount.toString(),
                    sellerReward: solanaArgs.sellerReward.toString(),
                    settlementTime: solanaArgs.settlementTime
                }
            };
        }
        return data as RawEventData;
    }

    private validateAddressOrBase58(address: string, fieldName: string): string {
        if (!address || typeof address !== 'string') {
            throw new Error(`Invalid ${fieldName}: must be a string`);
        }
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
            throw new Error(`Invalid ${fieldName}: must be a valid Solana address`);
        }
        return address;
    }

    private validateAmount(amount: string, fieldName: string): string {
        if (!amount || typeof amount !== 'string') {
            throw new Error(`Invalid ${fieldName}: must be a string`);
        }
        if (isNaN(Number(amount)) || Number(amount) < 0) {
            throw new Error(`Invalid ${fieldName}: must be a valid positive number`);
        }
        return amount;
    }

    public isValid(): boolean {
        return this.blockNumber > 0 &&
            this.tradeId.length > 0 &&
            this.buyer.length > 0 &&
            this.seller.length > 0 &&
            Number(this.filledAmount) > 0;
    }

    public toJSON(): object {
        return {
            eventName: this.eventName,
            blockNumber: this.blockNumber,
            transactionHash: this.transactionHash,
            timestamp: this.timestamp,
            sender: this.sender,
            settlementData: {
                tradeId: this.tradeId,
                tokenId: this.tokenId,
                buyer: this.buyer,
                seller: this.seller,
                targetMint: this.targetMint,
                filledAmount: this.filledAmount,
                sellerReward: this.sellerReward,
                settlementTime: this.settlementTime
            }
        };
    }

    public toString(): string {
        return `TradeSettledEvent(tradeId: ${this.tradeId}, amount: ${this.filledAmount}, reward: ${this.sellerReward})`;
    }

    public static fromRawData(data: EventInput): TradeSettledEvent {
        return new TradeSettledEvent(data);
    }
}

/**
 * Class cho OrderCancelled event - khi cancel order
 */
export class OrderCancelledEvent implements IBlockchainEvent {
    public readonly eventName: string = 'OrderCancelled';
    public readonly blockNumber: number;
    public readonly transactionHash: string;
    public readonly timestamp: number;
    public readonly sender: string;
    public readonly collateralDecimals?: number;

    // Event-specific properties
    public readonly orderHash: string;
    public readonly trader: string;
    public readonly tokenId: string;
    public readonly collateralReleased: string;
    public readonly cancellationTime: number;

    constructor(data: EventInput) {
        const normalized = this.normalizeEventData(data);

        if (normalized.eventName !== 'OrderCancelled') {
            throw new Error(`Invalid event name: expected 'OrderCancelled', got '${normalized.eventName}'`);
        }

        this.blockNumber = normalized.blockNumber;
        this.transactionHash = normalized.transactionHash;
        this.timestamp = normalized.timestamp;
        this.sender = normalized.sender;
        this.collateralDecimals = normalized.collateralDecimals;

        const args = normalized.args;
        this.orderHash = this.validateHashFromArray(args.orderHash, 'orderHash');
        this.trader = this.validateAddressOrBase58(args.trader, 'trader');
        this.tokenId = this.validateAddressOrBase58(args.tokenId, 'tokenId');
        this.collateralReleased = this.validateAmount(args.collateralReleased, 'collateralReleased');
        this.cancellationTime = Number(args.cancellationTime);
    }

    private normalizeEventData(data: EventInput): RawEventData & { collateralDecimals?: number } {
        if ('data' in data && 'name' in data && 'slot' in data) {
            const solanaData = data as SolanaEventData;
            const solanaArgs = solanaData.data as SolanaOrderCancelledArgs;

            return {
                eventName: solanaData.name,
                blockNumber: solanaData.slot,
                transactionHash: solanaData.txHash,
                timestamp: solanaData.blockTime,
                sender: solanaData.signature,
                collateralDecimals: solanaData.collateralDecimals,
                args: {
                    orderHash: solanaArgs.orderHash,
                    trader: solanaArgs.trader,
                    tokenId: solanaArgs.tokenId,
                    collateralReleased: solanaArgs.collateralReleased.toString(),
                    cancellationTime: solanaArgs.cancellationTime
                }
            };
        }
        return data as RawEventData;
    }

    private validateHashFromArray(hashArray: number[], fieldName: string): string {
        if (!Array.isArray(hashArray) || hashArray.length !== 32) {
            throw new Error(`Invalid ${fieldName}: must be an array of 32 bytes`);
        }
        // Convert array to hex string
        return '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    private validateAddressOrBase58(address: string, fieldName: string): string {
        if (!address || typeof address !== 'string') {
            throw new Error(`Invalid ${fieldName}: must be a string`);
        }
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
            throw new Error(`Invalid ${fieldName}: must be a valid Solana address`);
        }
        return address;
    }

    private validateAmount(amount: string, fieldName: string): string {
        if (!amount || typeof amount !== 'string') {
            throw new Error(`Invalid ${fieldName}: must be a string`);
        }
        if (isNaN(Number(amount)) || Number(amount) < 0) {
            throw new Error(`Invalid ${fieldName}: must be a valid positive number`);
        }
        return amount;
    }

    public isValid(): boolean {
        return this.blockNumber > 0 &&
            this.orderHash.length > 0 &&
            this.trader.length > 0 &&
            this.tokenId.length > 0;
    }

    public toJSON(): object {
        return {
            eventName: this.eventName,
            blockNumber: this.blockNumber,
            transactionHash: this.transactionHash,
            timestamp: this.timestamp,
            sender: this.sender,
            cancellationData: {
                orderHash: this.orderHash,
                trader: this.trader,
                tokenId: this.tokenId,
                collateralReleased: this.collateralReleased,
                cancellationTime: this.cancellationTime
            }
        };
    }

    public toString(): string {
        return `OrderCancelledEvent(orderHash: ${this.orderHash.substring(0, 10)}..., trader: ${this.trader}, released: ${this.collateralReleased})`;
    }

    public static fromRawData(data: EventInput): OrderCancelledEvent {
        return new OrderCancelledEvent(data);
    }
}

/**
 * Class cho TradeCancelled event - khi cancel trade
 */
export class TradeCancelledEvent implements IBlockchainEvent {
    public readonly eventName: string = 'TradeCancelled';
    public readonly blockNumber: number;
    public readonly transactionHash: string;
    public readonly timestamp: number;
    public readonly sender: string;
    public readonly collateralDecimals?: number;

    // Event-specific properties
    public readonly tradeId: string;
    public readonly tokenId: string;
    public readonly buyer: string;
    public readonly seller: string;
    public readonly penaltyAmount: string;
    public readonly cancellationTime: number;

    constructor(data: EventInput) {
        const normalized = this.normalizeEventData(data);

        if (normalized.eventName !== 'TradeCancelled') {
            throw new Error(`Invalid event name: expected 'TradeCancelled', got '${normalized.eventName}'`);
        }

        this.blockNumber = normalized.blockNumber;
        this.transactionHash = normalized.transactionHash;
        this.timestamp = normalized.timestamp;
        this.sender = normalized.sender;
        this.collateralDecimals = normalized.collateralDecimals;

        const args = normalized.args;
        this.tradeId = this.validateAddressOrBase58(args.tradeId, 'tradeId');
        this.tokenId = this.validateAddressOrBase58(args.tokenId, 'tokenId');
        this.buyer = this.validateAddressOrBase58(args.buyer, 'buyer');
        this.seller = this.validateAddressOrBase58(args.seller, 'seller');
        this.penaltyAmount = this.validateAmount(args.penaltyAmount, 'penaltyAmount');
        this.cancellationTime = Number(args.cancellationTime);
    }

    private normalizeEventData(data: EventInput): RawEventData & { collateralDecimals?: number } {
        if ('data' in data && 'name' in data && 'slot' in data) {
            const solanaData = data as SolanaEventData;
            const solanaArgs = solanaData.data as SolanaTradeCancelledArgs;

            return {
                eventName: solanaData.name,
                blockNumber: solanaData.slot,
                transactionHash: solanaData.txHash,
                timestamp: solanaData.blockTime,
                sender: solanaData.signature,
                collateralDecimals: solanaData.collateralDecimals,
                args: {
                    tradeId: solanaArgs.tradeId,
                    tokenId: solanaArgs.tokenId,
                    buyer: solanaArgs.buyer,
                    seller: solanaArgs.seller,
                    penaltyAmount: solanaArgs.penaltyAmount.toString(),
                    cancellationTime: solanaArgs.cancellationTime
                }
            };
        }
        return data as RawEventData;
    }

    private validateAddressOrBase58(address: string, fieldName: string): string {
        if (!address || typeof address !== 'string') {
            throw new Error(`Invalid ${fieldName}: must be a string`);
        }
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
            throw new Error(`Invalid ${fieldName}: must be a valid Solana address`);
        }
        return address;
    }

    private validateAmount(amount: string, fieldName: string): string {
        if (!amount || typeof amount !== 'string') {
            throw new Error(`Invalid ${fieldName}: must be a string`);
        }
        if (isNaN(Number(amount)) || Number(amount) < 0) {
            throw new Error(`Invalid ${fieldName}: must be a valid positive number`);
        }
        return amount;
    }

    public isValid(): boolean {
        return this.blockNumber > 0 &&
            this.tradeId.length > 0 &&
            this.buyer.length > 0 &&
            this.seller.length > 0;
    }

    public toJSON(): object {
        return {
            eventName: this.eventName,
            blockNumber: this.blockNumber,
            transactionHash: this.transactionHash,
            timestamp: this.timestamp,
            sender: this.sender,
            cancellationData: {
                tradeId: this.tradeId,
                tokenId: this.tokenId,
                buyer: this.buyer,
                seller: this.seller,
                penaltyAmount: this.penaltyAmount,
                cancellationTime: this.cancellationTime
            }
        };
    }

    public toString(): string {
        return `TradeCancelledEvent(tradeId: ${this.tradeId}, penalty: ${this.penaltyAmount})`;
    }

    public static fromRawData(data: EventInput): TradeCancelledEvent {
        return new TradeCancelledEvent(data);
    }
}