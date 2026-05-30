import { fetchGammaBtcUpDownWindowDetails } from './src/services/marketResolution';
async function run() {
    const res = await fetchGammaBtcUpDownWindowDetails('btc-updown-5m-1779735000');
    console.log(JSON.stringify(res, null, 2));
}
run().catch(console.error);
