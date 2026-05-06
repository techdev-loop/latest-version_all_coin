/**
 * Browser bundle entry: exposes strategy helpers on window for local HTML testing.
 * Build: npm run build:harness
 */
import type {
    StrategyConfig,
    OrderBookSnapshot,
    StrategyDecision,
    StrategyDecisionContext,
} from '../interfaces/strategyInterfaces';
import {
    decide,
    createEmptyWindowState,
    recomputeWindowDerivedFields,
    orderBookFromClob,
    updateWindowStateFromFill,
} from '../services/hedgeStrategy';

export type PolymarketStrategyHarnessApi = {
    decide: typeof decide;
    createEmptyWindowState: typeof createEmptyWindowState;
    recomputeWindowDerivedFields: typeof recomputeWindowDerivedFields;
    orderBookFromClob: typeof orderBookFromClob;
    updateWindowStateFromFill: typeof updateWindowStateFromFill;
    parseConfig(jsonText: string): StrategyConfig;
    buildSymmetricBooks(
        yesBid: number,
        yesAsk: number,
        noBid: number,
        noAsk: number,
        yesTokenId?: string,
        noTokenId?: string
    ): { bookYes: OrderBookSnapshot; bookNo: OrderBookSnapshot };
    /** Default demo books + empty inventory → logs decision to console. */
    runSample(config: StrategyConfig, ctx?: Partial<StrategyDecisionContext>): StrategyDecision;
};

function parseConfig(jsonText: string): StrategyConfig {
    return JSON.parse(jsonText) as StrategyConfig;
}

function buildSymmetricBooks(
    yesBid: number,
    yesAsk: number,
    noBid: number,
    noAsk: number,
    yesTokenId = 'yes-token-demo',
    noTokenId = 'no-token-demo'
): { bookYes: OrderBookSnapshot; bookNo: OrderBookSnapshot } {
    const bookYes: OrderBookSnapshot = {
        tokenId: yesTokenId,
        side: 'YES',
        bids: [{ price: yesBid, size: 50_000 }],
        asks: [{ price: yesAsk, size: 50_000 }],
        bestBid: yesBid,
        bestAsk: yesAsk,
    };
    const bookNo: OrderBookSnapshot = {
        tokenId: noTokenId,
        side: 'NO',
        bids: [{ price: noBid, size: 50_000 }],
        asks: [{ price: noAsk, size: 50_000 }],
        bestBid: noBid,
        bestAsk: noAsk,
    };
    return { bookYes, bookNo };
}

function runSample(
    config: StrategyConfig,
    ctx?: Partial<StrategyDecisionContext>
): StrategyDecision {
    const state = createEmptyWindowState(
        'browser-harness',
        'condition-demo',
        new Date().toISOString(),
        { yesTokenId: 'yes-token-demo', noTokenId: 'no-token-demo' }
    );
    const { bookYes, bookNo } = buildSymmetricBooks(0.48, 0.52, 0.47, 0.53);
    const fullCtx: StrategyDecisionContext = {
        secondsLeft: ctx?.secondsLeft ?? 400,
        roundsThisWindow: ctx?.roundsThisWindow ?? 2,
        lastExecutedSide: ctx?.lastExecutedSide ?? 'YES',
        availableBalanceUsd: ctx?.availableBalanceUsd,
        btcUsdDeltaFromWindowOpen: ctx?.btcUsdDeltaFromWindowOpen,
    };
    const d = decide(config, state, bookYes, bookNo, undefined, fullCtx);
    console.log('[PolymarketStrategyHarness] sample decision:', d);
    return d;
}

const api: PolymarketStrategyHarnessApi = {
    decide,
    createEmptyWindowState,
    recomputeWindowDerivedFields,
    orderBookFromClob,
    updateWindowStateFromFill,
    parseConfig,
    buildSymmetricBooks,
    runSample,
};

declare global {
    interface Window {
        PolymarketStrategyHarness: PolymarketStrategyHarnessApi;
    }
}

window.PolymarketStrategyHarness = api;

export default api;
