import { ethers } from "ethers";

/**
 * Check if a string is a valid EVM address
 * @param value - String to check
 * @returns true if valid EVM address
 */
export const isEvmAddress = (value: unknown): value is string => {
    if (typeof value !== 'string') return false;

    // Basic format check: starts with 0x and has 42 characters total
    if (!/^0x[a-fA-F0-9]{40}$/.test(value)) return false;

    // Use ethers.js built-in validation for more robust checking
    try {
        return ethers.isAddress(value);
    } catch {
        return false;
    }
};

/**
 * Check if a value can be safely converted from bigint to number
 * @param value - Bigint value to check
 * @returns true if safe to convert
 */
export const isSafeToConvertBigInt = (value: bigint): boolean => {
    // JavaScript Number.MAX_SAFE_INTEGER = 2^53 - 1
    const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
    const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);

    return value <= MAX_SAFE_BIGINT && value >= MIN_SAFE_BIGINT;
};

/**
 * Convert bigint to number with safety check
 * @param value - Bigint value to convert
 * @param options - Conversion options
 * @returns number or string (if overflow and preserveOnOverflow is true)
 */
export const convertBigIntToNumber = (
    value: bigint,
    options: {
        preserveOnOverflow?: boolean;
        warningOnOverflow?: boolean;
    } = {}
): number | string => {
    const { preserveOnOverflow = true, warningOnOverflow = true } = options;

    if (isSafeToConvertBigInt(value)) {
        return Number(value);
    }

    // Handle overflow
    if (warningOnOverflow) {
        console.warn(`BigInt overflow detected: ${value.toString()} - exceeds safe integer range`);
    }

    if (preserveOnOverflow) {
        // Return as string to preserve precision
        return value.toString();
    }

    // Force conversion (may lose precision)
    return Number(value);
};

/**
 * Normalize EVM addresses in an object to lowercase
 * This function recursively processes nested objects and arrays
 * @param obj - Object to normalize
 * @returns New object with EVM addresses normalized to lowercase
 */
export const normalizeAddresses = <T>(obj: T): T => {
    if (obj === null || obj === undefined) {
        return obj;
    }

    // Handle primitive types
    if (typeof obj !== 'object') {
        return isEvmAddress(obj) ? (obj.toLowerCase() as T) : obj;
    }

    // Handle arrays
    if (Array.isArray(obj)) {
        return obj.map(item => normalizeAddresses(item)) as T;
    }

    // Handle objects
    const normalized = {} as T;

    for (const [key, value] of Object.entries(obj)) {
        if (isEvmAddress(value)) {
            // Normalize EVM address to lowercase
            (normalized as any)[key] = value.toLowerCase();
        } else if (typeof value === 'object') {
            // Recursively process nested objects/arrays
            (normalized as any)[key] = normalizeAddresses(value);
        } else {
            // Keep other values as-is
            (normalized as any)[key] = value;
        }
    }

    return normalized;
};

/**
 * Convert bigint values to numbers in an object
 * This function recursively processes nested objects and arrays
 * @param obj - Object to convert
 * @param options - Conversion options
 * @returns New object with bigint values converted to numbers
 */
export const convertBigIntsToNumbers = <T>(
    obj: T,
    options: {
        preserveOnOverflow?: boolean;
        warningOnOverflow?: boolean;
    } = {}
): T => {
    if (obj === null || obj === undefined) {
        return obj;
    }

    // Handle primitive types
    if (typeof obj !== 'object') {
        return typeof obj === 'bigint'
            ? (convertBigIntToNumber(obj, options) as T)
            : obj;
    }

    // Handle arrays
    if (Array.isArray(obj)) {
        return obj.map(item => convertBigIntsToNumbers(item, options)) as T;
    }

    // Handle objects
    const converted = {} as T;

    for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'bigint') {
            // Convert bigint to number
            (converted as any)[key] = convertBigIntToNumber(value, options);
        } else if (typeof value === 'object') {
            // Recursively process nested objects/arrays
            (converted as any)[key] = convertBigIntsToNumbers(value, options);
        } else {
            // Keep other values as-is
            (converted as any)[key] = value;
        }
    }

    return converted;
};

/**
 * Apply both address normalization and bigint conversion
 * @param obj - Object to process
 * @param bigintOptions - Options for bigint conversion
 * @returns Object with normalized addresses and converted bigints
 */
export const normalizeAndConvert = <T>(
    obj: T,
    bigintOptions: {
        preserveOnOverflow?: boolean;
        warningOnOverflow?: boolean;
    } = {}
): T => {
    // First normalize addresses, then convert bigints
    const normalized = normalizeAddresses(obj);
    return convertBigIntsToNumbers(normalized, bigintOptions);
};

/**
 * Check if an object contains any EVM addresses
 * @param obj - Object to check
 * @returns true if object contains at least one EVM address
 */
export const containsEvmAddresses = (obj: any): boolean => {
    if (obj === null || obj === undefined) {
        return false;
    }

    if (typeof obj !== 'object') {
        return isEvmAddress(obj);
    }

    if (Array.isArray(obj)) {
        return obj.some(item => containsEvmAddresses(item));
    }

    return Object.values(obj).some(value => {
        if (isEvmAddress(value)) {
            return true;
        }
        if (typeof value === 'object') {
            return containsEvmAddresses(value);
        }
        return false;
    });
};

/**
 * Check if an object contains any bigint values
 * @param obj - Object to check
 * @returns true if object contains at least one bigint
 */
export const containsBigInts = (obj: any): boolean => {
    if (obj === null || obj === undefined) {
        return false;
    }

    if (typeof obj !== 'object') {
        return typeof obj === 'bigint';
    }

    if (Array.isArray(obj)) {
        return obj.some(item => containsBigInts(item));
    }

    return Object.values(obj).some(value => {
        if (typeof value === 'bigint') {
            return true;
        }
        if (typeof value === 'object') {
            return containsBigInts(value);
        }
        return false;
    });
};

/**
 * Get all EVM addresses from an object
 * @param obj - Object to extract addresses from
 * @returns Array of unique EVM addresses found
 */
export const extractEvmAddresses = (obj: any): string[] => {
    const addresses = new Set<string>();

    const extract = (value: any) => {
        if (value === null || value === undefined) {
            return;
        }

        if (isEvmAddress(value)) {
            addresses.add(value.toLowerCase());
            return;
        }

        if (Array.isArray(value)) {
            value.forEach(item => extract(item));
            return;
        }

        if (typeof value === 'object') {
            Object.values(value).forEach(val => extract(val));
        }
    };

    extract(obj);
    return Array.from(addresses);
};

/**
 * Get all bigint values from an object
 * @param obj - Object to extract bigints from
 * @returns Array of bigint values found
 */
export const extractBigInts = (obj: any): bigint[] => {
    const bigints: bigint[] = [];

    const extract = (value: any) => {
        if (value === null || value === undefined) {
            return;
        }

        if (typeof value === 'bigint') {
            bigints.push(value);
            return;
        }

        if (Array.isArray(value)) {
            value.forEach(item => extract(item));
            return;
        }

        if (typeof value === 'object') {
            Object.values(value).forEach(val => extract(val));
        }
    };

    extract(obj);
    return bigints;
}; 