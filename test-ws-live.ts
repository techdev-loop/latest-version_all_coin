import axios from 'axios';
import WebSocket from 'ws';

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
    const ids = JSON.parse(market.clobTokenIds);
    console.log("Live tokens:", ids);

    const wsUrl = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
    const ws = new WebSocket(wsUrl);
    ws.on('open', () => {
        const payload = {
            assets_ids: ids,
            type: 'market',
        };
        console.log("Sending:", payload);
        ws.send(JSON.stringify(payload));
    });
    ws.on('message', (d) => console.log("WS:", d.toString().slice(0, 150)));
    setTimeout(() => ws.close(), 6000);
}
run().catch(console.error);
