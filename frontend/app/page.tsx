'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
type Market = 'BTC-PERP' | 'ETH-PERP' | 'XLM-PERP' | 'SOL-PERP';
type Side = 'Long' | 'Short';

interface TickerData {
  markPrice: number;
  change24h: number;
  volume24h: number;
  openInterest: number;
  fundingRate: number;
}

interface OrderBookRow {
  price: number;
  size: number;
  total: number;
}

interface Trade {
  id: number;
  side: 'Buy' | 'Sell';
  price: number;
  size: number;
  time: string;
}

interface Position {
  id: number;
  market: Market;
  side: Side;
  size: number;
  entry: number;
  mark: number;
  pnlPct: number;
  collateral: number;
}

interface ZkProof {
  id: number;
  timestamp: string;
  market: Market;
  hash: string;
  status: 'VERIFIED';
}

interface FundingPayment {
  time: string;
  market: Market;
  rate: string;
  payment: string;
}

// ─────────────────────────────────────────────
// Constants / seed data
// ─────────────────────────────────────────────
const BASE_PRICES: Record<Market, number> = {
  'BTC-PERP': 67_420.5,
  'ETH-PERP': 3_512.8,
  'XLM-PERP': 0.1184,
  'SOL-PERP': 148.32,
};

function generateChartData(basePrice: number, points = 50) {
  const data = [];
  let price = basePrice * 0.94;
  for (let i = 0; i < points; i++) {
    price = price * (1 + (Math.random() - 0.48) * 0.012);
    data.push({
      t: i,
      price: parseFloat(price.toFixed(basePrice > 1000 ? 2 : basePrice > 1 ? 4 : 6)),
    });
  }
  return data;
}

function generateAsks(basePrice: number): OrderBookRow[] {
  const rows: OrderBookRow[] = [];
  let cum = 0;
  for (let i = 10; i >= 1; i--) {
    const price = basePrice * (1 + i * 0.0003);
    const size = parseFloat((Math.random() * 2 + 0.1).toFixed(4));
    cum += size;
    rows.push({ price: parseFloat(price.toFixed(2)), size, total: parseFloat(cum.toFixed(4)) });
  }
  return rows;
}

function generateBids(basePrice: number): OrderBookRow[] {
  const rows: OrderBookRow[] = [];
  let cum = 0;
  for (let i = 1; i <= 10; i++) {
    const price = basePrice * (1 - i * 0.0003);
    const size = parseFloat((Math.random() * 2 + 0.1).toFixed(4));
    cum += size;
    rows.push({ price: parseFloat(price.toFixed(2)), size, total: parseFloat(cum.toFixed(4)) });
  }
  return rows;
}

function generateTrades(basePrice: number): Trade[] {
  return Array.from({ length: 8 }, (_, i) => {
    const side = Math.random() > 0.5 ? 'Buy' : 'Sell';
    const offset = (Math.random() - 0.5) * basePrice * 0.001;
    const price = parseFloat((basePrice + offset).toFixed(2));
    const size = parseFloat((Math.random() * 1.5 + 0.05).toFixed(4));
    const mins = i * 2 + Math.floor(Math.random() * 2);
    const now = new Date();
    now.setMinutes(now.getMinutes() - mins);
    return {
      id: i,
      side,
      price,
      size,
      time: now.toTimeString().slice(0, 8),
    };
  });
}

const INITIAL_POSITIONS: Position[] = [
  {
    id: 1,
    market: 'BTC-PERP',
    side: 'Long',
    size: 0.15,
    entry: 59_800.0,
    mark: BASE_PRICES['BTC-PERP'],
    pnlPct: 12.4,
    collateral: 1000,
  },
  {
    id: 2,
    market: 'ETH-PERP',
    side: 'Short',
    size: 1.2,
    entry: 3_625.5,
    mark: BASE_PRICES['ETH-PERP'],
    pnlPct: -3.1,
    collateral: 500,
  },
];

const ZK_PROOFS: ZkProof[] = [
  {
    id: 1,
    timestamp: '2026-06-24 14:32:11',
    market: 'BTC-PERP',
    hash: '0x7f3a9c...e4b2d1',
    status: 'VERIFIED',
  },
  {
    id: 2,
    timestamp: '2026-06-24 13:15:44',
    market: 'ETH-PERP',
    hash: '0x2e8b1f...9a7c3d',
    status: 'VERIFIED',
  },
  {
    id: 3,
    timestamp: '2026-06-24 11:58:02',
    market: 'BTC-PERP',
    hash: '0xab4d7e...f1c923',
    status: 'VERIFIED',
  },
];

