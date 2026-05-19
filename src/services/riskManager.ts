/**
 * Risk controls: max position per window, kill switch, circuit breaker,
 * pending order exposure tracking, and max one-sided duration.
 */

import type { StrategyConfig } from '../interfaces/strategyInterfaces';
import type { WindowState } from '../interfaces/strategyInterfaces';

export interface RiskState {
    killSwitch: boolean;
    consecutiveOrderFailures: number;
    /** USD value of GTC orders placed but not yet filled/cancelled this window. */
    pendingExposureUsd: number;
    /** Timestamp (ms) when the bot first became one-sided this window (0 = not one-sided). */
    oneSidedSinceMs: number;
}

export function createInitialRiskState(config: StrategyConfig): RiskState {
    return {
        killSwitch: config.killSwitch,
        consecutiveOrderFailures: 0,
        pendingExposureUsd: 0,
        oneSidedSinceMs: 0,
    };
}

/** Check if we are allowed to place an order (risk checks) */
export function canPlaceOrder(
    config: StrategyConfig,
    riskState: RiskState,
    windowState: WindowState,
    additionalSpend: number
): { allowed: boolean; reason: string } {
    if (config.killSwitch || riskState.killSwitch) {
        return { allowed: false, reason: 'Kill switch is on' };
    }
    if (riskState.consecutiveOrderFailures >= config.circuitBreakerFailures) {
        return { allowed: false, reason: `Circuit breaker: ${riskState.consecutiveOrderFailures} consecutive failures` };
    }
    const totalWindowSpend = windowState.totalSpentUsd + additionalSpend + riskState.pendingExposureUsd;
    if (totalWindowSpend > config.maxPositionPerWindowUsd) {
        return {
            allowed: false,
            reason: `Max position per window exceeded (spent $${windowState.totalSpentUsd.toFixed(2)} + pending $${riskState.pendingExposureUsd.toFixed(2)} + new $${additionalSpend.toFixed(2)} = $${totalWindowSpend.toFixed(2)} > $${config.maxPositionPerWindowUsd})`,
        };
    }
    return { allowed: true, reason: 'OK' };
}

/** Record a successful order (reset circuit breaker) */
export function recordOrderSuccess(state: RiskState, spendUsd: number): RiskState {
    return {
        ...state,
        consecutiveOrderFailures: 0,
        pendingExposureUsd: Math.max(0, state.pendingExposureUsd - spendUsd),
    };
}

/** Record an order failure (increment circuit breaker) */
export function recordOrderFailure(state: RiskState): RiskState {
    return {
        ...state,
        consecutiveOrderFailures: state.consecutiveOrderFailures + 1,
    };
}

/** Add pending exposure when a GTC order is placed (before fill). */
export function addPendingExposure(state: RiskState, usd: number): RiskState {
    return { ...state, pendingExposureUsd: state.pendingExposureUsd + usd };
}

/** Remove pending exposure when a GTC order fills or is cancelled. */
export function removePendingExposure(state: RiskState, usd: number): RiskState {
    return { ...state, pendingExposureUsd: Math.max(0, state.pendingExposureUsd - usd) };
}

/** Reset circuit breaker and pending exposure (called on new window transitions) */
export function resetCircuitBreaker(state: RiskState): RiskState {
    return {
        ...state,
        consecutiveOrderFailures: 0,
        pendingExposureUsd: 0,
        oneSidedSinceMs: 0,
    };
}

/** Set kill switch on/off */
export function setKillSwitch(state: RiskState, on: boolean): RiskState {
    return { ...state, killSwitch: on };
}

/**
 * Update one-sided tracking. Call each tick with current inventory.
 * Returns updated state with oneSidedSinceMs set/cleared.
 */
export function updateOneSidedTracking(
    state: RiskState,
    qtyYes: number,
    qtyNo: number
): RiskState {
    const z = 1e-8;
    const isOneSided =
        (qtyYes > z && qtyNo <= z) || (qtyNo > z && qtyYes <= z);
    if (!isOneSided) {
        return state.oneSidedSinceMs !== 0
            ? { ...state, oneSidedSinceMs: 0 }
            : state;
    }
    if (state.oneSidedSinceMs === 0) {
        return { ...state, oneSidedSinceMs: Date.now() };
    }
    return state;
}

/**
 * Check whether the bot has been one-sided for too long and should force a taker hedge.
 * @param windowDurationSec  Total window length (e.g. 300 for 5m).
 * @param maxFraction  Max fraction of window allowed one-sided (e.g. 0.6 = 60%).
 */
export function shouldForceHedge(
    state: RiskState,
    windowDurationSec: number,
    maxFraction?: number
): boolean {
    if (state.oneSidedSinceMs <= 0) return false;
    const frac = maxFraction ?? 0.6;
    const maxMs = windowDurationSec * frac * 1000;
    return Date.now() - state.oneSidedSinceMs >= maxMs;
}
