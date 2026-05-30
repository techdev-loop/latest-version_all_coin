import { fetchBtcUsdPrice } from './src/utils/btcSpotPrice';
async function run() {
    for (let i = 0; i < 2; i++) {
        const p = await fetchBtcUsdPrice({ forceRefresh: true });
        console.log(`Price: ${p}`);
        await new Promise(r => setTimeout(r, 2500));
    }
}
run().catch(console.error);
