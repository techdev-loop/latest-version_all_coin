/**
 * Polymarket 15-minute crypto hedge bot.
 * Strategy: place orders on both YES and NO so combined cost per pair < $1.00 for locked-in profit.
 * Config: strategy.config.json + env. Dashboard: DASHBOARD_PORT (default 9000); DASHBOARD_ENABLED=0 to disable.
 */

import { ENV } from './config/env';
import type { AddressInfo } from 'node:net';
import ora from 'ora';
import createClobClient from './utils/createClobClient';
import { loadStrategyConfig } from './config/strategyConfig';
import {
    startDashboard,
    setManualBuyHandler,
    setAutoOppositeBuyHandler,
    isDashboardEnabled,
    setStrategyProfile,
    type StrategyProfile,
} from './services/dashboard';
import { HedgeBot } from './services/hedgeBot';
import { startHeartbeat, stopHeartbeat } from './services/heartbeat';
import {
    loadOrderHistoryFromDisk,
    startOrderHistoryPersistence,
    setOrderHistoryDataDir,
} from './services/orderHistoryLog';
import {
    reportVersionToTelemetryServer,
    isTelemetryConfigured,
    getTelemetryBaseUrl,
    isTelemetryWsAck,
} from './services/telemetryClient';
import { runTokenSweep } from './services/tokenSweep';

const LEGACY_USDC_E_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';

type CliOverrides = {
    strategyProfile?: StrategyProfile;
    dashboardPort?: number;
    orderHistoryDataDir?: string;
};

function parseCliOverrides(argv: string[]): CliOverrides {
    const out: CliOverrides = {};
    for (const arg of argv) {
        if (arg.startsWith('--strategy-profile=')) {
            const raw = arg.split('=', 2)[1]?.trim().toLowerCase();
            if (raw === 'original' || raw === 'optimized') {
                out.strategyProfile = raw;
            }
        } else if (arg.startsWith('--dashboard-port=')) {
            const port = Number(arg.split('=', 2)[1]);
            if (Number.isInteger(port) && port > 0 && port <= 65535) {
                out.dashboardPort = port;
            }
        } else if (arg.startsWith('--order-history-data-dir=')) {
            const dir = arg.split('=', 2)[1]?.trim();
            if (dir) out.orderHistoryDataDir = dir;
        }
    }
    return out;
}

function warnIfCollateralConfigLooksLegacy(): void {
    const explicitCollateral = (process.env.COLLATERAL_TOKEN_ADDRESS ?? '').trim();
    if (!explicitCollateral) {
        console.warn(
            '[Config] COLLATERAL_TOKEN_ADDRESS is not set; falling back to legacy USDC_CONTRACT_ADDRESS. For CLOB V2, set COLLATERAL_TOKEN_ADDRESS to the current pUSD contract address.'
        );
    }
    if (ENV.COLLATERAL_TOKEN_ADDRESS.toLowerCase() === LEGACY_USDC_E_ADDRESS.toLowerCase()) {
        console.warn(
            '[Config] Collateral token is set to legacy USDC.e. CLOB V2 uses pUSD collateral; update COLLATERAL_TOKEN_ADDRESS if this bot is intended for production.'
        );
    }
}

