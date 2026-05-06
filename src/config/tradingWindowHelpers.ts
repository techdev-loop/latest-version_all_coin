/** True when `secondsLeft` is inside the configured soft-stop band; `stop === 0` disables it. */
export function inStopTradingSecondsBeforeEndWindow(
    secondsLeft: number,
    stopTradingSecondsBeforeEnd: number
): boolean {
    return stopTradingSecondsBeforeEnd > 0 && secondsLeft <= stopTradingSecondsBeforeEnd;
}
