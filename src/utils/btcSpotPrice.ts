/**
 * Best-effort BTC/USD spot from multiple public providers.
 * Used for window-open delta only.
 */

import axios from 'axios';

let cachedPrice: number | null = null;
let cachedAtMs = 0;
const CACHE_TTL_MS = 2_000;
let lastProvider: string | null = null;
let lastErrorLoggedAt = 0;

function parsePositive(raw: unknown): number | null {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
}

async function fetchFromBinance(timeout = 4_000): Promise<number | null> {
    const r = await axios.get<{ price?: string }>('https://api.binance.com/api/v3/ticker/price', {
        params: { symbol: 'BTCUSDT' },
        timeout,
    });
    return parsePositive(r.data?.price);
}

async function fetchFromCoinbase(timeout = 4_000): Promise<number | null> {
    const r = await axios.get<{ data?: { amount?: string } }>('https://api.coinbase.com/v2/prices/BTC-USD/spot', {
        timeout,
    });
    return parsePositive(r.data?.data?.amount);
}

async function fetchFromKraken(timeout = 4_000): Promise<number | null> {
    const r = await axios.get<{
        result?: Record<string, { c?: [string, ...string[]] }>;
    }>('https://api.kraken.com/0/public/Ticker', {
        params: { pair: 'XBTUSD' },
        timeout,
    });
    const pair = r.data?.result?.XXBTZUSD ?? r.data?.result?.XBTUSD;
    return parsePositive(pair?.c?.[0]);
}

async function fetchFromCoingecko(timeout = 4_000): Promise<number | null> {
    const r = await axios.get<{ bitcoin?: { usd?: number } }>('https://api.coingecko.com/api/v3/simple/price', {
        params: { ids: 'bitcoin', vs_currencies: 'usd' },
        timeout,
    });
    return parsePositive(r.data?.bitcoin?.usd);
}

const PROVIDERS: Array<{ name: string; fetcher: () => Promise<number | null> }> = [
    { name: 'binance', fetcher: () => fetchFromBinance() },
    { name: 'coinbase', fetcher: () => fetchFromCoinbase() },
    { name: 'kraken', fetcher: () => fetchFromKraken() },
    { name: 'coingecko', fetcher: () => fetchFromCoingecko() },
];

export async function fetchBtcUsdPrice(opts?: { forceRefresh?: boolean }): Promise<number | null> {
    const now = Date.now();
    if (
        !opts?.forceRefresh &&
        cachedPrice !== null &&
        now - cachedAtMs < CACHE_TTL_MS
    ) {
        return cachedPrice;
    }
    try {
        const preferredFirst = [...PROVIDERS].sort((a, b) =>
            a.name === lastProvider ? -1 : b.name === lastProvider ? 1 : 0
        );
        for (const p of preferredFirst) {
            try {
                const v = await p.fetcher();
                if (v != null) {
                    cachedPrice = v;
                    cachedAtMs = now;
                    lastProvider = p.name;
                    return v;
                }
            } catch {
                // Try next provider.
            }
        }
        const shouldLog = now - lastErrorLoggedAt > 60_000;
        if (shouldLog) {
            lastErrorLoggedAt = now;
            console.warn('[BTC] Spot feed unavailable across providers (Binance/Coinbase/Kraken/CoinGecko).');
        }
        return cachedPrice;
    } catch {
        return cachedPrice;
    }
}
