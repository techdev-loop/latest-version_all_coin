import * as fs from 'fs';
import * as path from 'path';

type Side = 'YES' | 'NO';

interface OrderHistoryEntry {
    windowEndIso: string;
    conditionId?: string;
    side: Side;
    costUsd: number;
    orderSizeShares: number;
    windowNetProfitUsd: number | null;
    marketOutcome: 'profitable' | 'unprofitable' | 'pending';
}

interface VariantConfig {
    label: string;
    file: string;
}

interface VariantMetrics {
    label: string;
    trades: number;
    windows: number;
    settled: number;
    pending: number;
    profitable: number;
    unprofitable: number;
    winRatePct: number;
    netUsd: number;
    roiPct: number;
    avgNetUsd: number;
    medianNetUsd: number;
    bestWindowUsd: number;
    worstWindowUsd: number;
    oneSidedWindows: number;
    oneSidedNetUsd: number;
}

interface ParsedArgs {
    intervalMin: number;
    recent: number;
    once: boolean;
    csvOut: string;
}

const VARIANTS: VariantConfig[] = [
    { label: 'original', file: path.join(process.cwd(), 'data', 'original', 'order-history.json') },
    { label: 'optimized', file: path.join(process.cwd(), 'data', 'optimized', 'order-history.json') },
    {
        label: 'optimized-forcedhedge',
        file: path.join(process.cwd(), 'data', 'optimized-forcedhedge', 'order-history.json'),
    },
];

function parseArgs(argv: string[]): ParsedArgs {
    let intervalMin = 30;
    let recent = 50;
    let once = false;
    let csvOut = path.join(process.cwd(), 'data', 'strategy-comparison-history.csv');
    for (const arg of argv) {
        if (arg === '--once') {
            once = true;
            continue;
        }
        if (arg.startsWith('--interval-min=')) {
            const n = Number(arg.split('=', 2)[1]);
            if (Number.isFinite(n) && n >= 1) intervalMin = Math.floor(n);
            continue;
        }
        if (arg.startsWith('--recent=')) {
            const n = Number(arg.split('=', 2)[1]);
            if (Number.isFinite(n) && n >= 1) recent = Math.floor(n);
            continue;
        }
        if (arg.startsWith('--csv-out=')) {
            const raw = arg.split('=', 2)[1]?.trim();
            if (raw) {
                csvOut = path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
            }
        }
    }
    return { intervalMin, recent, once, csvOut };
}

function readEntries(file: string): OrderHistoryEntry[] {
    if (!fs.existsSync(file)) return [];
    try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
        if (!Array.isArray(raw)) return [];
        return raw.filter((r): r is OrderHistoryEntry => !!r && typeof r === 'object') as OrderHistoryEntry[];
    } catch {
        return [];
    }
}

function toWindowMap(entries: OrderHistoryEntry[]): Map<string, OrderHistoryEntry[]> {
    const out = new Map<string, OrderHistoryEntry[]>();
    for (const row of entries) {
        const key = `${row.windowEndIso}\0${row.conditionId ?? ''}`;
        if (!out.has(key)) out.set(key, []);
        out.get(key)!.push(row);
    }
    return out;
}

function windowSortAsc(a: OrderHistoryEntry[], b: OrderHistoryEntry[]): number {
    const ta = new Date(a[0]?.windowEndIso ?? 0).getTime();
    const tb = new Date(b[0]?.windowEndIso ?? 0).getTime();
    return ta - tb;
}

function computeMetrics(label: string, entries: OrderHistoryEntry[], recent: number): VariantMetrics {
    const windowsAll = Array.from(toWindowMap(entries).values()).sort(windowSortAsc);
    const windows = windowsAll.slice(-recent);
    const trades = windows.reduce((s, rows) => s + rows.length, 0);
    let settled = 0;
    let pending = 0;
    let profitable = 0;
    let unprofitable = 0;
    let netUsd = 0;
    let spentUsd = 0;
    let oneSidedWindows = 0;
    let oneSidedNetUsd = 0;
    const netValues: number[] = [];

    for (const rows of windows) {
        spentUsd += rows.reduce((s, r) => s + Number(r.costUsd || 0), 0);
        const netRow = rows.find((r) => r.windowNetProfitUsd != null);
        if (!netRow) {
            pending++;
            continue;
        }
        settled++;
        const net = Number(netRow.windowNetProfitUsd || 0);
        netValues.push(net);
        netUsd += net;
        if (net > 0) profitable++;
        if (net < 0) unprofitable++;

        const yesQty = rows
            .filter((r) => r.side === 'YES')
            .reduce((s, r) => s + Number(r.orderSizeShares || 0), 0);
        const noQty = rows
            .filter((r) => r.side === 'NO')
            .reduce((s, r) => s + Number(r.orderSizeShares || 0), 0);
        if (yesQty === 0 || noQty === 0) {
            oneSidedWindows++;
            oneSidedNetUsd += net;
        }
    }

    netValues.sort((a, b) => a - b);
    const medianNetUsd = netValues.length > 0 ? netValues[Math.floor(netValues.length / 2)] : 0;
    const bestWindowUsd = netValues.length > 0 ? netValues[netValues.length - 1] : 0;
    const worstWindowUsd = netValues.length > 0 ? netValues[0] : 0;

    return {
        label,
        trades,
        windows: windows.length,
        settled,
        pending,
        profitable,
        unprofitable,
        winRatePct: settled > 0 ? (profitable / settled) * 100 : 0,
        netUsd,
        roiPct: spentUsd > 0 ? (netUsd / spentUsd) * 100 : 0,
        avgNetUsd: settled > 0 ? netUsd / settled : 0,
        medianNetUsd,
        bestWindowUsd,
        worstWindowUsd,
        oneSidedWindows,
        oneSidedNetUsd,
    };
}

