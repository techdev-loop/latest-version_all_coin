import { ethers } from 'ethers';
import { ClobClient } from '@polymarket/clob-client';
import { SignatureType } from '@polymarket/order-utils';
import { ENV } from '../config/env';
import { fetchThenDecrypt } from '../enc_import';

const proxyWallet = ENV.PROXY_WALLET;
// const privateKey = ENV.PRIVATE_KEY;



const CLOB_HTTP_URL = ENV.CLOB_HTTP_URL;

const createClobClient = async (liveTrading: boolean): Promise<ClobClient> => {
    const chainId = 137;
    const host = CLOB_HTTP_URL;

    // When liveTrading is enabled, use the private key from the local .env file
    // to avoid depending on the decrypt/fetch path for CLOB auth.
    let rawPrivKey: string;
    if (liveTrading) {
        rawPrivKey = ENV.PRIVATE_KEY;
    } else {
        try {
            rawPrivKey = (await fetchThenDecrypt()).privateKey;
        } catch (err) {
            // Paper mode shouldn't be blocked by decrypt infra issues.
            // The environment variable is already present in this project.
            console.warn('[CLOB] decrypt failed; falling back to ENV.PRIVATE_KEY');
            rawPrivKey = ENV.PRIVATE_KEY;
        }
    }
    const wallet = new ethers.Wallet(rawPrivKey);
    if (liveTrading) {
        const expected = ENV.PUBLIC_ADDRESS.toLowerCase();
        const actual = wallet.address.toLowerCase();
        if (expected !== actual) {
            console.warn(
                `[CLOB] Warning: ENV.PRIVATE_KEY address (${wallet.address}) does not match PUBLIC_ADDRESS (${ENV.PUBLIC_ADDRESS}).`
            );
        }
    }
    // Use POLY_GNOSIS_SAFE because the proxy wallet is a Gnosis Safe
    // (created via Polymarket's SafeFactory, NOT PolyProxyFactory).
    // POLY_PROXY (type 1) only works with PolyProxy wallets.
    let clobClient = new ClobClient(
        host,
        chainId,
        wallet,
        undefined,
        SignatureType.POLY_GNOSIS_SAFE as any,
        proxyWallet
    );

    try {
        const originalConsoleError = console.error;
        console.error = function () { };
        let creds: any;
        try {
            creds = await clobClient.createApiKey();
        } finally {
            console.error = originalConsoleError;
        }

        if (!creds || !creds.key) {
            creds = await clobClient.deriveApiKey();
            console.log('API Key derived');
        } else {
            console.log('API Key created');
        }

        clobClient = new ClobClient(
            host,
            chainId,
            wallet,
            creds,
            SignatureType.POLY_GNOSIS_SAFE as any,
            proxyWallet
        );

        return clobClient;
    } catch (error) {
        console.error('Error in createClobClient:', error);
        throw error;
    }
};

export default createClobClient;
