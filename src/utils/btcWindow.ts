import type { StrategyConfig } from '../interfaces/strategyInterfaces';

export const BTC_WINDOW_5M_SEC = 300;
export const BTC_WINDOW_15M_SEC = 900;

/** Resolve configured window length (seconds). */
export function btcWindowDurationSec(config: StrategyConfig): number {
    return config.btcMarketWindowMinutes === 5 ? BTC_WINDOW_5M_SEC : BTC_WINDOW_15M_SEC;
}

/** Minutes label for slug (5 or 15). */
export function btcWindowMinutesLabel(config: StrategyConfig): 5 | 15 {
    return config.btcMarketWindowMinutes === 5 ? 5 : 15;
}