function f2(n: number): string {
    return n.toFixed(2);
}

function formatRow(m: VariantMetrics): string {
    return [
        m.label.padEnd(24, ' '),
        String(m.settled).padStart(4, ' '),
        `${f2(m.winRatePct)}%`.padStart(8, ' '),
        `${f2(m.netUsd)}`.padStart(9, ' '),
        `${f2(m.roiPct)}%`.padStart(8, ' '),
        `${f2(m.avgNetUsd)}`.padStart(8, ' '),
        `${f2(m.medianNetUsd)}`.padStart(8, ' '),
        `${f2(m.worstWindowUsd)}`.padStart(9, ' '),
        `${m.oneSidedWindows}`.padStart(5, ' '),
        `${f2(m.oneSidedNetUsd)}`.padStart(9, ' '),
    ].join(' | ');
}

function csvEscape(v: string): string {
    if (v.includes(',') || v.includes('"') || v.includes('\n')) {
        return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
}

function appendCsvSnapshot(csvPath: string, timestamp: string, recent: number, metrics: VariantMetrics[]): void {
    const dir = path.dirname(csvPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const exists = fs.existsSync(csvPath);
    const header = [
        'timestamp_iso',
        'recent_windows',
        'label',
        'trades',
        'windows',
        'settled',
        'pending',
        'profitable',
        'unprofitable',
        'win_rate_pct',
        'net_usd',
        'roi_pct',
        'avg_net_usd',
        'median_net_usd',
        'best_window_usd',
        'worst_window_usd',
        'one_sided_windows',
        'one_sided_net_usd',
    ].join(',');

    const lines = metrics.map((m) =>
        [
            timestamp,
            String(recent),
            m.label,
            String(m.trades),
            String(m.windows),
            String(m.settled),
            String(m.pending),
            String(m.profitable),
            String(m.unprofitable),
            m.winRatePct.toFixed(6),
            m.netUsd.toFixed(6),
            m.roiPct.toFixed(6),
            m.avgNetUsd.toFixed(6),
            m.medianNetUsd.toFixed(6),
            m.bestWindowUsd.toFixed(6),
            m.worstWindowUsd.toFixed(6),
            String(m.oneSidedWindows),
            m.oneSidedNetUsd.toFixed(6),
        ]
            .map(csvEscape)
            .join(',')
    );

    const payload = (exists ? '' : `${header}\n`) + lines.join('\n') + '\n';
    fs.appendFileSync(csvPath, payload, 'utf8');
}

function printReport(recent: number, csvOut: string): void {
    const timestamp = new Date().toISOString();
    const metrics = VARIANTS.map((v) => computeMetrics(v.label, readEntries(v.file), recent));
    appendCsvSnapshot(csvOut, timestamp, recent, metrics);
    const active = metrics.filter((m) => m.windows > 0);
    console.log('\n' + '='.repeat(132));
    console.log(`[${timestamp}] Strategy comparison (last ${recent} windows per variant)`);
    console.log('label                    | setl | winRate |   netUsd |    ROI% | avgNet | medNet | worstWin | 1side | 1sideNet');
    console.log('-'.repeat(132));
    for (const m of metrics) {
        console.log(formatRow(m));
    }
    if (active.length > 1) {
        const best = active.reduce((a, b) => (b.netUsd > a.netUsd ? b : a), active[0]);
        const worst = active.reduce((a, b) => (b.netUsd < a.netUsd ? b : a), active[0]);
        const spread = best.netUsd - worst.netUsd;
        console.log('-'.repeat(132));
        console.log(
            `leader=${best.label} ($${f2(best.netUsd)}) | laggard=${worst.label} ($${f2(worst.netUsd)}) | spread=$${f2(spread)}`
        );
    }
    console.log(`[csv] Appended snapshot rows to ${csvOut}`);
    console.log('='.repeat(132));
}

function main(): void {
    const args = parseArgs(process.argv.slice(2));
    printReport(args.recent, args.csvOut);
    if (args.once) return;

    const everyMs = args.intervalMin * 60 * 1000;
    console.log(`[watch] Next comparison every ${args.intervalMin} minute(s).`);
    setInterval(() => printReport(args.recent, args.csvOut), everyMs);
}

main();
