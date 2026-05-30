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
    const ids = JSON.parse(r.data[0].clobTokenIds);

    const wsUrl = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
    const ws = new WebSocket(wsUrl);
    ws.on('open', () => {
        ws.send(JSON.stringify({ assets_ids: ids, type: 'market' }));
    });
    let c = 0;
    ws.on('message', (d) => {
        if (c++ < 3) {
            console.log("MSG:", JSON.stringify(JSON.parse(d.toString()), null, 2).slice(0, 500));
        }
    });
    setTimeout(() => ws.close(), 5000);
}
run().catch(console.error);
