import { EventEmitter } from 'events';

const MOCK_PRICES = {
  BTC: 67432.50,
  ETH: 3521.75,
  XLM: 0.4218,
  SOL: 178.34,
};

export class PriceOracle extends EventEmitter {
  constructor() {
    super();
    this._prices = { ...MOCK_PRICES };
    this._intervalId = null;
  }

  updatePrice(symbol, price) {
    this._prices[symbol] = price;
    this.emit('update', { symbol, price });
  }

  getPrice(symbol) {
    return this._prices[symbol] ?? null;
  }

  getAllPrices() {
    return { ...this._prices };
  }

  startSimulation() {
    if (this._intervalId !== null) return;

    this._intervalId = setInterval(() => {
      for (const symbol of Object.keys(this._prices)) {
        const drift = 1 + (Math.random() * 0.003 - 0.0015); // ±0.15%
        const newPrice = parseFloat((this._prices[symbol] * drift).toFixed(
          symbol === 'XLM' ? 6 : 2
        ));
        this._prices[symbol] = newPrice;
        this.emit('update', { symbol, price: newPrice });
      }
    }, 1000);
  }

  stopSimulation() {
    if (this._intervalId !== null) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }
}

export const oracle = new PriceOracle();
