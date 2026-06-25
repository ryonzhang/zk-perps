#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, Bytes, Env, Symbol,
    log,
};

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug)]
pub struct Position {
    pub trader: Address,
    pub market: Symbol,
    pub side: Symbol,        // Long | Short
    pub size: i128,
    pub collateral: i128,
    pub entry_price: i128,
    pub open_timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Market {
    pub mark_price: i128,
    pub open_interest: i128,
    pub funding_rate: i128,   // basis points per hour, signed
    pub last_funding: u64,
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    Admin,
    Oracle,
    Position(u64),
    PositionCounter,
    Collateral(Address),
    Market(Symbol),
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRICE_DECIMALS: i128 = 1_000_000_000_000_000_000; // 1e18
const MAX_LEVERAGE: u32 = 100;
const LIQUIDATION_THRESHOLD: i128 = 80; // 80% loss of collateral triggers liquidation
const FUNDING_INTERVAL: u64 = 3600;     // 1 hour in seconds

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct ZkPerps;

#[contractimpl]
impl ZkPerps {
    // -----------------------------------------------------------------------
    // Admin / setup
    // -----------------------------------------------------------------------

    /// Initialize the contract with an admin and oracle address.
    pub fn initialize(env: Env, admin: Address, oracle: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Oracle, &oracle);
        env.storage().instance().set(&DataKey::PositionCounter, &0u64);
    }

    // -----------------------------------------------------------------------
    // Collateral management
    // -----------------------------------------------------------------------

    /// Deposit USDC collateral for a trader.
    pub fn deposit_collateral(env: Env, trader: Address, amount: i128) {
        trader.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }

        let key = DataKey::Collateral(trader.clone());
        let current: i128 = env.storage().instance().get(&key).unwrap_or(0);
        env.storage().instance().set(&key, &(current + amount));

        env.events().publish(
            (symbol_short!("CollDep"), trader.clone()),
            amount,
        );
    }

