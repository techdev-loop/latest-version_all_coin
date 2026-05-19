import * as path from 'path';
import * as dotenv from 'dotenv';

// Load project-root .env when cwd is not the repo (e.g. `node dist/index.js` from another folder).
const rootEnvPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: rootEnvPath });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function readRequired(name: string): string {
    const raw = process.env[name];
    const v = (raw ?? '').trim();
    if (!v) throw new Error(`${name} is not defined`);
    // Strip optional surrounding single/double quotes.
    if (
        (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
        (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
    ) {
        return v.slice(1, -1).trim();
    }
    return v;
}

<<<<<<< HEAD
function readOptional(name: string): string | undefined {
    const raw = process.env[name];
    if (raw == null) return undefined;
    const v = raw.trim();
    if (!v) return undefined;
    if (
        (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
        (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
    ) {
        const stripped = v.slice(1, -1).trim();
        return stripped || undefined;
    }
    return v;
}

=======
>>>>>>> 0c668623f48a514f30d33d502550b40d9adb2897
function normalizePrivateKey(pk: string): string {
    const v = pk.trim().replace(/^['"]|['"]$/g, '');
    if (!v) throw new Error('PRIVATE_KEY is not defined');
    return v.startsWith('0x') ? v : `0x${v}`;
}

const PUBLIC_ADDRESS = readRequired('PUBLIC_ADDRESS');
const PROXY_WALLET = readRequired('PROXY_WALLET');
const PRIVATE_KEY = normalizePrivateKey(readRequired('PRIVATE_KEY'));
const CLOB_HTTP_URL = readRequired('CLOB_HTTP_URL');
const CLOB_WS_URL = readRequired('CLOB_WS_URL');
const RPC_URL = readRequired('RPC_URL');
const WSS_URL = readRequired('WSS_URL');
<<<<<<< HEAD
const COLLATERAL_TOKEN_ADDRESS =
    readOptional('COLLATERAL_TOKEN_ADDRESS') ?? readRequired('USDC_CONTRACT_ADDRESS');
=======
const USDC_CONTRACT_ADDRESS = readRequired('USDC_CONTRACT_ADDRESS');
>>>>>>> 0c668623f48a514f30d33d502550b40d9adb2897
const POLYMARKET_CONTRACT_ADDRESS = readRequired('POLYMARKET_CONTRACT_ADDRESS');

export const ENV = {
    PUBLIC_ADDRESS,
    PROXY_WALLET,
    PRIVATE_KEY,
    CLOB_HTTP_URL,
    CLOB_WS_URL,
    RPC_URL,
    WSS_URL,
<<<<<<< HEAD
    COLLATERAL_TOKEN_ADDRESS,
    // Backward compatibility for older code/env files.
    USDC_CONTRACT_ADDRESS: COLLATERAL_TOKEN_ADDRESS,
=======
    USDC_CONTRACT_ADDRESS,
>>>>>>> 0c668623f48a514f30d33d502550b40d9adb2897
    POLYMARKET_CONTRACT_ADDRESS,
};
