/**
 * Volume Profile engine.
 *
 * Method (documented): candles only carry OHLCV — the exact executed volume
 * at every price is NOT known. We therefore use a uniform-allocation
 * APPROXIMATION: each candle's volume is spread evenly across the price bins
 * its [low, high] range touches. This is standard for candle-based profiles
 * but is an approximation and is labelled as such everywhere it is shown.
 *
 * POC = bin with the highest allocated volume.
 * Value Area: expand from POC to neighbouring bins until `valueAreaPct`
 * (default 0.70) of total volume is covered (classic greedy expansion).
 * HVN = bins with volume >= 1.5 × mean bin volume (reported top 5).
 * LVN = bins with volume <= 0.5 × mean bin volume (reported top 5).
 *
 * POC/VAH/VAL/HVN/LVN are contextual references, not guaranteed S/R.
 */

import type { Candle, VolumeProfileResult, VolumeProfileBin } from "./types";
import { clamp } from "./prng";

export function volumeProfile(
  candles: Candle[],
  atr: number,
  valueAreaPct = 0.7,
): VolumeProfileResult | null {
  const src = candles.filter((c) => !c.live);
  if (src.length < 20 || atr <= 0) return null;
  const hi = Math.max(...src.map((c) => c.high));
  const lo = Math.min(...src.map((c) => c.low));
  const range = hi - lo;
  if (range <= 0) return null;

  const binCount = clamp(Math.round(range / Math.max(atr * 0.22, range / 60)), 14, 64);
  const binSize = range / binCount;
  const vol = new Array(binCount).fill(0);
  const binFor = (p: number) => clamp(Math.floor((p - lo) / binSize), 0, binCount - 1);

  let totalVolume = 0;
  for (const c of src) {
    const a = binFor(c.low);
    const b = binFor(c.high);
    const n = b - a + 1;
    for (let i = a; i <= b; i++) vol[i] += c.volume / n;
    totalVolume += c.volume;
  }

  const bins: VolumeProfileBin[] = vol.map((v, i) => ({ price: lo + (i + 0.5) * binSize, volume: Math.round(v) }));

  // POC
  let pocIdx = 0;
  for (let i = 1; i < binCount; i++) if (vol[i] > vol[pocIdx]) pocIdx = i;

  // Value area by greedy expansion from POC
  let covered = vol[pocIdx];
  let vahIdx = pocIdx;
  let valIdx = pocIdx;
  const target = totalVolume * valueAreaPct;
  while (covered < target && (vahIdx < binCount - 1 || valIdx > 0)) {
    const upV = vahIdx < binCount - 1 ? vol[vahIdx + 1] : -1;
    const dnV = valIdx > 0 ? vol[valIdx - 1] : -1;
    if (upV >= dnV) {
      vahIdx++;
      covered += upV;
    } else {
      valIdx--;
      covered += dnV;
    }
  }
  const poc = lo + (pocIdx + 0.5) * binSize;
  const vah = lo + (vahIdx + 1) * binSize;
  const val = lo + valIdx * binSize;

  // HVN / LVN
  const meanV = vol.reduce((a, b) => a + b, 0) / binCount;
  const hvn: { p: number; v: number }[] = [];
  const lvn: { p: number; v: number }[] = [];
  for (let i = 1; i < binCount - 1; i++) {
    const p = lo + (i + 0.5) * binSize;
    if (vol[i] >= meanV * 1.5 && vol[i] >= vol[i - 1] && vol[i] >= vol[i + 1]) hvn.push({ p, v: vol[i] });
    if (vol[i] <= meanV * 0.5 && vol[i] <= vol[i - 1] && vol[i] <= vol[i + 1]) lvn.push({ p, v: vol[i] });
  }
  const hvns = hvn.sort((a, b) => b.v - a.v).slice(0, 5).map((x) => x.p);
  const lvns = lvn.sort((a, b) => a.v - b.v).slice(0, 5).map((x) => x.p);

  // Position classification
  const price = src[src.length - 1].close;
  const tol = atr * 0.12;
  let position: VolumeProfileResult["position"] = "INSIDE_VALUE";
  let positionDetail = "Price is trading inside the developing value area.";
  const lastCloses = src.slice(-4).map((c) => c.close);
  if (Math.abs(price - vah) <= tol) {
    position = "TESTING_VAH";
    positionDetail = "Price is within 0.12×ATR of Value Area High — a value-boundary test is in progress.";
  } else if (Math.abs(price - val) <= tol) {
    position = "TESTING_VAL";
    positionDetail = "Price is within 0.12×ATR of Value Area Low — a value-boundary test is in progress.";
  } else if (price > vah && lastCloses.every((c) => c > vah)) {
    position = "ACCEPTING_ABOVE";
    positionDetail = "Multiple closes above VAH — the market is accepting prices above the prior value area.";
  } else if (price < val && lastCloses.every((c) => c < val)) {
    position = "ACCEPTING_BELOW";
    positionDetail = "Multiple closes below VAL — the market is accepting prices below the prior value area.";
  } else {
    const recent = src.slice(-10);
    const crosses = recent.slice(1).filter((c, i) => (c.close - poc) * (recent[i].close - poc) < 0).length;
    const r = Math.max(...recent.map((c) => c.high)) - Math.min(...recent.map((c) => c.low));
    if (crosses >= 3 && r < atr * 1.6) {
      position = "ROTATING_AROUND_POC";
      positionDetail = "Price has crossed the Point of Control repeatedly within a tight range — balance around fairest price.";
    }
  }

  return {
    method: "UNIFORM_ALLOCATION_FROM_OHLCV",
    approximation: true,
    bins,
    poc,
    vah,
    val,
    hvns,
    lvns,
    valueAreaPct,
    position,
    positionDetail,
    totalVolume,
  };
}
