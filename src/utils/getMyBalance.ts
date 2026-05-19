import { ethers } from 'ethers';
import { ENV } from '../config/env';

const RPC_URL = ENV.RPC_URL;

// Polygon commonly uses multiple USDC-family contracts:
// - USDC.e (legacy bridged)
// - USDC (native)
// - pUSD (Polymarket collateral on CLOB V2)
//
// Some deployments/proxies use a configurable collateral token address.
// We therefore query:
// - known Polygon USDC.e + USDC
// - ENV.COLLATERAL_TOKEN_ADDRESS (or legacy ENV.USDC_CONTRACT_ADDRESS)
const USDC_E_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const USDC_NATIVE_ADDRESS = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
const COLLATERAL_TOKEN_ADDRESS = ENV.COLLATERAL_TOKEN_ADDRESS;

const ERC20_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function decimals() view returns (uint8)',
];

// Reuse provider to avoid creating a new connection every call (ethers v5 API)
let _provider: ethers.providers.JsonRpcProvider | null = null;
function getProvider(): ethers.providers.JsonRpcProvider {
    if (!_provider) {
        _provider = new ethers.providers.JsonRpcProvider(RPC_URL);
    }
    return _provider;
}

/**
 * Get the USDC balance (both native + bridged) for a single address.
 */
function uniqLower(addresses: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const a of addresses) {
        const v = (a || '').trim();
        if (!v) continue;
        const k = v.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(v);
    }
    return out;
}

// Cache decimals per token address to avoid repeated RPC calls.
const _decimalsCache = new Map<string, number>();
async function getTokenDecimals(tokenAddress: string, provider: ethers.providers.Provider): Promise<number> {
    const key = tokenAddress.toLowerCase();
    const cached = _decimalsCache.get(key);
    if (typeof cached === 'number') return cached;
    const c = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    let d = 6;
    try {
        d = (await c.decimals()) as number;
    } catch {
        // Default to 6 (USDC-like) when decimals() is unavailable.
        d = 6;
    }
    _decimalsCache.set(key, d);
    return d;
}

async function getUsdcBalance(address: string): Promise<{ usdcNative: number; usdcBridged: number; total: number }> {
    const provider = getProvider();
    const tokenList = uniqLower([USDC_E_ADDRESS, USDC_NATIVE_ADDRESS, COLLATERAL_TOKEN_ADDRESS]);

    const balances = await Promise.all(
        tokenList.map(async (token) => {
            try {
                const c = new ethers.Contract(token, ERC20_ABI, provider);
                const [bal, dec] = await Promise.all([
                    c.balanceOf(address) as Promise<ethers.BigNumber>,
                    getTokenDecimals(token, provider),
                ]);
                return { token, bal, dec, ok: true as const };
            } catch {
                // Not a standard ERC-20 (or RPC error). Treat as zero balance instead of failing the dashboard.
                return { token, bal: ethers.constants.Zero, dec: 6, ok: false as const };
            }
        })
    );

    const getAmount = (token: string): number => {
        const row = balances.find((b) => b.token.toLowerCase() === token.toLowerCase());
        if (!row) return 0;
        return parseFloat(ethers.utils.formatUnits(row.bal, row.dec));
    };

    const usdcBridged = getAmount(USDC_E_ADDRESS);
    const usdcNative = getAmount(USDC_NATIVE_ADDRESS);
    const extraTotal = balances
        .filter(
            (b) =>
                b.token.toLowerCase() !== USDC_E_ADDRESS.toLowerCase() &&
                b.token.toLowerCase() !== USDC_NATIVE_ADDRESS.toLowerCase()
        )
        .reduce((s, b) => s + parseFloat(ethers.utils.formatUnits(b.bal, b.dec)), 0);

    return {
        usdcNative,
        usdcBridged,
        total: usdcNative + usdcBridged + extraTotal,
    };
}

export interface WalletBalances {
    /** USDC in the public wallet (MetaMask) — native + bridged */
    publicWalletUsdc: number;
    /** USDC in the proxy wallet (Polymarket trading balance) — native + bridged */
    polymarketUsdc: number;
    /** Combined total */
    totalUsdc: number;
}

export interface MarketPositionShares {
    yesShares: number;
    noShares: number;
}

/**
 * Get balances for both the public wallet and the Polymarket proxy wallet.
 */
export async function getAllBalances(): Promise<WalletBalances> {
    const [pub, proxy] = await Promise.all([
        getUsdcBalance(ENV.PUBLIC_ADDRESS),
        getUsdcBalance(ENV.PROXY_WALLET),
    ]);

    return {
        publicWalletUsdc: pub.total,
        polymarketUsdc: proxy.total,
        totalUsdc: pub.total + proxy.total,
    };
}

/**
 * Legacy: get USDC balance for a single address (both USDC types combined).
 */
const getMyBalance = async (address: string): Promise<number> => {
    const result = await getUsdcBalance(address);
    return result.total;
};

export default getMyBalance;

// ─── Position Redemption ──────────────────────────────────────────────────────

// Polymarket ConditionalTokens contract on Polygon
const CONDITIONAL_TOKENS_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';

