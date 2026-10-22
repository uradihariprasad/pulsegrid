/**
 * Futures & options intelligence (LIVE mode only — requires Upstox).
 *
 * Futures price/OI relationship (documented conventional mapping, always
 * labelled PROVISIONAL):
 *   price ↑, OI ↑  → LONG_BUILDUP      | price ↑, OI ↓  → SHORT_COVERING
 *   price ↓, OI ↑  → SHORT_BUILDUP     | price ↓, OI ↓  → LONG_UNWINDING
 * OI alone cannot identify who initiated trades or their intent; these are
 * descriptive combinations, not positioning facts.
 *
 * Option-chain strike labels (documented rules, applied only to real chain
 * data): for strikes within ±8% of spot, using OI + change-in-OI + volume:
 *   SUPPORT family (strikes below spot): rank by put OI.
 *     Strong Support       = top put-OI strike band AND ΔPutOI > +2% of mean Δ|OI|
 *     Support Strengthening= put OI rising (ΔPutOI > 0) over the window
 *     Weak Support         = put OI present but below 40th percentile of band
 *     Support Weakening    = ΔPutOI < −2% of mean Δ|OI|
 *     Support Breakdown Risk = price within 0.5 ATR-equivalent of strike AND
 *                              ΔPutOI < 0 AND price change negative
 *   RESISTANCE family mirrors with call OI above spot.
 * Rationale limitations are attached to every label: OI change does not
 * prove writer vs buyer initiation.
 */

export type StrikeLabel =
  | "STRONG_SUPPORT" | "SUPPORT_STRENGTHENING" | "WEAK_SUPPORT" | "SUPPORT_WEAKENING" | "SUPPORT_BREAKDOWN_RISK"
  | "STRONG_RESISTANCE" | "RESISTANCE_STRENGTHENING" | "WEAK_RESISTANCE" | "RESISTANCE_WEAKENING" | "RESISTANCE_BREAKOUT_RISK";

export interface StrikeIntel {
  strike: number;
  callOI: number;
  putOI: number;
  callDeltaOI: number;
  putDeltaOI: number;
  callVol: number;
  putVol: number;
  label: StrikeLabel;
  rule: string;
  caveat: string;
  ts: number;
}

export interface FuturesIntel {
  available: boolean;
  reason: string;
  symbol: string;
  futuresKey?: string;
  price: number | null;
  change: number | null;
  volume: number | null;
  oi: number | null;
  deltaOI: number | null;
  basis: number | null;
  priceOI: { label: string; provisional: boolean; caveat: string } | null;
  ts: number | null;
}

export interface OptionChainIntel {
  available: boolean;
  reason: string;
  underlying: string;
  expiry: string | null;
  spot: number | null;
  pcr: number | null;
  pcrScope: string;
  strikes: StrikeIntel[];
  ts: number | null;
}

export function interpretPriceOI(priceChange: number, deltaOI: number): FuturesIntel["priceOI"] {
  if (Math.abs(priceChange) < 1e-9 && Math.abs(deltaOI) < 1e-9) return null;
  const up = priceChange > 0;
  const oiUp = deltaOI > 0;
  const label = up && oiUp ? "LONG_BUILDUP" : up && !oiUp ? "SHORT_COVERING" : !up && oiUp ? "SHORT_BUILDUP" : "LONG_UNWINDING";
  return {
    label,
    provisional: true,
    caveat: "Conventional price/OI combination. OI cannot identify trade initiators or opening vs closing intent; treat as provisional context only.",
  };
}

