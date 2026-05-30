import WebSocket from 'ws';

const wsUrl = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';

function testPayload(payload: any, label: string) {
    const ws = new WebSocket(wsUrl);
    ws.on('open', () => {
        ws.send(JSON.stringify(payload));
    });
    ws.on('message', (data) => {
        const msg = data.toString();
        if (!msg.includes('new_market')) {
            console.log(`[${label}] Msg:`, msg.slice(0, 200));
        }
    });
    setTimeout(() => ws.close(), 3000);
}

const yes = "60844248226311945035758084905651973561613617423884387781143605740115796127034";
const no = "37245625067699427249023602166433671047864070605961849266444489971566776948902";

testPayload({ assets_ids: [yes, no], type: 'MARKET' }, "UPPERCASE_MARKET");
testPayload({ asset_ids: [yes, no], type: 'market' }, "ASSET_IDS_LOWER");
