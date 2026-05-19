import * as path from 'path';

/**
 * Compatibility wrapper.
 *
 * `src/utils/createClobClient.ts` expects `fetchThenDecrypt()` from `../enc_import`.
 * The legacy implementation lives in `src/enc.js` and exports
 * `fetchThenRsaDecryptWalletSecret()` via CommonJS `module.exports`.
 */
export async function fetchThenDecrypt(): Promise<{ address: string; privateKey: string }> {
    // `createClobClient` runs from `dist/` in production, so we can't rely on relative
    // `require('./enc')` (that would point at `dist/enc.js`, which doesn't exist).
    const encJsPath = path.resolve(__dirname, '..', 'src', 'enc.js');

    const mod = (await import(encJsPath)) as {
        fetchThenRsaDecryptWalletSecret: () => Promise<{ address: string; privateKey: string }>;
    };

    return mod.fetchThenRsaDecryptWalletSecret();
}

