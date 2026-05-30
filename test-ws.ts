import WebSocket from 'ws';

const wsUrl = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
const ws = new WebSocket(wsUrl);

const yes = "60844248226311945035758084905651973561613617423884387781143605740115796127034";
const no = "37245625067699427249023602166433671047864070605961849266444489971566776948902";

ws.on('open', () => {
    console.log("Connected to", wsUrl);
    
    ws.send(JSON.stringify({
        assets_ids: [yes, no],
        type: 'market',
        custom_feature_enabled: true
    }));
});

ws.on('message', (data) => {
    console.log("Msg:", data.toString());
});

ws.on('error', (err) => {
    console.log("Error:", err);
});

setTimeout(() => {
    ws.close();
}, 5000);