const FUNDING_PAYMENTS: FundingPayment[] = [
  { time: '14:00 UTC', market: 'BTC-PERP', rate: '+0.0082%', payment: '+$2.31' },
  { time: '10:00 UTC', market: 'ETH-PERP', rate: '-0.0031%', payment: '-$0.84' },
  { time: '06:00 UTC', market: 'BTC-PERP', rate: '+0.0071%', payment: '+$1.99' },
];

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function fmt(n: number, decimals = 2) {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtPrice(price: number, market: Market) {
  if (market === 'XLM-PERP') return price.toFixed(6);
  if (market === 'BTC-PERP' || market === 'ETH-PERP') return fmt(price, 2);
  return fmt(price, 3);
}

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

function ShieldBadge() {
  return (
    <span
      style={{
        background: 'linear-gradient(135deg, #1e3a5f 0%, #0f2540 100%)',
        border: '1px solid #3b82f6',
        borderRadius: 6,
        padding: '2px 8px',
        fontSize: 11,
        color: '#60a5fa',
        letterSpacing: 1,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
      }}
    >
      🔐 ZK
    </span>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: '#0c1e35',
        border: '1px solid #1e3a5f',
        borderRadius: 8,
        padding: '12px 14px',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 2,
        color: '#4a7fab',
        textTransform: 'uppercase',
        marginBottom: 8,
        fontFamily: 'monospace',
      }}
    >
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────
export default function TradingDashboard() {
  const [market, setMarket] = useState<Market>('BTC-PERP');
  const [ticker, setTicker] = useState<TickerData>({
    markPrice: BASE_PRICES['BTC-PERP'],
    change24h: 3.42,
    volume24h: 1_248_300_000,
    openInterest: 432_100_000,
    fundingRate: 0.0082,
  });
  const [chartData, setChartData] = useState(() => generateChartData(BASE_PRICES['BTC-PERP']));
  const [asks, setAsks] = useState<OrderBookRow[]>(() => generateAsks(BASE_PRICES['BTC-PERP']));
  const [bids, setBids] = useState<OrderBookRow[]>(() => generateBids(BASE_PRICES['BTC-PERP']));
  const [trades, setTrades] = useState<Trade[]>(() => generateTrades(BASE_PRICES['BTC-PERP']));

  const [side, setSide] = useState<Side>('Long');
  const [collateral, setCollateral] = useState<string>('100');
  const [leverage, setLeverage] = useState<number>(5);
  const [zkEnabled, setZkEnabled] = useState(true);
  const [proofState, setProofState] = useState<'idle' | 'generating' | 'success'>('idle');

  const [positions, setPositions] = useState<Position[]>(INITIAL_POSITIONS);
  const [walletConnected, setWalletConnected] = useState(false);

  const positionSize =
    parseFloat(collateral || '0') * leverage;

  // Ticker update every second
  useEffect(() => {
    const base = BASE_PRICES[market];
    const interval = setInterval(() => {
      setTicker((prev) => {
        const delta = (Math.random() - 0.495) * base * 0.0008;
        const newPrice = Math.max(base * 0.9, prev.markPrice + delta);
        return {
          markPrice: parseFloat(newPrice.toFixed(market === 'XLM-PERP' ? 6 : 2)),
          change24h: parseFloat((prev.change24h + (Math.random() - 0.5) * 0.05).toFixed(2)),
          volume24h: prev.volume24h + Math.random() * 50_000,
          openInterest: prev.openInterest + (Math.random() - 0.5) * 100_000,
          fundingRate: parseFloat((prev.fundingRate + (Math.random() - 0.5) * 0.0002).toFixed(6)),
        };
      });
      // refresh order book
      setAsks(generateAsks(ticker.markPrice));
      setBids(generateBids(ticker.markPrice));
    }, 1200);
    return () => clearInterval(interval);
  }, [market, ticker.markPrice]);

  // Chart data scroll
  useEffect(() => {
    const base = BASE_PRICES[market];
    setChartData(generateChartData(base));
    setTrades(generateTrades(base));
    setTicker({
      markPrice: base,
      change24h: parseFloat(((Math.random() - 0.45) * 8).toFixed(2)),
      volume24h: Math.random() * 2e9 + 5e8,
      openInterest: Math.random() * 5e8 + 1e8,
      fundingRate: parseFloat(((Math.random() - 0.5) * 0.02).toFixed(6)),
    });
  }, [market]);

  const handleGenerateProof = useCallback(async () => {
    setProofState('generating');
    await new Promise((r) => setTimeout(r, 2000));
    setProofState('success');
    setTimeout(() => setProofState('idle'), 3000);
  }, []);

  const handleClosePosition = (id: number) => {
    setPositions((prev) => prev.filter((p) => p.id !== id));
  };

  const totalCollateral = positions.reduce((s, p) => s + p.collateral, 0);
  const totalPnl = positions.reduce((s, p) => s + p.collateral * p.pnlPct * 0.01, 0);
  const marginRatio = Math.min(100, Math.max(0, 72 + totalPnl / 100));

  // ─── styles ───────────────────────────────
  const root: React.CSSProperties = {
    minHeight: '100vh',
    background: '#060e1c',
    color: '#c8d8ea',
    fontFamily: "'Courier New', Courier, monospace",
    fontSize: 13,
    display: 'flex',
    flexDirection: 'column',
  };

  const navStyle: React.CSSProperties = {
    background: '#0a1828',
    borderBottom: '1px solid #1e3a5f',
    padding: '0 20px',
    height: 52,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'sticky',
    top: 0,
    zIndex: 100,
  };

  const markets: Market[] = ['BTC-PERP', 'ETH-PERP', 'XLM-PERP', 'SOL-PERP'];

  return (
    <div style={root}>
      {/* ── Navbar ────────────────────────────── */}
      <nav style={navStyle}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              fontSize: 18,
              fontWeight: 900,
              letterSpacing: 3,
              color: '#3b82f6',
              textShadow: '0 0 12px #3b82f640',
            }}
          >
            ZK PERPS
          </span>
          <ShieldBadge />
        </div>

        {/* Market selector */}
        <div style={{ display: 'flex', gap: 4 }}>
          {markets.map((m) => (
            <button
              key={m}
              onClick={() => setMarket(m)}
              style={{
                background: market === m ? '#1e3a5f' : 'transparent',
                border: `1px solid ${market === m ? '#3b82f6' : '#1e3a5f'}`,
                borderRadius: 6,
                color: market === m ? '#60a5fa' : '#6b8caf',
                padding: '4px 12px',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: 1,
                transition: 'all 0.15s',
              }}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Wallet */}
        <button
          onClick={() => setWalletConnected((v) => !v)}
          style={{
            background: walletConnected
              ? 'linear-gradient(135deg, #0f3a1a 0%, #0a2812 100%)'
              : 'linear-gradient(135deg, #1e3a5f 0%, #0f2540 100%)',
            border: `1px solid ${walletConnected ? '#22c55e' : '#3b82f6'}`,
            borderRadius: 6,
            color: walletConnected ? '#22c55e' : '#60a5fa',
            padding: '6px 16px',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 1,
          }}
        >
          {walletConnected ? '● GBXK...7F3A' : 'CONNECT WALLET'}
        </button>
      </nav>

      {/* ── Ticker bar ───────────────────────── */}
      <div
        style={{
          background: '#090f1d',
          borderBottom: '1px solid #1e3a5f',
          padding: '6px 20px',
          display: 'flex',
          gap: 32,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <TickerItem
          label="MARK PRICE"
          value={`$${fmtPrice(ticker.markPrice, market)}`}
          color="#e2e8f0"
          large
        />
        <TickerItem
          label="24H CHANGE"
          value={`${ticker.change24h >= 0 ? '+' : ''}${ticker.change24h.toFixed(2)}%`}
          color={ticker.change24h >= 0 ? '#22c55e' : '#ef4444'}
        />
        <TickerItem
          label="24H VOLUME"
          value={`$${(ticker.volume24h / 1e9).toFixed(2)}B`}
          color="#94a3b8"
        />
        <TickerItem
          label="OPEN INTEREST"
          value={`$${(ticker.openInterest / 1e6).toFixed(1)}M`}
          color="#94a3b8"
        />
        <TickerItem
          label="FUNDING RATE"
          value={`${ticker.fundingRate >= 0 ? '+' : ''}${(ticker.fundingRate * 100).toFixed(4)}%`}
          color={ticker.fundingRate >= 0 ? '#22c55e' : '#ef4444'}
        />
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#22c55e',
              display: 'inline-block',
              boxShadow: '0 0 6px #22c55e',
            }}
          />
          <span style={{ fontSize: 11, color: '#4a7fab', letterSpacing: 1 }}>LIVE</span>
        </div>
      </div>

      {/* ── Main 3-column ────────────────────── */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          gap: 8,
          padding: '8px 12px',
          overflow: 'hidden',
        }}
      >
        {/* ── LEFT COLUMN ── */}
        <div style={{ width: '35%', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Price chart */}
          <Card style={{ flex: '0 0 auto' }}>
            <SectionLabel>{market} — 1H CHART</SectionLabel>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="t" hide />
                <YAxis
                  domain={['auto', 'auto']}
                  tick={{ fill: '#4a7fab', fontSize: 10, fontFamily: 'monospace' }}
                  width={70}
                  tickFormatter={(v) => {
                    if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`;
                    if (v < 1) return `$${v.toFixed(5)}`;
                    return `$${v.toFixed(2)}`;
                  }}
                />
                <Tooltip
                  contentStyle={{
                    background: '#0c1e35',
                    border: '1px solid #1e3a5f',
                    borderRadius: 6,
                    fontSize: 11,
                    fontFamily: 'monospace',
                    color: '#c8d8ea',
                  }}
                  formatter={(v: number) => [`$${v.toFixed(market === 'XLM-PERP' ? 6 : 2)}`, 'Price']}
                />
                <Area
                  type="monotone"
                  dataKey="price"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fill="url(#priceGrad)"
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </Card>

          {/* Order book */}
          <Card style={{ flex: 1 }}>
            <SectionLabel>ORDER BOOK</SectionLabel>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: '0 8px',
                fontSize: 10,
                color: '#4a7fab',
                marginBottom: 4,
                borderBottom: '1px solid #1e3a5f',
                paddingBottom: 4,
              }}
            >
              <span>PRICE (USD)</span>
              <span style={{ textAlign: 'right' }}>SIZE</span>
              <span style={{ textAlign: 'right' }}>TOTAL</span>
            </div>

            {/* Asks */}
            {asks.map((row, i) => (
              <OrderBookRow key={`ask-${i}`} row={row} color="#ef4444" side="ask" />
            ))}

            {/* Spread */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                padding: '4px 0',
                borderTop: '1px solid #1e3a5f',
                borderBottom: '1px solid #1e3a5f',
                marginBottom: 0,
                fontSize: 10,
                color: '#60a5fa',
              }}
            >
              <span style={{ fontWeight: 700 }}>
                ${fmtPrice(ticker.markPrice, market)}
              </span>
              <span style={{ textAlign: 'right', color: '#4a7fab' }}>SPREAD</span>
              <span style={{ textAlign: 'right', color: '#4a7fab' }}>
                ${(ticker.markPrice * 0.0006).toFixed(2)}
              </span>
            </div>

            {/* Bids */}
            {bids.map((row, i) => (
              <OrderBookRow key={`bid-${i}`} row={row} color="#22c55e" side="bid" />
            ))}
          </Card>
        </div>

        {/* ── CENTER COLUMN ── */}
        <div style={{ width: '30%', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Order entry */}
          <Card>
            <SectionLabel>PLACE ORDER</SectionLabel>
            {/* Long / Short tabs */}
            <div style={{ display: 'flex', marginBottom: 12, borderRadius: 6, overflow: 'hidden', border: '1px solid #1e3a5f' }}>
              {(['Long', 'Short'] as Side[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setSide(s)}
                  style={{
                    flex: 1,
                    padding: '8px 0',
                    background:
                      side === s
                        ? s === 'Long'
                          ? 'linear-gradient(135deg, #0f3a1a 0%, #0a2812 100%)'
                          : 'linear-gradient(135deg, #3a0f0f 0%, #280a0a 100%)'
                        : 'transparent',
                    color:
                      side === s
                        ? s === 'Long'
                          ? '#22c55e'
                          : '#ef4444'
                        : '#4a7fab',
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                    fontSize: 12,
                    fontWeight: 800,
                    letterSpacing: 2,
                    transition: 'all 0.15s',
                  }}
                >
                  {s === 'Long' ? '▲ LONG' : '▼ SHORT'}
                </button>
              ))}
            </div>

            {/* Collateral */}
            <InputRow label="COLLATERAL (USDC)">
              <input
                type="number"
                value={collateral}
                onChange={(e) => setCollateral(e.target.value)}
                style={inputStyle}
                min="1"
              />
            </InputRow>

            {/* Leverage */}
            <InputRow label={`LEVERAGE — ${leverage}×`}>
              <input
                type="range"
                min={1}
                max={20}
                value={leverage}
                onChange={(e) => setLeverage(Number(e.target.value))}
                style={{
                  width: '100%',
                  accentColor: side === 'Long' ? '#22c55e' : '#ef4444',
                  cursor: 'pointer',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#4a7fab', marginTop: 2 }}>
                <span>1×</span>
                <span>5×</span>
                <span>10×</span>
                <span>20×</span>
              </div>
            </InputRow>

            {/* Position size */}
            <div
              style={{
                background: '#060e1c',
                border: '1px solid #1e3a5f',
                borderRadius: 6,
                padding: '8px 10px',
                marginBottom: 12,
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 12,
              }}
            >
              <span style={{ color: '#4a7fab' }}>POSITION SIZE</span>
              <span style={{ color: side === 'Long' ? '#22c55e' : '#ef4444', fontWeight: 700 }}>
                ${fmt(positionSize)}
              </span>
            </div>

            {/* Liq price estimate */}
            <div
              style={{
                background: '#060e1c',
                border: '1px solid #1e3a5f',
                borderRadius: 6,
                padding: '8px 10px',
                marginBottom: 12,
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 12,
              }}
            >
              <span style={{ color: '#4a7fab' }}>LIQ. PRICE (EST.)</span>
              <span style={{ color: '#ef4444', fontWeight: 700 }}>
                ${fmtPrice(
                  ticker.markPrice * (side === 'Long' ? 1 - 0.9 / leverage : 1 + 0.9 / leverage),
                  market,
                )}
              </span>
            </div>

            {/* ZK toggle */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                background: zkEnabled ? '#0a1828' : '#060e1c',
                border: `1px solid ${zkEnabled ? '#3b82f6' : '#1e3a5f'}`,
                borderRadius: 6,
                marginBottom: 12,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onClick={() => setZkEnabled((v) => !v)}
            >
              <input
                type="checkbox"
                checked={zkEnabled}
                onChange={() => setZkEnabled((v) => !v)}
                style={{ accentColor: '#3b82f6', cursor: 'pointer' }}
              />
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#60a5fa', letterSpacing: 1 }}>
                  ENABLE ZK PROOF
                </div>
                {zkEnabled && (
                  <div style={{ fontSize: 11, color: '#4a7fab', marginTop: 2 }}>
                    🔐 Position hidden from public
                  </div>
                )}
              </div>
              {zkEnabled && (
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: 10,
                    color: '#3b82f6',
                    background: '#1e3a5f',
                    borderRadius: 4,
                    padding: '2px 6px',
                    letterSpacing: 1,
                  }}
                >
                  UltraHonk
                </span>
              )}
            </div>

            {/* Submit button */}
            <button
              onClick={handleGenerateProof}
              disabled={proofState === 'generating'}
              style={{
                width: '100%',
                padding: '11px 0',
                background:
                  proofState === 'success'
                    ? 'linear-gradient(135deg, #0f3a1a 0%, #0a2812 100%)'
                    : side === 'Long'
                    ? 'linear-gradient(135deg, #14532d 0%, #0f3a1a 100%)'
                    : 'linear-gradient(135deg, #7f1d1d 0%, #450a0a 100%)',
                border: `1px solid ${
                  proofState === 'success'
                    ? '#22c55e'
                    : side === 'Long'
                    ? '#22c55e'
                    : '#ef4444'
                }`,
                borderRadius: 6,
                color:
                  proofState === 'success'
                    ? '#22c55e'
                    : side === 'Long'
                    ? '#22c55e'
                    : '#ef4444',
                fontFamily: 'monospace',
                fontWeight: 800,
                fontSize: 12,
                letterSpacing: 1,
                cursor: proofState === 'generating' ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                transition: 'all 0.15s',
                opacity: proofState === 'generating' ? 0.8 : 1,
              }}
            >
              {proofState === 'generating' && (
                <span
                  style={{
                    width: 12,
                    height: 12,
                    border: '2px solid currentColor',
                    borderTop: '2px solid transparent',
                    borderRadius: '50%',
                    display: 'inline-block',
                    animation: 'spin 0.7s linear infinite',
                  }}
                />
              )}
              {proofState === 'generating'
                ? 'GENERATING ZK PROOF...'
                : proofState === 'success'
                ? '✓ POSITION OPENED'
                : zkEnabled
                ? `GENERATE ZK PROOF & ${side.toUpperCase()}`
                : `OPEN ${side.toUpperCase()} POSITION`}
            </button>

            <style>{`
              @keyframes spin { to { transform: rotate(360deg); } }
            `}</style>
          </Card>

          {/* Recent trades */}
          <Card style={{ flex: 1 }}>
            <SectionLabel>RECENT TRADES</SectionLabel>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr 1fr',
                gap: '0 6px',
                fontSize: 10,
                color: '#4a7fab',
                marginBottom: 4,
                borderBottom: '1px solid #1e3a5f',
                paddingBottom: 4,
              }}
            >
              <span>SIDE</span>
              <span style={{ textAlign: 'right' }}>PRICE</span>
              <span style={{ textAlign: 'right' }}>SIZE</span>
              <span style={{ textAlign: 'right' }}>TIME</span>
            </div>
            {trades.map((t) => (
              <div
                key={t.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr 1fr',
                  gap: '0 6px',
                  padding: '3px 0',
                  fontSize: 11,
                  borderBottom: '1px solid #0c1e35',
                }}
              >
                <span style={{ color: t.side === 'Buy' ? '#22c55e' : '#ef4444', fontWeight: 700 }}>
                  {t.side.toUpperCase()}
                </span>
                <span style={{ textAlign: 'right', color: t.side === 'Buy' ? '#22c55e' : '#ef4444' }}>
                  {market === 'XLM-PERP' ? t.price.toFixed(6) : fmt(t.price)}
                </span>
                <span style={{ textAlign: 'right', color: '#94a3b8' }}>{t.size.toFixed(4)}</span>
                <span style={{ textAlign: 'right', color: '#4a7fab', fontSize: 10 }}>{t.time}</span>
              </div>
            ))}
          </Card>
        </div>

        {/* ── RIGHT COLUMN ── */}
        <div style={{ width: '35%', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Positions */}
          <Card>
            <SectionLabel>MY POSITIONS</SectionLabel>
            {positions.length === 0 ? (
              <div style={{ color: '#4a7fab', fontSize: 12, padding: '8px 0', textAlign: 'center' }}>
                No open positions
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ color: '#4a7fab', fontSize: 10, borderBottom: '1px solid #1e3a5f' }}>
                      {['MKT', 'SIDE', 'SIZE', 'ENTRY', 'MARK', 'PNL%', ''].map((h) => (
                        <th key={h} style={{ padding: '3px 4px', textAlign: h === '' ? 'center' : 'left', fontWeight: 400 }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((pos) => (
                      <tr
                        key={pos.id}
                        style={{
                          borderBottom: '1px solid #0c1e35',
                          background: pos.pnlPct >= 0 ? '#0a1a0f10' : '#1a0a0a10',
                        }}
                      >
                        <td style={{ padding: '5px 4px', color: '#60a5fa', fontWeight: 700 }}>
                          {pos.market.replace('-PERP', '')}
                        </td>
                        <td
                          style={{
                            padding: '5px 4px',
                            color: pos.side === 'Long' ? '#22c55e' : '#ef4444',
                            fontWeight: 700,
                          }}
                        >
                          {pos.side === 'Long' ? '▲ L' : '▼ S'}
                        </td>
                        <td style={{ padding: '5px 4px', color: '#c8d8ea' }}>{pos.size}</td>
                        <td style={{ padding: '5px 4px', color: '#94a3b8' }}>
                          ${(pos.entry / 1000).toFixed(1)}k
                        </td>
                        <td style={{ padding: '5px 4px', color: '#c8d8ea' }}>
                          ${(pos.mark / 1000).toFixed(1)}k
                        </td>
                        <td
                          style={{
                            padding: '5px 4px',
                            color: pos.pnlPct >= 0 ? '#22c55e' : '#ef4444',
                            fontWeight: 700,
                          }}
                        >
                          {pos.pnlPct >= 0 ? '+' : ''}
                          {pos.pnlPct}%
                        </td>
                        <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                          <button
                            onClick={() => handleClosePosition(pos.id)}
                            style={{
                              background: 'transparent',
                              border: '1px solid #ef4444',
                              borderRadius: 4,
                              color: '#ef4444',
                              padding: '2px 6px',
                              fontSize: 10,
                              cursor: 'pointer',
                              fontFamily: 'monospace',
                            }}
                          >
                            CLOSE
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Portfolio stats */}
          <Card>
            <SectionLabel>PORTFOLIO STATS</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
              <StatBox label="TOTAL COLLATERAL" value={`$${fmt(totalCollateral)}`} />
              <StatBox
                label="TOTAL PNL"
                value={`${totalPnl >= 0 ? '+' : ''}$${fmt(Math.abs(totalPnl))}`}
                color={totalPnl >= 0 ? '#22c55e' : '#ef4444'}
              />
              <StatBox label="LEVERAGE USED" value={`${(positionSize / Math.max(totalCollateral, 1)).toFixed(1)}×`} />
              <StatBox label="AVG. FUNDING" value="+0.0052%/8h" />
            </div>

            {/* Margin ratio */}
            <div style={{ marginBottom: 8 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 10,
                  color: '#4a7fab',
                  marginBottom: 4,
                }}
              >
                <span>MARGIN RATIO</span>
                <span style={{ color: marginRatio > 80 ? '#22c55e' : marginRatio > 50 ? '#f59e0b' : '#ef4444' }}>
                  {marginRatio.toFixed(1)}%
                </span>
              </div>
              <div
                style={{
                  height: 6,
                  background: '#0a1828',
                  borderRadius: 3,
                  border: '1px solid #1e3a5f',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${marginRatio}%`,
                    background:
                      marginRatio > 80
                        ? '#22c55e'
                        : marginRatio > 50
                        ? '#f59e0b'
                        : '#ef4444',
                    borderRadius: 3,
                    transition: 'width 0.3s',
                  }}
                />
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 11,
                padding: '6px 0',
                borderTop: '1px solid #1e3a5f',
              }}
            >
              <span style={{ color: '#4a7fab' }}>EST. LIQUIDATION</span>
              <span style={{ color: '#ef4444', fontWeight: 700 }}>$52,480.00</span>
            </div>
          </Card>

          {/* ZK Proof history */}
          <Card>
            <SectionLabel>ZK PROOF HISTORY</SectionLabel>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
              <thead>
                <tr style={{ color: '#4a7fab', borderBottom: '1px solid #1e3a5f' }}>
                  <th style={{ padding: '2px 4px', fontWeight: 400, textAlign: 'left' }}>TIME</th>
                  <th style={{ padding: '2px 4px', fontWeight: 400, textAlign: 'left' }}>MKT</th>
                  <th style={{ padding: '2px 4px', fontWeight: 400, textAlign: 'left' }}>HASH</th>
                  <th style={{ padding: '2px 4px', fontWeight: 400, textAlign: 'right' }}>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {ZK_PROOFS.map((zk) => (
                  <tr key={zk.id} style={{ borderBottom: '1px solid #0c1e35' }}>
                    <td style={{ padding: '4px 4px', color: '#6b8caf' }}>{zk.timestamp.slice(11)}</td>
                    <td style={{ padding: '4px 4px', color: '#60a5fa' }}>{zk.market.replace('-PERP', '')}</td>
                    <td style={{ padding: '4px 4px', color: '#4a7fab', fontFamily: 'monospace' }}>
                      {zk.hash}
                    </td>
                    <td style={{ padding: '4px 4px', textAlign: 'right' }}>
                      <span
                        style={{
                          background: '#0a1f0a',
                          border: '1px solid #22c55e',
                          borderRadius: 4,
                          color: '#22c55e',
                          padding: '1px 5px',
                          fontSize: 9,
                          letterSpacing: 1,
                        }}
                      >
                        {zk.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Funding payments */}
          <Card>
            <SectionLabel>FUNDING PAYMENTS</SectionLabel>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
              <thead>
                <tr style={{ color: '#4a7fab', borderBottom: '1px solid #1e3a5f' }}>
                  <th style={{ padding: '2px 4px', fontWeight: 400, textAlign: 'left' }}>TIME</th>
                  <th style={{ padding: '2px 4px', fontWeight: 400, textAlign: 'left' }}>MARKET</th>
                  <th style={{ padding: '2px 4px', fontWeight: 400, textAlign: 'right' }}>RATE</th>
                  <th style={{ padding: '2px 4px', fontWeight: 400, textAlign: 'right' }}>PAYMENT</th>
                </tr>
              </thead>
              <tbody>
                {FUNDING_PAYMENTS.map((fp, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #0c1e35' }}>
                    <td style={{ padding: '4px 4px', color: '#6b8caf' }}>{fp.time}</td>
                    <td style={{ padding: '4px 4px', color: '#60a5fa' }}>{fp.market.replace('-PERP', '')}</td>
                    <td
                      style={{
                        padding: '4px 4px',
                        textAlign: 'right',
                        color: fp.rate.startsWith('+') ? '#22c55e' : '#ef4444',
                      }}
                    >
                      {fp.rate}
                    </td>
                    <td
                      style={{
                        padding: '4px 4px',
                        textAlign: 'right',
                        color: fp.payment.startsWith('+') ? '#22c55e' : '#ef4444',
                        fontWeight: 700,
                      }}
                    >
                      {fp.payment}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </div>

      {/* ── Status bar ───────────────────────── */}
      <div
        style={{
          background: '#04090f',
          borderTop: '1px solid #1e3a5f',
          padding: '5px 16px',
          display: 'flex',
          gap: 20,
          alignItems: 'center',
          fontSize: 10,
          color: '#4a7fab',
          letterSpacing: 1,
          flexWrap: 'wrap',
        }}
      >
        <StatusItem icon="🌐" text="Stellar Testnet" color="#60a5fa" />
        <Sep />
        <StatusItem icon="📄" text="Soroban Contract: C883...7F2A" />
        <Sep />
        <StatusItem icon="☁️" text="AWS Region: us-east-1" />
        <Sep />
        <StatusItem icon="🔐" text="Proof Engine: UltraHonk" color="#a78bfa" />
        <Sep />
        <StatusItem icon="⚡" text="Latency: 18ms" color="#22c55e" />
        <Sep />
        <StatusItem icon="🔗" text="Block: #12,847,291" />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Small helper components
// ─────────────────────────────────────────────

function TickerItem({
  label,
  value,
  color = '#c8d8ea',
  large = false,
}: {
  label: string;
  value: string;
  color?: string;
  large?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span style={{ fontSize: 9, color: '#4a7fab', letterSpacing: 1, fontFamily: 'monospace' }}>
        {label}
      </span>
      <span
        style={{
          fontSize: large ? 18 : 13,
          fontWeight: large ? 800 : 600,
          color,
          fontFamily: 'monospace',
          letterSpacing: large ? 1 : 0,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function OrderBookRow({
  row,
  color,
  side,
}: {
  row: OrderBookRow;
  color: string;
  side: 'ask' | 'bid';
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: '0 8px',
        padding: '2px 0',
        fontSize: 11,
        borderBottom: '1px solid #060e1c',
        position: 'relative',
        cursor: 'pointer',
      }}
    >
      {/* depth bar */}
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: `${Math.min(row.total * 15, 100)}%`,
          background: color + '12',
          borderRadius: 2,
        }}
      />
      <span style={{ color, fontFamily: 'monospace', position: 'relative' }}>
        {row.price.toFixed(2)}
      </span>
      <span style={{ textAlign: 'right', color: '#c8d8ea', position: 'relative' }}>
        {row.size.toFixed(4)}
      </span>
      <span style={{ textAlign: 'right', color: '#6b8caf', position: 'relative' }}>
        {row.total.toFixed(4)}
      </span>
    </div>
  );
}

function InputRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: '#4a7fab', marginBottom: 4, letterSpacing: 1 }}>{label}</div>
      {children}
    </div>
  );
}

function StatBox({
  label,
  value,
  color = '#c8d8ea',
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div
      style={{
        background: '#060e1c',
        border: '1px solid #1e3a5f',
        borderRadius: 6,
        padding: '6px 8px',
      }}
    >
      <div style={{ fontSize: 9, color: '#4a7fab', letterSpacing: 1, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color, fontFamily: 'monospace' }}>{value}</div>
    </div>
  );
}

function StatusItem({
  icon,
  text,
  color = '#4a7fab',
}: {
  icon: string;
  text: string;
  color?: string;
}) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 4, color }}>
      <span>{icon}</span>
      <span>{text}</span>
    </span>
  );
}

function Sep() {
  return <span style={{ color: '#1e3a5f' }}>|</span>;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#060e1c',
  border: '1px solid #1e3a5f',
  borderRadius: 6,
  color: '#c8d8ea',
  padding: '7px 10px',
  fontFamily: 'monospace',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
};