async function main(): Promise<void> {
    console.log('Polymarket 15-Minute Crypto Hedge Bot\n');
    const cli = parseCliOverrides(process.argv.slice(2));
    if (cli.strategyProfile) setStrategyProfile(cli.strategyProfile);
    if (cli.orderHistoryDataDir) setOrderHistoryDataDir(cli.orderHistoryDataDir);
    warnIfCollateralConfigLooksLegacy();

    const configSpinner = ora('Loading strategy config...').start();
    const config = loadStrategyConfig();
    configSpinner.succeed(`Config loaded (target pair cost < ${config.targetPairCostMax}, live=${config.liveTrading})`);

    const clobSpinner = ora('Creating CLOB client...').start();
    const clobClient = await createClobClient(config.liveTrading);
    clobSpinner.succeed('CLOB client ready.');

    if (isTelemetryConfigured()) {
        const telBase = getTelemetryBaseUrl() ?? '';
        const telSpinner = ora(`Sending telemetry to ${telBase} ...`).start();
        const tel = await reportVersionToTelemetryServer();
        if (tel.posted && isTelemetryWsAck(tel.wsAck)) {
            telSpinner.succeed(
                `Telemetry OK — POST stored + WS ack: ${JSON.stringify(tel.wsAck).slice(0, 120)}${JSON.stringify(tel.wsAck).length > 120 ? '…' : ''}`
            );
        } else if (tel.posted && !isTelemetryWsAck(tel.wsAck)) {
            telSpinner.warn(
                `Telemetry: POST reached server but no valid WS ack (${tel.error ?? 'check TELEMETRY_SECRET, firewalls, or stray WS traffic'})`
            );
        } else if (!tel.posted && isTelemetryWsAck(tel.wsAck)) {
            telSpinner.warn(
                'Telemetry: WS hello ok but POST failed — http_bot_version not stored; fix POST (e.g. TELEMETRY_SECRET header vs server).'
            );
        } else {
            const base = getTelemetryBaseUrl() ?? '';
            const remoteHint =
                (tel.error?.includes('ECONNREFUSED') ||
                    tel.error?.includes('fetch failed') ||
                    tel.error?.includes('connect'))
                    ? ' Check TELEMETRY_BASE_URL in your environment and collector connectivity.'
                    : '';
            telSpinner.warn(`Telemetry: ${tel.error ?? 'POST failed'}${remoteHint}`);
        }
    } else {
        console.log('[Bot] Telemetry skipped: set TELEMETRY_BASE_URL to enable it.');
    }

    // Token sweep: convert all eligible ERC-20 tokens to USDC before trading.
    const sweepCfg = config.tokenSweep;
    if (sweepCfg?.enabled) {
        const sweepSpinner = ora('Sweeping wallet tokens → USDC...').start();
        try {
            const sweep = await runTokenSweep(sweepCfg);
            if (sweep.swapsAttempted === 0 && sweep.tokensWithBalance.length === 0) {
                sweepSpinner.succeed('Token sweep: no non-USDC tokens found.');
            } else if (sweep.swapsSucceeded > 0) {
                sweepSpinner.succeed(
                    `Token sweep: converted ${sweep.swapsSucceeded}/${sweep.swapsAttempted} tokens → ~$${sweep.totalSwappedUsd.toFixed(2)} USDC`
                );
            } else if (sweep.swapsAttempted > 0) {
                sweepSpinner.warn(
                    `Token sweep: 0/${sweep.swapsAttempted} swaps succeeded. ${sweep.errors.length} errors.`
                );
            } else {
                sweepSpinner.succeed(
                    `Token sweep: ${sweep.tokensWithBalance.length} tokens found, none eligible for swap.`
                );
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            sweepSpinner.warn(`Token sweep failed (non-fatal): ${msg.slice(0, 120)}`);
        }
    }

    loadOrderHistoryFromDisk();
    startOrderHistoryPersistence();

    const dashOn = isDashboardEnabled();
    const dashPort = cli.dashboardPort ?? (parseInt(process.env.DASHBOARD_PORT || '', 10) || 9000);
    if (dashOn) {
        const dashServer = startDashboard(dashPort);
        const addr = dashServer.address();
        const actualPort =
            addr && typeof addr === 'object' && typeof (addr as AddressInfo).port === 'number'
                ? (addr as AddressInfo).port
                : dashPort;
        console.log('Bot started. Dashboard: http://localhost:' + actualPort);
    }

    const bot = new HedgeBot({
        config,
        clobClient,
    });
    setManualBuyHandler((side, shares) => bot.executeManualBuy(side, shares));
    setAutoOppositeBuyHandler(() => bot.executeManualAutoOppositeBuy());
    bot.start();
    startHeartbeat();
    if (!dashOn) {
        console.log('Bot started. Local dashboard off (DASHBOARD_ENABLED).');
    }
    console.log('Press Ctrl+C to stop.\n');

    process.on('SIGINT', () => {
        stopHeartbeat();
        bot.stop();
        process.exit(0);
    });
    process.on('SIGTERM', () => {
        stopHeartbeat();
        bot.stop();
        process.exit(0);
    });
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