export function classifyStrikes(chainRows: any[], spot: number, atr: number): OptionChainIntel {
  const rows = (chainRows ?? [])
    .map((r: any) => ({
      strike: Number(r.strike_price),
      callOI: Number(r.call_options?.market_data?.oi ?? 0),
      putOI: Number(r.put_options?.market_data?.oi ?? 0),
      callDeltaOI: Number(r.call_options?.market_data?.oi ?? 0) - Number(r.call_options?.market_data?.prev_oi ?? 0),
      putDeltaOI: Number(r.put_options?.market_data?.oi ?? 0) - Number(r.put_options?.market_data?.prev_oi ?? 0),
      callVol: Number(r.call_options?.market_data?.volume ?? 0),
      putVol: Number(r.put_options?.market_data?.volume ?? 0),
    }))
    .filter((r) => Number.isFinite(r.strike) && r.strike > 0 && Math.abs(r.strike - spot) / spot <= 0.08);
  if (!rows.length) {
    return { available: false, reason: "No option-chain rows within ±8% of spot for the selected expiry.", underlying: "", expiry: null, spot, pcr: null, pcrScope: "", strikes: [], ts: Date.now() };
  }
  const sumCall = rows.reduce((a, r) => a + r.callOI, 0);
  const sumPut = rows.reduce((a, r) => a + r.putOI, 0);
  const meanAbsDelta = Math.max(1, rows.reduce((a, r) => a + Math.abs(r.callDeltaOI) + Math.abs(r.putDeltaOI), 0) / (rows.length * 2));
  const putOIs = rows.map((r) => r.putOI).sort((a, b) => a - b);
  const callOIs = rows.map((r) => r.callOI).sort((a, b) => a - b);
  const pctl = (sorted: number[], v: number) => sorted.filter((x) => x <= v).length / Math.max(1, sorted.length);

  const maxPutOI = Math.max(...rows.map((r) => r.putOI));
  const maxCallOI = Math.max(...rows.map((r) => r.callOI));

  const strikes: StrikeIntel[] = [];
  const caveat = "Strike labels use OI + ΔOI + volume heuristics. OI change does not prove writer vs buyer initiation or intent.";
  for (const r of rows) {
    const below = r.strike <= spot;
    let label: StrikeLabel | null = null;
    let rule = "";
    if (below) {
      if (r.putOI >= maxPutOI * 0.9 && r.putOI > 0 && r.putDeltaOI > meanAbsDelta * 0.02) { label = "STRONG_SUPPORT"; rule = "Highest put-OI band with fresh put-OI addition (> 2% of mean |ΔOI|)."; }
      else if (r.putDeltaOI > meanAbsDelta * 0.02 && r.putOI > putOIs[Math.floor(putOIs.length * 0.4)]) { label = "SUPPORT_STRENGTHENING"; rule = "Put OI rising while put-OI rank above the 40th percentile."; }
      else if (r.putOI > 0 && pctl(putOIs, r.putOI) <= 0.4) { label = "WEAK_SUPPORT"; rule = "Put OI below the 40th percentile of the strike band."; }
      else if (r.putDeltaOI < -meanAbsDelta * 0.02) { label = spot - r.strike <= atr * 0.5 ? "SUPPORT_BREAKDOWN_RISK" : "SUPPORT_WEAKENING"; rule = "Put OI shedding (> 2% of mean |ΔOI|); breakdown risk flagged only when spot is within 0.5×ATR of the strike."; rule = label === "SUPPORT_BREAKDOWN_RISK" ? "Spot within 0.5×ATR of strike + put OI shedding — support at risk." : rule; }
    } else {
      if (r.callOI >= maxCallOI * 0.9 && r.callOI > 0 && r.callDeltaOI > meanAbsDelta * 0.02) { label = "STRONG_RESISTANCE"; rule = "Highest call-OI band with fresh call-OI addition."; }
      else if (r.callDeltaOI > meanAbsDelta * 0.02 && r.callOI > callOIs[Math.floor(callOIs.length * 0.4)]) { label = "RESISTANCE_STRENGTHENING"; rule = "Call OI rising while call-OI rank above the 40th percentile."; }
      else if (r.callOI > 0 && pctl(callOIs, r.callOI) <= 0.4) { label = "WEAK_RESISTANCE"; rule = "Call OI below the 40th percentile of the strike band."; }
      else if (r.callDeltaOI < -meanAbsDelta * 0.02) { label = r.strike - spot <= atr * 0.5 ? "RESISTANCE_BREAKOUT_RISK" : "RESISTANCE_WEAKENING"; rule = label === "RESISTANCE_BREAKOUT_RISK" ? "Spot within 0.5×ATR of strike + call OI shedding — resistance at risk." : "Call OI shedding (> 2% of mean |ΔOI|)."; }
    }
    if (label) strikes.push({ strike: r.strike, callOI: r.callOI, putOI: r.putOI, callDeltaOI: r.callDeltaOI, putDeltaOI: r.putDeltaOI, callVol: r.callVol, putVol: r.putVol, label, rule, caveat, ts: Date.now() });
  }

  return {
    available: true,
    reason: "",
    underlying: "",
    expiry: null,
    spot,
    pcr: sumCall > 0 ? Math.round((sumPut / sumCall) * 1000) / 1000 : null,
    pcrScope: "PCR = Σ put OI / Σ call OI over strikes within ±8% of spot for the selected expiry (documented scope).",
    strikes: strikes.sort((a, b) => a.strike - b.strike),
    ts: Date.now(),
  };
}

export function unavailableFutures(symbol: string, reason: string): FuturesIntel {
  return { available: false, reason, symbol, price: null, change: null, volume: null, oi: null, deltaOI: null, basis: null, priceOI: null, ts: null };
}

export function unavailableOptions(underlying: string, reason: string): OptionChainIntel {
  return { available: false, reason, underlying, expiry: null, spot: null, pcr: null, pcrScope: "", strikes: [], ts: null };
}