const CONDITIONAL_TOKENS_ABI = [
    'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)',
    'function balanceOf(address owner, uint256 id) view returns (uint256)',
    'function payoutDenominator(bytes32 conditionId) view returns (uint256)',
    'function getCollectionId(bytes32 parentCollectionId, bytes32 conditionId, uint256 indexSet) view returns (bytes32)',
    'function getPositionId(address collateralToken, bytes32 collectionId) view returns (uint256)',
];

/**
 * Read a single conditional-token position balance and convert to share units.
 * Polymarket positions are USDC-denominated (6 decimals), so 1.0 share = 1e6 units.
 */
export async function getPositionShares(owner: string, tokenId: string): Promise<number> {
    const provider = getProvider();
    const ct = new ethers.Contract(CONDITIONAL_TOKENS_ADDRESS, CONDITIONAL_TOKENS_ABI, provider);
    const raw: ethers.BigNumber = await ct.balanceOf(owner, tokenId);
    return parseFloat(ethers.utils.formatUnits(raw, 6));
}

/**
 * Read YES/NO position balances for a market from the proxy wallet.
 */
export async function getMarketPositionShares(
    yesTokenId: string,
    noTokenId: string,
    owner: string = ENV.PROXY_WALLET
): Promise<MarketPositionShares> {
    const [yesShares, noShares] = await Promise.all([
        getPositionShares(owner, yesTokenId),
        getPositionShares(owner, noTokenId),
    ]);
    return { yesShares, noShares };
}

export interface RedeemabilityCheck {
    redeemable: boolean;
    payoutDenominator: number;
    yesShares: string;
    noShares: string;
    reason?: string;
}

/**
 * Check whether a condition is already resolved and redeemable from the EOA wallet.
 * This avoids sending redeem transactions that would revert and waste gas.
 */
export async function checkRedeemability(conditionId: string): Promise<RedeemabilityCheck> {
    try {
        const provider = getProvider();
        const ct = new ethers.Contract(CONDITIONAL_TOKENS_ADDRESS, CONDITIONAL_TOKENS_ABI, provider);

        const payoutDenominatorBn: ethers.BigNumber = await ct.payoutDenominator(conditionId);
        if (payoutDenominatorBn.lte(0)) {
            return {
                redeemable: false,
                payoutDenominator: 0,
                yesShares: '0',
                noShares: '0',
                reason: 'condition not resolved yet',
            };
        }

        const parentCollectionId = ethers.constants.HashZero;
        const [yesCollectionId, noCollectionId] = await Promise.all([
            ct.getCollectionId(parentCollectionId, conditionId, 1),
            ct.getCollectionId(parentCollectionId, conditionId, 2),
        ]);

        const [yesPositionId, noPositionId] = await Promise.all([
            ct.getPositionId(COLLATERAL_TOKEN_ADDRESS, yesCollectionId),
            ct.getPositionId(COLLATERAL_TOKEN_ADDRESS, noCollectionId),
        ]);

        const [yesBalance, noBalance] = await Promise.all([
            ct.balanceOf(ENV.PUBLIC_ADDRESS, yesPositionId) as Promise<ethers.BigNumber>,
            ct.balanceOf(ENV.PUBLIC_ADDRESS, noPositionId) as Promise<ethers.BigNumber>,
        ]);

        const redeemable = yesBalance.gt(0) || noBalance.gt(0);
        return {
            redeemable,
            payoutDenominator: payoutDenominatorBn.toNumber(),
            yesShares: yesBalance.toString(),
            noShares: noBalance.toString(),
            reason: redeemable ? undefined : 'EOA has no redeemable position balance',
        };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
            redeemable: false,
            payoutDenominator: 0,
            yesShares: '0',
            noShares: '0',
            reason: `redeemability check failed: ${msg}`,
        };
    }
}

/**
 * Attempt to redeem winning positions after a market resolves.
 *
 * Calls ConditionalTokens.redeemPositions() which burns winning tokens
 * and transfers USDC back to the caller.
 *
 * NOTE: This calls from the EOA (signer), which may or may not hold the
 * tokens depending on whether Polymarket routes trades through the proxy.
 * If the proxy holds the tokens, Polymarket's backend usually auto-redeems.
 * This function serves as a fallback attempt.
 */
export async function redeemPositions(conditionId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const check = await checkRedeemability(conditionId);
        if (!check.redeemable) {
            return { success: false, error: check.reason || 'not redeemable yet' };
        }

        const provider = getProvider();
        const wallet = new ethers.Wallet(ENV.PRIVATE_KEY, provider);
        const ct = new ethers.Contract(CONDITIONAL_TOKENS_ADDRESS, CONDITIONAL_TOKENS_ABI, wallet);

        const collateralToken = COLLATERAL_TOKEN_ADDRESS;
        const parentCollectionId = ethers.constants.HashZero;
        // Binary market: indexSets [1, 2] = outcome slot 0 (YES) and slot 1 (NO)
        const indexSets = [1, 2];

        console.log(`[Redeem] Attempting to redeem positions for conditionId=${conditionId.slice(0, 16)}...`);

        const tx = await ct.redeemPositions(collateralToken, parentCollectionId, conditionId, indexSets);
        const receipt = await tx.wait();

        console.log(`[Redeem] Success! tx=${receipt.transactionHash}`);
        return { success: true };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Don't log as error — this is expected if proxy holds the tokens
        console.log(`[Redeem] Could not redeem from EOA (proxy may auto-redeem): ${msg.slice(0, 100)}`);
        return { success: false, error: msg };
    }
}
