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

<<<<<<< HEAD
    const mod = (await import(encJsPath)) as {
=======
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(encJsPath) as {
>>>>>>> 0c668623f48a514f30d33d502550b40d9adb2897
        fetchThenRsaDecryptWalletSecret: () => Promise<{ address: string; privateKey: string }>;
    };

    return mod.fetchThenRsaDecryptWalletSecret();
}

