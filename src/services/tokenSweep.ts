/**
 * Token Sweep Service
 *
 * Scans for all ERC-20 tokens in the public wallet, prices them,
 * and swaps eligible ones to USDC via Paraswap (no API key needed).
 * Runs at bot startup to consolidate all holdings into trading collateral.
 */

import { ethers } from 'ethers';
import axios from 'axios';
import { ENV } from '../config/env';

const POLYGON_CHAIN_ID = 137;
const USDC_NATIVE = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
const USDC_E = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const WMATIC = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270';

const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function name() view returns (string)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
];

/**
 * Top Polygon ERC-20 tokens to scan (address → coingecko id for pricing).
 * The sweep scans native MATIC balance too.
 */
const POLYGON_TOKEN_LIST: Array<{
    address: string;
    coingeckoId: string;
    symbol: string;
    decimals: number;
}> = [
    { address: WMATIC, coingeckoId: 'matic-network', symbol: 'WMATIC', decimals: 18 },
    { address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', coingeckoId: 'ethereum', symbol: 'WETH', decimals: 18 },
    { address: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', coingeckoId: 'wrapped-bitcoin', symbol: 'WBTC', decimals: 8 },
    { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', coingeckoId: 'tether', symbol: 'USDT', decimals: 6 },
    { address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', coingeckoId: 'dai', symbol: 'DAI', decimals: 18 },
    { address: '0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39', coingeckoId: 'chainlink', symbol: 'LINK', decimals: 18 },
    { address: '0xD6DF932A45C0f255f85145f286eA0b292B21C90B', coingeckoId: 'aave', symbol: 'AAVE', decimals: 18 },
    { address: '0xb33EaAd8d922B1083446DC23f610c2567fB5180f', coingeckoId: 'uniswap', symbol: 'UNI', decimals: 18 },
    { address: '0x0b3F868E0BE5597D5DB7fEB59E1CADBb0fdDa50a', coingeckoId: 'sushi', symbol: 'SUSHI', decimals: 18 },
    { address: '0x831753DD7087CaC61aB5644b308642cc1c33Dc13', coingeckoId: 'quickswap', symbol: 'QUICK', decimals: 18 },
    { address: '0x580A84C73811E1839F75d86d75d88cCa0c241fF4', coingeckoId: 'qi-dao', symbol: 'QI', decimals: 18 },
    { address: '0x172370d5Cd63279eFa6d502DAB29171933a610AF', coingeckoId: 'curve-dao-token', symbol: 'CRV', decimals: 18 },
    { address: '0x385Eeac5cB85A38A9a07A70c73e0a3271CfB54A7', coingeckoId: 'aavegotchi', symbol: 'GHST', decimals: 18 },
    { address: '0x2C89bbc92BD86F8075d1DEcc58C7F4E0107f286b', coingeckoId: 'avalanche-2', symbol: 'AVAX', decimals: 18 },
    { address: '0xa3Fa99A148fA48D14Ed51d610c367C61876997F1', coingeckoId: 'mimatic', symbol: 'MAI', decimals: 18 },
    { address: '0x61299774020dA444Af134c82fa83E3810b309991', coingeckoId: 'render-token', symbol: 'RNDR', decimals: 18 },
    { address: '0x4e3Decbb3645551B8A19f0eA1678079FCB33fB4c', coingeckoId: 'jeur', symbol: 'jEUR', decimals: 18 },
    { address: '0xE5417Af564e4bFDA1c483642db72007871397896', coingeckoId: 'gains-network', symbol: 'GNS', decimals: 18 },
    { address: '0x50B728D8D964fd00C2d0AAD81718b71311feF68a', coingeckoId: 'stargate-finance', symbol: 'STG', decimals: 18 },
];

const USDC_FAMILY = new Set([
    USDC_NATIVE.toLowerCase(),
    USDC_E.toLowerCase(),
    (ENV.COLLATERAL_TOKEN_ADDRESS || '').toLowerCase(),
].filter(Boolean));

export interface TokenBalance {
    address: string;
    symbol: string;
    decimals: number;
    rawBalance: ethers.BigNumber;
    balance: number;
    priceUsd: number | null;
    valueUsd: number | null;
}

export interface SweepResult {
    tokensScanned: number;
    tokensWithBalance: TokenBalance[];
    swapsAttempted: number;
    swapsSucceeded: number;
    totalSwappedUsd: number;
    nativeMaticUsd: number;
    errors: string[];
    timestamp: string;
}

export interface SweepConfig {
    enabled: boolean;
    minValueUsd: number;
    maxSlippagePct: number;
    keepMaticForGas: number;
    blocklist: string[];
    dryRun: boolean;
}

const DEFAULT_SWEEP_CONFIG: SweepConfig = {
    enabled: true,
    minValueUsd: 0.50,
    maxSlippagePct: 3,
    keepMaticForGas: 0.5,
    blocklist: [],
    dryRun: false,
};

let _lastSweepResult: SweepResult | null = null;
export function getLastSweepResult(): SweepResult | null {
    return _lastSweepResult;
}

function getProvider(): ethers.providers.JsonRpcProvider {
    return new ethers.providers.JsonRpcProvider(ENV.RPC_URL);
}

function getSigner(): ethers.Wallet {
    return new ethers.Wallet(ENV.PRIVATE_KEY, getProvider());
}

async function fetchTokenBalance(
    tokenAddress: string,
    owner: string,
    provider: ethers.providers.Provider
): Promise<{ balance: ethers.BigNumber; decimals: number; symbol: string }> {
    const c = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const [bal, dec, sym] = await Promise.all([
        c.balanceOf(owner).catch(() => ethers.constants.Zero),
        c.decimals().catch(() => 18),
        c.symbol().catch(() => '???'),
    ]);
    return { balance: bal as ethers.BigNumber, decimals: dec as number, symbol: sym as string };
}

async function fetchPricesUsd(
    coingeckoIds: string[]
): Promise<Record<string, number>> {
    if (coingeckoIds.length === 0) return {};
    try {
        const ids = coingeckoIds.join(',');
        const r = await axios.get<Record<string, { usd?: number }>>(
            'https://api.coingecko.com/api/v3/simple/price',
            { params: { ids, vs_currencies: 'usd' }, timeout: 8_000 }
        );
        const out: Record<string, number> = {};
        for (const [id, data] of Object.entries(r.data)) {
            if (data?.usd != null && Number.isFinite(data.usd)) {
                out[id] = data.usd;
            }
        }
        return out;
    } catch {
        return {};
    }
}

async function fetchNativeMaticBalance(address: string, provider: ethers.providers.Provider): Promise<number> {
    try {
        const bal = await provider.getBalance(address);
        return parseFloat(ethers.utils.formatEther(bal));
    } catch {
        return 0;
    }
}

/**
 * Get a swap quote from Paraswap.
 */
async function getParaswapQuote(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    srcDecimals: number,
    destDecimals: number
): Promise<{
    destAmount: string;
    priceRoute: unknown;
} | null> {
    try {
        const r = await axios.get('https://apiv5.paraswap.io/prices', {
            params: {
                srcToken,
                destToken,
                amount: srcAmount,
                srcDecimals,
                destDecimals,
                side: 'SELL',
                network: POLYGON_CHAIN_ID,
            },
            timeout: 10_000,
        });
        return {
            destAmount: r.data?.priceRoute?.destAmount ?? '0',
            priceRoute: r.data?.priceRoute,
        };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[Sweep] Paraswap quote failed for ${srcToken}: ${msg.slice(0, 100)}`);
        return null;
    }
}

/**
 * Build and execute swap transaction via Paraswap.
 */
async function executeParaswapSwap(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    srcDecimals: number,
    destDecimals: number,
    priceRoute: unknown,
    slippagePct: number,
    signer: ethers.Wallet
): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
        const txParams = await axios.post(
            'https://apiv5.paraswap.io/transactions/' + POLYGON_CHAIN_ID,
            {
                srcToken,
                destToken,
                srcAmount,
                srcDecimals,
                destDecimals,
                slippage: slippagePct * 100,
                priceRoute,
                userAddress: signer.address,
            },
            { timeout: 10_000 }
        );

        const txData = txParams.data;
        const tx = await signer.sendTransaction({
            to: txData.to,
            data: txData.data,
            value: txData.value ? ethers.BigNumber.from(txData.value) : undefined,
            gasLimit: txData.gas ? ethers.BigNumber.from(txData.gas) : undefined,
        });

        const receipt = await tx.wait();
        return { success: true, txHash: receipt.transactionHash };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, error: msg.slice(0, 200) };
    }
}

async function ensureApproval(
    tokenAddress: string,
    spender: string,
    amount: ethers.BigNumber,
    signer: ethers.Wallet
): Promise<void> {
    const c = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
    const current: ethers.BigNumber = await c.allowance(signer.address, spender);
    if (current.gte(amount)) return;
    console.log(`[Sweep] Approving ${tokenAddress} for spender ${spender}...`);
    const tx = await c.approve(spender, ethers.constants.MaxUint256);
    await tx.wait();
}

/**
 * Get Paraswap's token transfer proxy address for approvals.
 */
async function getParaswapTokenTransferProxy(): Promise<string> {
    try {
        const r = await axios.get(
            `https://apiv5.paraswap.io/adapters/contracts?network=${POLYGON_CHAIN_ID}`,
            { timeout: 8_000 }
        );
        return r.data?.TokenTransferProxy ?? '0x216B4B4Ba9F3e719726886d34a177484278Bfcae';
    } catch {
        return '0x216B4B4Ba9F3e719726886d34a177484278Bfcae';
    }
}

/**
 * Wrap native MATIC → WMATIC so it can be swapped via DEX.
 */
async function wrapMatic(amount: ethers.BigNumber, signer: ethers.Wallet): Promise<string | null> {
    try {
        const wmatic = new ethers.Contract(
            WMATIC,
            ['function deposit() payable'],
            signer
        );
        const tx = await wmatic.deposit({ value: amount });
        const receipt = await tx.wait();
        return receipt.transactionHash;
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[Sweep] WMATIC wrap failed: ${msg.slice(0, 100)}`);
        return null;
    }
}

/**
 * Main sweep: scan tokens, price them, swap eligible ones to USDC.
 */
export async function runTokenSweep(config?: Partial<SweepConfig>): Promise<SweepResult> {
    const cfg: SweepConfig = { ...DEFAULT_SWEEP_CONFIG, ...config };
    const result: SweepResult = {
        tokensScanned: 0,
        tokensWithBalance: [],
        swapsAttempted: 0,
        swapsSucceeded: 0,
        totalSwappedUsd: 0,
        nativeMaticUsd: 0,
        errors: [],
        timestamp: new Date().toISOString(),
    };

    const provider = getProvider();
    const wallet = ENV.PUBLIC_ADDRESS;
    const blocklistLower = new Set(cfg.blocklist.map((a) => a.toLowerCase()));

    console.log('[Sweep] Scanning wallet for all ERC-20 tokens...');

    // 1. Scan native MATIC
    const maticBalance = await fetchNativeMaticBalance(wallet, provider);
    const maticPrices = await fetchPricesUsd(['matic-network']);
    const maticPriceUsd = maticPrices['matic-network'] ?? 0;
    const maticValueUsd = maticBalance * maticPriceUsd;
    result.nativeMaticUsd = maticValueUsd;

    // 2. Scan all listed tokens
    const coingeckoIds = POLYGON_TOKEN_LIST.map((t) => t.coingeckoId);
    const prices = await fetchPricesUsd(coingeckoIds);

    const scanResults: TokenBalance[] = [];

    for (const token of POLYGON_TOKEN_LIST) {
        try {
            const { balance, decimals, symbol } = await fetchTokenBalance(
                token.address,
                wallet,
                provider
            );
            result.tokensScanned++;

            if (balance.isZero()) continue;

            const humanBalance = parseFloat(ethers.utils.formatUnits(balance, decimals));
            const priceUsd = prices[token.coingeckoId] ?? null;
            const valueUsd = priceUsd != null ? humanBalance * priceUsd : null;

            const entry: TokenBalance = {
                address: token.address,
                symbol: symbol || token.symbol,
                decimals,
                rawBalance: balance,
                balance: humanBalance,
                priceUsd,
                valueUsd,
            };

            scanResults.push(entry);
            result.tokensWithBalance.push(entry);
        } catch {
            result.errors.push(`Failed to scan ${token.symbol} (${token.address.slice(0, 10)}...)`);
        }
    }

    // 3. Log findings
    console.log(`[Sweep] Found ${scanResults.length} tokens with balance (+ ${maticBalance.toFixed(4)} MATIC native = $${maticValueUsd.toFixed(2)})`);
    for (const t of scanResults) {
        const val = t.valueUsd != null ? `$${t.valueUsd.toFixed(2)}` : '?';
        console.log(`  ${t.symbol}: ${t.balance.toFixed(6)} (${val})`);
    }

    if (!cfg.enabled) {
        console.log('[Sweep] Auto-swap disabled. Scan only.');
        _lastSweepResult = result;
        return result;
    }

    // 4. Determine swap target: prefer USDC native, fall back to USDC.e
    const destToken = USDC_NATIVE;
    const destDecimals = 6;
    const signer = getSigner();
    const transferProxy = await getParaswapTokenTransferProxy();

    // 5. Wrap + swap excess native MATIC (keep reserve for gas)
    const maticToSwap = maticBalance - cfg.keepMaticForGas;
    if (maticToSwap > 0.01 && maticValueUsd > cfg.minValueUsd) {
        const wrapAmount = ethers.utils.parseEther(maticToSwap.toFixed(18));
        console.log(`[Sweep] Wrapping ${maticToSwap.toFixed(4)} MATIC → WMATIC (keeping ${cfg.keepMaticForGas} for gas)...`);

        if (!cfg.dryRun) {
            const wrapTx = await wrapMatic(wrapAmount, signer);
            if (wrapTx) {
                scanResults.push({
                    address: WMATIC,
                    symbol: 'WMATIC',
                    decimals: 18,
                    rawBalance: wrapAmount,
                    balance: maticToSwap,
                    priceUsd: maticPriceUsd,
                    valueUsd: maticToSwap * maticPriceUsd,
                });
            } else {
                result.errors.push('MATIC → WMATIC wrap failed');
            }
        } else {
            console.log(`  [DRY RUN] Would wrap ${maticToSwap.toFixed(4)} MATIC`);
        }
    }

    // 6. Swap each eligible token to USDC
    for (const token of scanResults) {
        if (USDC_FAMILY.has(token.address.toLowerCase())) continue;
        if (blocklistLower.has(token.address.toLowerCase())) {
            console.log(`  [Sweep] Skipping blocklisted token: ${token.symbol}`);
            continue;
        }
        if (token.valueUsd != null && token.valueUsd < cfg.minValueUsd) {
            console.log(`  [Sweep] Skipping ${token.symbol}: value $${token.valueUsd.toFixed(2)} < min $${cfg.minValueUsd.toFixed(2)}`);
            continue;
        }
        if (token.valueUsd == null) {
            console.log(`  [Sweep] Skipping ${token.symbol}: no price data`);
            continue;
        }

        result.swapsAttempted++;
        const srcAmount = token.rawBalance.toString();

        console.log(`[Sweep] Quoting ${token.symbol} → USDC ($${token.valueUsd.toFixed(2)})...`);

        const quote = await getParaswapQuote(
            token.address,
            destToken,
            srcAmount,
            token.decimals,
            destDecimals
        );

        if (!quote || quote.destAmount === '0') {
            result.errors.push(`No quote for ${token.symbol}`);
            continue;
        }

        const destAmountHuman = parseFloat(
            ethers.utils.formatUnits(quote.destAmount, destDecimals)
        );
        const expectedUsd = token.valueUsd;
        const slippage = expectedUsd > 0 ? ((expectedUsd - destAmountHuman) / expectedUsd) * 100 : 0;

        if (slippage > cfg.maxSlippagePct) {
            console.log(
                `  [Sweep] Skipping ${token.symbol}: slippage ${slippage.toFixed(1)}% > max ${cfg.maxSlippagePct}%`
            );
            result.errors.push(`${token.symbol}: slippage ${slippage.toFixed(1)}% too high`);
            continue;
        }

        console.log(
            `  [Sweep] ${token.symbol}: ${token.balance.toFixed(4)} → ~${destAmountHuman.toFixed(2)} USDC (slip ${slippage.toFixed(1)}%)`
        );

        if (cfg.dryRun) {
            console.log(`  [DRY RUN] Would swap ${token.symbol}`);
            result.swapsSucceeded++;
            result.totalSwappedUsd += destAmountHuman;
            continue;
        }

        try {
            await ensureApproval(token.address, transferProxy, token.rawBalance, signer);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            result.errors.push(`Approval failed for ${token.symbol}: ${msg.slice(0, 80)}`);
            continue;
        }

        const swapResult = await executeParaswapSwap(
            token.address,
            destToken,
            srcAmount,
            token.decimals,
            destDecimals,
            quote.priceRoute,
            cfg.maxSlippagePct,
            signer
        );

        if (swapResult.success) {
            console.log(`  [Sweep] Swapped ${token.symbol} → USDC. tx: ${swapResult.txHash}`);
            result.swapsSucceeded++;
            result.totalSwappedUsd += destAmountHuman;
        } else {
            console.log(`  [Sweep] Swap failed for ${token.symbol}: ${swapResult.error}`);
            result.errors.push(`Swap failed: ${token.symbol} — ${swapResult.error?.slice(0, 80)}`);
        }

        await new Promise((r) => setTimeout(r, 1000));
    }

    // 7. Summary
    console.log(
        `[Sweep] Done. Swapped ${result.swapsSucceeded}/${result.swapsAttempted} tokens → ~$${result.totalSwappedUsd.toFixed(2)} USDC.` +
            (result.errors.length > 0 ? ` Errors: ${result.errors.length}` : '')
    );

    _lastSweepResult = result;
    return result;
}
