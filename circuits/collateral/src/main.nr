// ZK Perps — Collateral Health Proof
// Proves: collateral * leverage_factor >= position_size * mark_price * margin_requirement
// Without revealing: actual collateral amount, position size, or leverage
//
// Public inputs: margin_requirement (basis points), mark_price_commitment (hash)
// Private inputs: collateral, position_size, leverage, mark_price, nonce
// Output: is_healthy (bool)

use std::hash::pedersen_hash;

fn main(
    // private
    collateral: Field,
    position_size: Field,
    leverage: Field,
    mark_price: Field,
    nonce: Field,
    // public
    margin_requirement_bps: pub Field,
    price_commitment: pub Field,
) {
    // -------------------------------------------------------------------------
    // 1. Verify mark price commitment: pedersen_hash([mark_price, nonce]) == price_commitment
    // -------------------------------------------------------------------------
    let computed_commitment = pedersen_hash([mark_price, nonce]);
    assert(computed_commitment == price_commitment, "Mark price commitment mismatch");

    // -------------------------------------------------------------------------
    // 2. Sanity checks on private inputs
    // -------------------------------------------------------------------------

    // position_size > 0
    // We cast to u64 to use comparison; values are assumed to fit within 64 bits.
    let position_size_u64 = position_size as u64;
    assert(position_size_u64 > 0, "Position size must be positive");

    // collateral > 0
    let collateral_u64 = collateral as u64;
    assert(collateral_u64 > 0, "Collateral must be positive");

    // leverage >= 1 and <= 20
    let leverage_u64 = leverage as u64;
    assert(leverage_u64 >= 1, "Leverage must be at least 1");
    assert(leverage_u64 <= 20, "Leverage must be at most 20");

    // mark_price > 0
    let mark_price_u64 = mark_price as u64;
    assert(mark_price_u64 > 0, "Mark price must be positive");

    // margin_requirement_bps in (0, 10000]
    let margin_bps_u64 = margin_requirement_bps as u64;
    assert(margin_bps_u64 > 0, "Margin requirement must be positive");
    assert(margin_bps_u64 <= 10000, "Margin requirement cannot exceed 100%");

    // -------------------------------------------------------------------------
    // 3. Compute required_margin = position_size * mark_price * margin_requirement_bps
    //    (we defer dividing by 10000 to avoid integer truncation — instead we
    //    compare scaled values on both sides)
    //
    //    Health condition (unscaled):
    //      collateral * leverage * 10000 >= position_size * mark_price * margin_requirement_bps
    // -------------------------------------------------------------------------
    let effective_collateral: u64 = collateral_u64 * leverage_u64 * 10000;
    let required_margin: u64 = position_size_u64 * mark_price_u64 * margin_bps_u64;

    // -------------------------------------------------------------------------
    // 4. Assert collateral health: effective_collateral >= required_margin
    // -------------------------------------------------------------------------
    assert(
        effective_collateral >= required_margin,
        "Collateral health check failed: undercollateralised position",
    );
}
