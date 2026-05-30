import axios from 'axios';

async function run() {
    const r = await axios.get('https://gamma-api.polymarket.com/markets', {
        params: {
            seriesSlug: 'btc-up-or-down-5m',
            active: true,
            closed: false
        }
    });
    const market = r.data[0];
    if (!market) {
        console.log("No active market found");
        return;
    }
    console.log("Active Market:", JSON.stringify(market, null, 2));
}
run().catch(console.error);
