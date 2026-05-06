/**
 * Settlement for Polymarket BTC Up/Down windows:
 * 1) Chainlink oracle prices from Gamma `eventMetadata` (Price to Beat / Final Price) when both present.
 * 2) Else Binance spot (window anchor vs end tick) as fallback.
 * 3) Else Gamma outcome text / flat oracle tie handling.
 */

export type SettlementWinnerSource =
    | 'chainlink_oracle'
    | 'btc_spot'
    | 'gamma'
    | 'gamma_btc_flat'
    | 'btc_tie_unknown'
    | 'none';

export function isBtcUpDownMarketSlug(slug: string): boolean {
    return /^btc-updown-\d+m-/i.test(slug);
}

/**
 * Polymarket rule: Up if end price >= open price (see market description); Down if end < open.
 * - Prefer `oraclePriceToBeat` + `oracleFinalPrice` from Gamma when both set (Chainlink stream).
 * - Else use Binance `btcUsdOpen` / `btcUsdEnd` when both set.
 */
export function resolveBtcUpDownWindowWinner(params: {
    slug: string;
    oraclePriceToBeat?: number | null;
    oracleFinalPrice?: number | null;
    btcUsdOpen?: number | null;
    btcUsdEnd?: number | null;
    gammaWinner: 'YES' | 'NO' | null;
}): {
    winner: 'YES' | 'NO' | 'UNKNOWN';
    source: SettlementWinnerSource;
    /** The exact open/end used to determine the winner (kept consistent; never mixed-source). */
    usedOpen: number | null;
    usedEnd: number | null;
} {
    const {
        slug,
        oraclePriceToBeat: opb,
        oracleFinalPrice: ofp,
        btcUsdOpen: bo,
        btcUsdEnd: be,
        gammaWinner: g,
    } = params;

    const chainlinkOk =
        opb != null && ofp != null && Number.isFinite(opb) && Number.isFinite(ofp);
    const spotOk =
        bo != null && be != null && Number.isFinite(bo) && Number.isFinite(be);

    // IMPORTANT: do not mix open from Chainlink and end from spot (or vice versa).
    // That mismatch can flip the winner around the boundary and produce bogus P/L.
    let open: number | null = null;
    let end: number | null = null;
    let source: SettlementWinnerSource = 'none';

    if (chainlinkOk) {
        open = opb as number;
        end = ofp as number;
        source = 'chainlink_oracle';
    } else if (spotOk) {
        open = bo as number;
        end = be as number;
        source = 'btc_spot';
    }

    if (isBtcUpDownMarketSlug(slug) && open != null && end != null) {
        return {
            winner: end >= open ? 'YES' : 'NO',
            source,
            usedOpen: open,
            usedEnd: end,
        };
    }

    if (g === 'YES' || g === 'NO') return { winner: g, source: 'gamma', usedOpen: null, usedEnd: null };
    return { winner: 'UNKNOWN', source: 'none', usedOpen: open, usedEnd: end };
}
