/**
 * Authoritative BUY trade history from Polymarket CLOB (authenticated getTrades).
 * Used for dashboard display and cross-checking internal fill reconciliation.
 */

<<<<<<< HEAD
import type { ClobClient } from '@polymarket/clob-client-v2';
import { Side } from '@polymarket/clob-client-v2';
=======
import type { ClobClient } from '@polymarket/clob-client';
import { Side } from '@polymarket/clob-client';
>>>>>>> 0c668623f48a514f30d33d502550b40d9adb2897
import type { ActiveMarket } from '../interfaces/strategyInterfaces';

export interface LiveVerifiedBuyTrade {
    tradeId: string;
    orderId: string;
    timestampIso: string;
    side: 'YES' | 'NO';
    size: number;
    price: number;
    costUsd: number;
    assetId: string;
}

function parseMatchTimeToIso(matchTime: string): string {
    const n = Number(matchTime);
    if (Number.isFinite(n)) {
        if (n > 1e15) return new Date(n / 1e6).toISOString();
        if (n > 1e12) return new Date(n).toISOString();
        if (n > 1e9) return new Date(n * 1000).toISOString();
    }
    const d = Date.parse(matchTime);
    if (Number.isFinite(d)) return new Date(d).toISOString();
    return new Date().toISOString();
}

/**
 * All BUY trades for this market (condition), both YES and NO outcome tokens.
 * Paginates until the API returns no further cursor.
 */
export async function fetchClobBuyTradesForMarket(
    client: ClobClient,
    market: ActiveMarket
): Promise<LiveVerifiedBuyTrade[]> {
    const conditionId = market.conditionId;
    const yesId = market.yesTokenId;
    const noId = market.noTokenId;
    const collected: LiveVerifiedBuyTrade[] = [];
    const seen = new Set<string>();

<<<<<<< HEAD
    /** CLOB pagination end marker (see @polymarket/clob-client-v2 constants). */
=======
    /** CLOB pagination end marker (see @polymarket/clob-client constants). */
>>>>>>> 0c668623f48a514f30d33d502550b40d9adb2897
    const END_CURSOR = 'LTE=';
    let nextCursor: string | undefined;
    const maxPages = 40;

    for (let page = 0; page < maxPages; page++) {
        const res = await client.getTradesPaginated({ market: conditionId }, nextCursor);
        const batch = res?.trades ?? [];
        const nc = (res as { next_cursor?: string }).next_cursor;
        for (const t of batch) {
            if (!t || t.side !== Side.BUY) continue;
            const aid = t.asset_id;
            if (aid !== yesId && aid !== noId) continue;
            if (seen.has(t.id)) continue;
            seen.add(t.id);
            const size = parseFloat(t.size || '0');
            const price = parseFloat(t.price || '0');
            if (!(size > 0) || !Number.isFinite(price)) continue;
            collected.push({
                tradeId: t.id,
                orderId: t.taker_order_id || '',
                timestampIso: parseMatchTimeToIso(t.match_time),
                side: aid === yesId ? 'YES' : 'NO',
                size,
                price,
                costUsd: size * price,
                assetId: aid,
            });
        }
        if (!nc || nc === END_CURSOR || nc === nextCursor) break;
        nextCursor = nc;
    }

    collected.sort(
        (a, b) => new Date(a.timestampIso).getTime() - new Date(b.timestampIso).getTime()
    );
    return collected;
}
