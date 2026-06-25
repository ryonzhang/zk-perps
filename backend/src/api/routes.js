import { Router } from 'express';
import { oracle } from '../oracle/prices.js';
const getPrice = (symbol) => oracle.getPrice(symbol);

const router = Router();

// --- In-memory data stores ---

const markets = [
  { id: 'BTC-USD', baseAsset: 'BTC', quoteAsset: 'USD', tickSize: 0.5, stepSize: 0.001 },
  { id: 'ETH-USD', baseAsset: 'ETH', quoteAsset: 'USD', tickSize: 0.1, stepSize: 0.01 },
  { id: 'SOL-USD', baseAsset: 'SOL', quoteAsset: 'USD', tickSize: 0.01, stepSize: 0.1 },
];

const marketStats = new Map([
  ['BTC-USD', { volume24h: 1_240_000_000, openInterest: 320_000_000, fundingRate: 0.0001 }],
  ['ETH-USD', { volume24h: 480_000_000, openInterest: 95_000_000, fundingRate: -0.00005 }],
  ['SOL-USD', { volume24h: 62_000_000, openInterest: 18_000_000, fundingRate: 0.00015 }],
]);

// orders: Map<id, order>
const orders = new Map();
let nextOrderId = 1;

// positions: Map<positionId, position>
const positions = new Map();
let nextPositionId = 1;

// trades: Map<market, trade[]>
const tradesStore = new Map();

// funding history: Map<market, entry[]>
const fundingHistory = new Map();

// Seed some mock trades
for (const m of markets) {
  const trades = [];
  for (let i = 0; i < 50; i++) {
    const price = m.id === 'BTC-USD' ? 67000 : m.id === 'ETH-USD' ? 3500 : 160;
    trades.push({
      id: `t-${m.id}-${i}`,
      market: m.id,
      side: i % 3 === 0 ? 'sell' : 'buy',
      price: price + (Math.random() - 0.5) * price * 0.002,
      size: parseFloat((Math.random() * 2 + 0.01).toFixed(4)),
      timestamp: Date.now() - i * 30_000,
    });
  }
  tradesStore.set(m.id, trades);
}

// Seed some mock funding history
for (const m of markets) {
  const history = [];
  const stats = marketStats.get(m.id);
  for (let i = 0; i < 48; i++) {
    history.push({
      market: m.id,
      rate: stats.fundingRate * (1 + (Math.random() - 0.5) * 0.4),
      timestamp: Date.now() - i * 3_600_000,
    });
  }
  fundingHistory.set(m.id, history);
}

// Seed some mock positions
const seedWallet = '0xDEADBEEF000000000000000000000000DEADBEEF';
positions.set('pos-1', {
  id: 'pos-1',
  wallet: seedWallet,
  market: 'BTC-USD',
  side: 'long',
  size: 0.5,
  entryPrice: 65000,
  leverage: 10,
  margin: 3250,
  unrealizedPnl: 0,
  openedAt: Date.now() - 86_400_000,
});

// --- Helpers ---

function buildOrderBook(market) {
  const price = getPrice(market) ?? (market === 'BTC-USD' ? 67000 : market === 'ETH-USD' ? 3500 : 160);
  const bids = [];
  const asks = [];
  for (let i = 1; i <= 10; i++) {
    const spread = price * 0.0002 * i;
    bids.push({ price: parseFloat((price - spread).toFixed(2)), size: parseFloat((Math.random() * 5 + 0.1).toFixed(4)) });
    asks.push({ price: parseFloat((price + spread).toFixed(2)), size: parseFloat((Math.random() * 5 + 0.1).toFixed(4)) });
  }
  return { market, bids, asks, timestamp: Date.now() };
}

// --- Routes ---

// GET /api/markets
router.get('/markets', (req, res) => {
  const result = markets.map((m) => {
    const stats = marketStats.get(m.id) ?? {};
    const markPrice = getPrice(m.id) ?? null;
    return {
      ...m,
      markPrice,
      volume24h: stats.volume24h,
      openInterest: stats.openInterest,
      fundingRate: stats.fundingRate,
    };
  });
  res.json({ markets: result });
});

// GET /api/orderbook/:market
router.get('/orderbook/:market', (req, res) => {
  const { market } = req.params;
  if (!marketStats.has(market)) {
    return res.status(404).json({ error: 'Market not found' });
  }
  res.json(buildOrderBook(market));
});

// GET /api/trades/:market
router.get('/trades/:market', (req, res) => {
  const { market } = req.params;
  if (!marketStats.has(market)) {
    return res.status(404).json({ error: 'Market not found' });
  }
  const trades = tradesStore.get(market) ?? [];
  res.json({ market, trades: trades.slice(0, 50) });
});