    /// Query collateral balance for a trader.
    pub fn get_collateral(env: Env, trader: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::Collateral(trader))
            .unwrap_or(0)
    }

    // -----------------------------------------------------------------------
    // Positions
    // -----------------------------------------------------------------------

    /// Open a perpetual position with a ZK proof of valid order parameters.
    pub fn open_position(
        env: Env,
        trader: Address,
        market: Symbol,
        side: Symbol,
        size: i128,
        leverage: u32,
        zk_proof: Bytes,
    ) -> u64 {
        trader.require_auth();

        if size <= 0 {
            panic!("size must be positive");
        }
        if leverage == 0 || leverage > MAX_LEVERAGE {
            panic!("invalid leverage");
        }

        // Verify the ZK proof (stub: non-empty proof is accepted)
        if !Self::verify_collateral_proof(env.clone(), zk_proof) {
            panic!("invalid zk proof");
        }

        // Validate side
        let long_sym = symbol_short!("Long");
        let short_sym = symbol_short!("Short");
        if side != long_sym && side != short_sym {
            panic!("side must be Long or Short");
        }

        // Fetch mark price
        let mkt: Market = env
            .storage()
            .instance()
            .get(&DataKey::Market(market.clone()))
            .expect("market not found");

        let mark_price = mkt.mark_price;

        // Required collateral = notional / leverage
        let notional = size * mark_price / PRICE_DECIMALS;
        let required_collateral = notional / leverage as i128;

        let coll_key = DataKey::Collateral(trader.clone());
        let available: i128 = env.storage().instance().get(&coll_key).unwrap_or(0);
        if available < required_collateral {
            panic!("insufficient collateral");
        }

        // Deduct collateral
        env.storage()
            .instance()
            .set(&coll_key, &(available - required_collateral));

        // Increment open interest
        let mut updated_mkt = mkt;
        updated_mkt.open_interest += size;
        env.storage()
            .instance()
            .set(&DataKey::Market(market.clone()), &updated_mkt);

        // Mint position
        let counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::PositionCounter)
            .unwrap_or(0);
        let position_id = counter + 1;
        env.storage()
            .instance()
            .set(&DataKey::PositionCounter, &position_id);

        let position = Position {
            trader: trader.clone(),
            market: market.clone(),
            side: side.clone(),
            size,
            collateral: required_collateral,
            entry_price: mark_price,
            open_timestamp: env.ledger().timestamp(),
        };

        env.storage()
            .instance()
            .set(&DataKey::Position(position_id), &position);

        env.events().publish(
            (symbol_short!("PosOpen"), trader.clone()),
            (position_id, market, side, size, mark_price),
        );

        position_id
    }

    /// Close a position and settle PnL back to trader collateral.
    pub fn close_position(env: Env, trader: Address, position_id: u64) {
        trader.require_auth();

        let pos: Position = env
            .storage()
            .instance()
            .get(&DataKey::Position(position_id))
            .expect("position not found");

        if pos.trader != trader {
            panic!("not your position");
        }

        let mkt: Market = env
            .storage()
            .instance()
            .get(&DataKey::Market(pos.market.clone()))
            .expect("market not found");

        let pnl = Self::compute_pnl(&pos, mkt.mark_price);
        let settlement = pos.collateral + pnl;

        // Return collateral (+/- PnL) to trader — clamp at zero
        let returned = if settlement > 0 { settlement } else { 0 };
        let coll_key = DataKey::Collateral(trader.clone());
        let current: i128 = env.storage().instance().get(&coll_key).unwrap_or(0);
        env.storage()
            .instance()
            .set(&coll_key, &(current + returned));

        // Reduce open interest
        let mut updated_mkt = mkt;
        updated_mkt.open_interest = (updated_mkt.open_interest - pos.size).max(0);
        env.storage()
            .instance()
            .set(&DataKey::Market(pos.market.clone()), &updated_mkt);

        // Remove position
        env.storage()
            .instance()
            .remove(&DataKey::Position(position_id));

        env.events().publish(
            (symbol_short!("PosClose"), trader.clone()),
            (position_id, pnl, returned),
        );
    }

    /// Liquidate an underwater position (anyone can call with a valid ZK proof).
    pub fn liquidate(env: Env, position_id: u64, zk_proof: Bytes) {
        if !Self::verify_collateral_proof(env.clone(), zk_proof) {
            panic!("invalid zk proof");
        }

        let pos: Position = env
            .storage()
            .instance()
            .get(&DataKey::Position(position_id))
            .expect("position not found");

        let mkt: Market = env
            .storage()
            .instance()
            .get(&DataKey::Market(pos.market.clone()))
            .expect("market not found");

        // Check liquidation condition
        if !Self::is_liquidatable(&pos, mkt.mark_price) {
            panic!("position is not liquidatable");
        }

        // Reduce open interest
        let mut updated_mkt = mkt;
        updated_mkt.open_interest = (updated_mkt.open_interest - pos.size).max(0);
        env.storage()
            .instance()
            .set(&DataKey::Market(pos.market.clone()), &updated_mkt);

        // Remove position (collateral is seized)
        env.storage()
            .instance()
            .remove(&DataKey::Position(position_id));

        env.events().publish(
            (symbol_short!("Liquidated"), pos.trader.clone()),
            (position_id, mkt.mark_price),
        );
    }

    // -----------------------------------------------------------------------
    // Oracle / market
    // -----------------------------------------------------------------------

    /// Update the mark price for a market (oracle only).
    pub fn update_mark_price(env: Env, market: Symbol, price: i128) {
        let oracle: Address = env
            .storage()
            .instance()
            .get(&DataKey::Oracle)
            .expect("not initialized");
        oracle.require_auth();

        if price <= 0 {
            panic!("price must be positive");
        }

        let existing: Option<Market> = env
            .storage()
            .instance()
            .get(&DataKey::Market(market.clone()));

        let updated = match existing {
            Some(mut m) => {
                m.mark_price = price;
                m
            }
            None => Market {
                mark_price: price,
                open_interest: 0,
                funding_rate: 0,
                last_funding: env.ledger().timestamp(),
            },
        };

        env.storage()
            .instance()
            .set(&DataKey::Market(market), &updated);
    }

    // -----------------------------------------------------------------------
    // Funding
    // -----------------------------------------------------------------------

    /// Apply accrued funding to a market's open interest accounting.
    pub fn collect_funding(env: Env, market: Symbol) {
        let mut mkt: Market = env
            .storage()
            .instance()
            .get(&DataKey::Market(market.clone()))
            .expect("market not found");

        let now = env.ledger().timestamp();
        let elapsed = now.saturating_sub(mkt.last_funding);
        if elapsed < FUNDING_INTERVAL {
            return; // nothing to do yet
        }

        let intervals = elapsed / FUNDING_INTERVAL;
        // funding_rate is in basis-points per hour; applied against open interest
        // This is an accounting stub — in production, per-position funding would be settled.
        let _ = mkt.funding_rate * mkt.open_interest * intervals as i128 / 10_000;

        mkt.last_funding = now;
        env.storage()
            .instance()
            .set(&DataKey::Market(market), &mkt);
    }

    // -----------------------------------------------------------------------
    // ZK proof verification
    // -----------------------------------------------------------------------

    /// Verify a ZK proof. Stub: accepts any non-empty byte sequence.
    pub fn verify_collateral_proof(_env: Env, proof: Bytes) -> bool {
        proof.len() > 0
    }

    // -----------------------------------------------------------------------
    // Read helpers
    // -----------------------------------------------------------------------

    /// Fetch a position by id.
    pub fn get_position(env: Env, position_id: u64) -> Position {
        env.storage()
            .instance()
            .get(&DataKey::Position(position_id))
            .expect("position not found")
    }

    /// Compute the liquidation price for a position.
    ///
    /// For a Long:  liq_price = entry_price * (1 - 1/leverage + maintenance_margin/leverage)
    ///              simplified: entry_price * (collateral - maintenance) / notional
    /// For a Short: liq_price = entry_price * (1 + 1/leverage - maintenance_margin/leverage)
    ///
    /// Here we use: maintenance margin = 5% of collateral (500 bps).
    pub fn get_liquidation_price(env: Env, position_id: u64) -> i128 {
        let pos: Position = env
            .storage()
            .instance()
            .get(&DataKey::Position(position_id))
            .expect("position not found");

        let notional = pos.size * pos.entry_price / PRICE_DECIMALS;
        if notional == 0 {
            return 0;
        }

        // maintenance margin = 5% of collateral
        let maintenance = pos.collateral * 5 / 100;
        let net_collateral = pos.collateral - maintenance;

        let long_sym = symbol_short!("Long");
        if pos.side == long_sym {
            // price at which loss == net_collateral
            // loss = (entry - liq) * size / PRICE_DECIMALS = net_collateral
            // liq = entry - net_collateral * PRICE_DECIMALS / size
            pos.entry_price - net_collateral * PRICE_DECIMALS / pos.size
        } else {
            // loss = (liq - entry) * size / PRICE_DECIMALS = net_collateral
            // liq = entry + net_collateral * PRICE_DECIMALS / size
            pos.entry_price + net_collateral * PRICE_DECIMALS / pos.size
        }
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    fn compute_pnl(pos: &Position, mark_price: i128) -> i128 {
        let long_sym = symbol_short!("Long");
        if pos.side == long_sym {
            (mark_price - pos.entry_price) * pos.size / PRICE_DECIMALS
        } else {
            (pos.entry_price - mark_price) * pos.size / PRICE_DECIMALS
        }
    }

    fn is_liquidatable(pos: &Position, mark_price: i128) -> bool {
        let pnl = Self::compute_pnl(pos, mark_price);
        if pnl >= 0 {
            return false;
        }
        // liquidate when loss >= LIQUIDATION_THRESHOLD% of collateral
        let loss = -pnl;
        loss * 100 >= pos.collateral * LIQUIDATION_THRESHOLD
    }
}
