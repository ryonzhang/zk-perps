// Order matching engine for ZK Perps
// Price-time priority, supports limit and market orders
// Markets: BTC-PERP, ETH-PERP, XLM-PERP, SOL-PERP

let nextOrderId = 1;

function generateOrderId() {
  return `ord-${Date.now()}-${nextOrderId++}`;
}

export class OrderBook {
  constructor(market) {
    this.market = market;
    this.bids = []; // sorted descending by price
    this.asks = []; // sorted ascending by price
    this.openInterest = 0;
  }

  getBestBid() {
    return this.bids.length > 0 ? this.bids[0] : null;
  }

  getBestAsk() {
    return this.asks.length > 0 ? this.asks[0] : null;
  }

  getSpread() {
    const bid = this.getBestBid();
    const ask = this.getBestAsk();
    if (!bid || !ask) return null;
    return ask.price - bid.price;
  }

  // Returns array of fills: { price, size, maker, taker }
  addOrder(order) {
    if (!order.id) order.id = generateOrderId();
    order.timestamp = order.timestamp || Date.now();
    order.remaining = order.remaining ?? order.size;

    const fills = [];

    if (order.side === 'buy') {
      this._matchAgainstAsks(order, fills);
      if (order.remaining > 0 && order.type !== 'market') {
        this._insertBid(order);
      }
    } else {
      this._matchAgainstBids(order, fills);
      if (order.remaining > 0 && order.type !== 'market') {
        this._insertAsk(order);
      }
    }

    return fills;
  }

  _matchAgainstAsks(buyOrder, fills) {
    while (this.asks.length > 0 && buyOrder.remaining > 0) {
      const ask = this.asks[0];
      if (buyOrder.type === 'limit' && buyOrder.price < ask.price) break;

      const fillSize = Math.min(buyOrder.remaining, ask.remaining);
      const fillPrice = ask.price;

      fills.push({ price: fillPrice, size: fillSize, maker: ask.id, taker: buyOrder.id });

      buyOrder.remaining -= fillSize;
      ask.remaining -= fillSize;
      this.openInterest += fillSize;

      if (ask.remaining === 0) this.asks.shift();
    }
  }

  _matchAgainstBids(sellOrder, fills) {
    while (this.bids.length > 0 && sellOrder.remaining > 0) {
      const bid = this.bids[0];
      if (sellOrder.type === 'limit' && sellOrder.price > bid.price) break;

      const fillSize = Math.min(sellOrder.remaining, bid.remaining);
      const fillPrice = bid.price;

      fills.push({ price: fillPrice, size: fillSize, maker: bid.id, taker: sellOrder.id });

      sellOrder.remaining -= fillSize;
      bid.remaining -= fillSize;
      this.openInterest += fillSize;

      if (bid.remaining === 0) this.bids.shift();
    }
  }

  _insertBid(order) {
    const idx = this.bids.findIndex(b => b.price < order.price || (b.price === order.price && b.timestamp > order.timestamp));
    if (idx === -1) this.bids.push(order);
    else this.bids.splice(idx, 0, order);
  }

  _insertAsk(order) {
    const idx = this.asks.findIndex(a => a.price > order.price || (a.price === order.price && a.timestamp > order.timestamp));
    if (idx === -1) this.asks.push(order);
    else this.asks.splice(idx, 0, order);
  }

  cancelOrder(orderId) {
    let idx = this.bids.findIndex(o => o.id === orderId);
    if (idx !== -1) { this.bids.splice(idx, 1); return true; }
    idx = this.asks.findIndex(o => o.id === orderId);
    if (idx !== -1) { this.asks.splice(idx, 1); return true; }
    return false;
  }

  _seedLiquidity(midPrice, tickSize, lotSize, levels = 10) {
    for (let i = 1; i <= levels; i++) {
      const bidPrice = parseFloat((midPrice - i * tickSize).toFixed(8));
      const askPrice = parseFloat((midPrice + i * tickSize).toFixed(8));
      const size = parseFloat((lotSize * (1 + Math.random())).toFixed(6));

      this.bids.push({ id: generateOrderId(), side: 'buy', type: 'limit', price: bidPrice, size, remaining: size, timestamp: Date.now() - i });
      this.asks.push({ id: generateOrderId(), side: 'sell', type: 'limit', price: askPrice, size, remaining: size, timestamp: Date.now() - i });
    }
    // bids already desc, asks already asc by construction
  }
}

const MARKET_CONFIG = {
  'BTC-PERP': { midPrice: 67000, tickSize: 10, lotSize: 0.01 },
  'ETH-PERP': { midPrice: 3500,  tickSize: 0.5, lotSize: 0.1  },
  'XLM-PERP': { midPrice: 0.12,  tickSize: 0.0001, lotSize: 100 },
  'SOL-PERP': { midPrice: 170,   tickSize: 0.1, lotSize: 1    },
};

export class MatchingEngine {
  constructor() {
    this.books = {};
    this.markPrices = {};
    this.fundingRates = {};

    for (const [market, cfg] of Object.entries(MARKET_CONFIG)) {
      const book = new OrderBook(market);
      book._seedLiquidity(cfg.midPrice, cfg.tickSize, cfg.lotSize);
      this.books[market] = book;
      this.markPrices[market] = cfg.midPrice;
      this.fundingRates[market] = 0.0001; // 0.01% base funding rate
    }
  }

  _getBook(market) {
    if (!this.books[market]) throw new Error(`Unknown market: ${market}`);
    return this.books[market];
  }

  matchOrder(order) {
    const book = this._getBook(order.market);
    const fills = book.addOrder(order);
    if (fills.length > 0) this._updateFundingRate(order.market);
    return fills;
  }

  cancelOrder(market, orderId) {
    return this._getBook(market).cancelOrder(orderId);
  }

  getMarkPrice(market) {
    return this.markPrices[market] ?? null;
  }

  updateMarkPrice(market, price) {
    this._getBook(market); // validate market
    this.markPrices[market] = price;
  }

  getFundingRate(market) {
    this._getBook(market);
    return this.fundingRates[market];
  }

  getOpenInterest(market) {
    return this._getBook(market).openInterest;
  }

  getSpread(market) {
    return this._getBook(market).getSpread();
  }

  getBestBid(market) {
    return this._getBook(market).getBestBid();
  }

  getBestAsk(market) {
    return this._getBook(market).getBestAsk();
  }

  getOrderBook(market) {
    const book = this._getBook(market);
    return {
      market,
      bids: book.bids.map(o => ({ price: o.price, size: o.remaining })),
      asks: book.asks.map(o => ({ price: o.price, size: o.remaining })),
      spread: book.getSpread(),
      markPrice: this.markPrices[market],
      fundingRate: this.fundingRates[market],
    };
  }

  _updateFundingRate(market) {
    const book = this._getBook(market);
    const bid = book.getBestBid();
    const ask = book.getBestAsk();
    if (!bid || !ask) return;
    const mid = (bid.price + ask.price) / 2;
    const mark = this.markPrices[market];
    // Simple funding: proportional to premium
    this.fundingRates[market] = parseFloat(((mid - mark) / mark * 0.01).toFixed(8));
  }
}
