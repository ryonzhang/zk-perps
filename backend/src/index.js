import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import routes from './api/routes.js';
import { oracle } from './oracle/prices.js';
import { MatchingEngine } from './engine/matcher.js';

const PORT = 3011;

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use('/api', routes);

const server = createServer(app);
const wss = new WebSocketServer({ server });

const engine = new MatchingEngine();

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(msg);
    }
  }
}

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function scheduleTradeEvent(ws) {
  const delay = getRandomInt(2000, 5000);
  return setTimeout(() => {
    if (ws.readyState !== 1) return;
    const prices = oracle.getAllPrices();
    const symbols = Object.keys(prices);
    const symbol = symbols[getRandomInt(0, symbols.length - 1)];
    const price = prices[symbol];
    const side = Math.random() > 0.5 ? 'buy' : 'sell';
    const size = (Math.random() * 2 + 0.01).toFixed(4);
    const trade = {
      type: 'trade',
      symbol,
      price: price.toFixed(2),
      size,
      side,
      timestamp: Date.now(),
    };
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(trade));
    }
    ws._tradeTimeout = scheduleTradeEvent(ws);
  }, delay);
}

wss.on('connection', (ws) => {
  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      }
    } catch {
      // ignore malformed messages
    }
  });

  ws.on('close', () => {
    if (ws._tradeTimeout) clearTimeout(ws._tradeTimeout);
    if (ws._priceInterval) clearInterval(ws._priceInterval);
    if (ws._orderbookInterval) clearInterval(ws._orderbookInterval);
  });

  // Send initial snapshot
  const initialPrices = oracle.getAllPrices();
  ws.send(JSON.stringify({ type: 'prices', data: initialPrices, timestamp: Date.now() }));

  const initialOrderbook = engine.getOrderBook('BTC-PERP');
  ws.send(JSON.stringify({ type: 'orderbook', data: initialOrderbook, timestamp: Date.now() }));

  // Price updates every 1s
  ws._priceInterval = setInterval(() => {
    if (ws.readyState !== 1) return;
    const prices = oracle.getAllPrices();
    ws.send(JSON.stringify({ type: 'prices', data: prices, timestamp: Date.now() }));
  }, 1000);

  // Orderbook updates every 500ms
  ws._orderbookInterval = setInterval(() => {
    if (ws.readyState !== 1) return;
    const orderbook = engine.getOrderBook('BTC-PERP');
    ws.send(JSON.stringify({ type: 'orderbook', data: orderbook, timestamp: Date.now() }));
  }, 500);

  // Random trade events every 2-5s
  ws._tradeTimeout = scheduleTradeEvent(ws);
});

// Heartbeat ping every 30s
const heartbeatInterval = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

oracle.startSimulation();
console.log('Price oracle started');

server.listen(PORT, () => {
  console.log(`ZK Perps Backend running on port ${PORT}`);
  console.log('WebSocket server ready');
});
