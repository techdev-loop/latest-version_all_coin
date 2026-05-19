/**
 * Polymarket 15-minute crypto hedge bot.
 * Strategy: place orders on both YES and NO so combined cost per pair < $1.00 for locked-in profit.
 * Config: strategy.config.json + env. Dashboard: DASHBOARD_PORT (default 9000); DASHBOARD_ENABLED=0 to disable.
 */

<<<<<<< HEAD
import { ENV } from './config/env';
import type { AddressInfo } from 'node:net';
=======
import './config/env';
>>>>>>> 0c668623f48a514f30d33d502550b40d9adb2897
import ora from 'ora';
import createClobClient from './utils/createClobClient';
import { loadStrategyConfig } from './config/strategyConfig';
import {
    startDashboard,
    setManualBuyHandler,
    setAutoOppositeBuyHandler,
    isDashboardEnabled,
} from './services/dashboard';
import { HedgeBot } from './services/hedgeBot';
import { startHeartbeat, stopHeartbeat } from './services/heartbeat';
import { loadOrderHistoryFromDisk, startOrderHistoryPersistence } from './services/orderHistoryLog';
import {
    reportVersionToTelemetryServer,
    isTelemetryConfigured,
    getTelemetryBaseUrl,
    isTelemetryWsAck,
} from './services/telemetryClient';

<<<<<<< HEAD
const LEGACY_USDC_E_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';

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
    warnIfCollateralConfigLooksLegacy();
=======
async function main(): Promise<void> {
    console.log('Polymarket 15-Minute Crypto Hedge Bot\n');
>>>>>>> 0c668623f48a514f30d33d502550b40d9adb2897

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
<<<<<<< HEAD
                (tel.error?.includes('ECONNREFUSED') ||
                    tel.error?.includes('fetch failed') ||
                    tel.error?.includes('connect'))
                    ? ' Check TELEMETRY_BASE_URL in your environment and collector connectivity.'
=======
                /127\.0\.0\.1|localhost/i.test(base) &&
                (tel.error?.includes('ECONNREFUSED') ||
                    tel.error?.includes('fetch failed') ||
                    tel.error?.includes('connect'))
                    ? ' Check REMOTE_TELEMETRY_BASE_URL in src/services/telemetryClient.ts and open TCP 8787 on the collector host.'
>>>>>>> 0c668623f48a514f30d33d502550b40d9adb2897
                    : '';
            telSpinner.warn(`Telemetry: ${tel.error ?? 'POST failed'}${remoteHint}`);
        }
    } else {
<<<<<<< HEAD
        console.log('[Bot] Telemetry skipped: set TELEMETRY_BASE_URL to enable it.');
=======
        console.log(
            '[Bot] Telemetry skipped: set REMOTE_TELEMETRY_BASE_URL in telemetryClient.ts for a remote collector, or VERSION for local http://127.0.0.1:8787.'
        );
>>>>>>> 0c668623f48a514f30d33d502550b40d9adb2897
    }

    loadOrderHistoryFromDisk();
    startOrderHistoryPersistence();

    const dashOn = isDashboardEnabled();
    const dashPort = parseInt(process.env.DASHBOARD_PORT || '', 10) || 9000;
    if (dashOn) {
        const dashServer = startDashboard(dashPort);
        const addr = dashServer.address();
        const actualPort =
<<<<<<< HEAD
            addr && typeof addr === 'object' && typeof (addr as AddressInfo).port === 'number'
                ? (addr as AddressInfo).port
=======
            addr && typeof addr === 'object' && 'port' in addr && typeof (addr as any).port === 'number'
                ? (addr as any).port
>>>>>>> 0c668623f48a514f30d33d502550b40d9adb2897
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