// POST /api/orders
router.post('/orders', (req, res) => {
  const { market, side, size, price, type = 'limit', zkProof } = req.body ?? {};
  if (!market || !side || !size) {
    return res.status(400).json({ error: 'market, side, and size are required' });
  }
  if (!marketStats.has(market)) {
    return res.status(404).json({ error: 'Market not found' });
  }
  if (!['buy', 'sell'].includes(side)) {
    return res.status(400).json({ error: 'side must be buy or sell' });
  }
  if (!['limit', 'market'].includes(type)) {
    return res.status(400).json({ error: 'type must be limit or market' });
  }
  if (type === 'limit' && !price) {
    return res.status(400).json({ error: 'price is required for limit orders' });
  }

  const id = `order-${nextOrderId++}`;
  const order = {
    id,
    market,
    side,
    size: parseFloat(size),
    price: price ? parseFloat(price) : null,
    type,
    status: 'open',
    zkProofAttached: !!zkProof,
    createdAt: Date.now(),
  };
  orders.set(id, order);

  // Mock fill for market orders
  if (type === 'market') {
    order.status = 'filled';
    order.fillPrice = getPrice(market) ?? order.price;
    order.filledAt = Date.now();
  }

  res.status(201).json({ order });
});

// DELETE /api/orders/:id
router.delete('/orders/:id', (req, res) => {
  const { id } = req.params;
  const order = orders.get(id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }
  if (order.status !== 'open') {
    return res.status(409).json({ error: `Order cannot be cancelled (status: ${order.status})` });
  }
  order.status = 'cancelled';
  order.cancelledAt = Date.now();
  orders.set(id, order);
  res.json({ order });
});

// GET /api/positions/:wallet
router.get('/positions/:wallet', (req, res) => {
  const { wallet } = req.params;
  const walletPositions = [];
  for (const pos of positions.values()) {
    if (pos.wallet.toLowerCase() === wallet.toLowerCase() && pos.status !== 'closed') {
      const markPrice = getPrice(pos.market) ?? pos.entryPrice;
      const priceDiff = pos.side === 'long' ? markPrice - pos.entryPrice : pos.entryPrice - markPrice;
      const unrealizedPnl = parseFloat((priceDiff * pos.size).toFixed(2));
      walletPositions.push({ ...pos, markPrice, unrealizedPnl });
    }
  }
  res.json({ wallet, positions: walletPositions });
});

// POST /api/positions/close
router.post('/positions/close', (req, res) => {
  const { positionId, wallet } = req.body ?? {};
  if (!positionId || !wallet) {
    return res.status(400).json({ error: 'positionId and wallet are required' });
  }
  const pos = positions.get(positionId);
  if (!pos) {
    return res.status(404).json({ error: 'Position not found' });
  }
  if (pos.wallet.toLowerCase() !== wallet.toLowerCase()) {
    return res.status(403).json({ error: 'Wallet does not own this position' });
  }
  if (pos.status === 'closed') {
    return res.status(409).json({ error: 'Position already closed' });
  }
  const markPrice = getPrice(pos.market) ?? pos.entryPrice;
  const priceDiff = pos.side === 'long' ? markPrice - pos.entryPrice : pos.entryPrice - markPrice;
  const realizedPnl = parseFloat((priceDiff * pos.size).toFixed(2));
  pos.status = 'closed';
  pos.closedAt = Date.now();
  pos.exitPrice = markPrice;
  pos.realizedPnl = realizedPnl;
  positions.set(positionId, pos);
  res.json({ position: pos });
});

// GET /api/funding/:market
router.get('/funding/:market', (req, res) => {
  const { market } = req.params;
  if (!marketStats.has(market)) {
    return res.status(404).json({ error: 'Market not found' });
  }
  const history = fundingHistory.get(market) ?? [];
  res.json({ market, history });
});

// POST /api/proof/verify
router.post('/proof/verify', (req, res) => {
  const { proof, publicInputs } = req.body ?? {};
  setTimeout(() => {
    res.json({
      verified: true,
      proof: proof ?? null,
      publicInputs: publicInputs ?? null,
      verifiedAt: Date.now(),
    });
  }, 200);
});

// GET /api/stats
router.get('/stats', (req, res) => {
  let totalVolume = 0;
  let totalOI = 0;
  for (const stats of marketStats.values()) {
    totalVolume += stats.volume24h;
    totalOI += stats.openInterest;
  }

  const traderSet = new Set();
  for (const pos of positions.values()) {
    traderSet.add(pos.wallet.toLowerCase());
  }

  res.json({
    totalVolume24h: totalVolume,
    totalOpenInterest: totalOI,
    numTraders: traderSet.size,
    numMarkets: markets.length,
    timestamp: Date.now(),
  });
});

export default router;
