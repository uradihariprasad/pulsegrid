"use client";

import { useEffect, useRef } from "react";

interface Props {
  bundle: any;
  height?: number;
  showEma?: boolean;
  showVwap?: boolean;
  showZones?: boolean;
  showEvents?: boolean;
  showScenario?: boolean;
}

const IST_SHIFT = 19800; // seconds — for IST wall-clock display on the time axis
const t = (ms: number) => Math.floor(ms / 1000) + IST_SHIFT;

export default function PriceChart({ bundle, height = 420, showEma = true, showVwap = true, showZones = true, showEvents = true, showScenario = true }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const apiRef = useRef<any>({});
  const symbolTfRef = useRef<string>("");

  const key = `${bundle?.symbol}|${bundle?.tf}`;

  // create chart once per symbol/tf
  useEffect(() => {
    let disposed = false;
    (async () => {
      const L = await import("lightweight-charts");
      if (disposed || !hostRef.current) return;
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
      const chart = L.createChart(hostRef.current, {
        height,
        layout: {
          background: { type: L.ColorType.Solid, color: "transparent" },
          textColor: "#8b96a5",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
        },
        grid: { vertLines: { color: "rgba(26,33,44,0.55)" }, horzLines: { color: "rgba(26,33,44,0.55)" } },
        crosshair: { mode: L.CrosshairMode.Normal, vertLine: { color: "#38445a", labelBackgroundColor: "#1c2531" }, horzLine: { color: "#38445a", labelBackgroundColor: "#1c2531" } },
        rightPriceScale: { borderColor: "#1a212c" },
        timeScale: { borderColor: "#1a212c", timeVisible: true, secondsVisible: false, rightOffset: 6 },
        localization: { priceFormatter: (v: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(v) },
      });
      const candles = chart.addCandlestickSeries({
        upColor: "#17c784", downColor: "#ea3943",
        wickUpColor: "#17c784", wickDownColor: "#ea3943",
        borderVisible: false,
      });
      const volume = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol", color: "#2a3442" });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      candles.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: 0.2 } });
      const mk = (color: string, width: 1 | 2, dashed: boolean, title?: string) =>
        chart.addLineSeries({ color, lineWidth: width, lineStyle: dashed ? L.LineStyle.Dashed : L.LineStyle.Solid, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title });
      apiRef.current = {
        candles, volume,
        ema9: mk("#5aa2ff", 1, false, "EMA9"),
        ema21: mk("#f0b90b", 1, false, "EMA21"),
        ema50: mk("#a371f7", 1, false, "EMA50"),
        ema200: mk("#4b5563", 2, false, "EMA200"),
        vwap: mk("#3fd3d3", 1, true, "VWAP"),
      };
      chartRef.current = chart;
      symbolTfRef.current = key;
      (window as any).__lc = L;

      const ro = new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect.width;
        if (w && chartRef.current) chartRef.current.applyOptions({ width: Math.floor(w) });
      });
      ro.observe(hostRef.current);
      (chartRef.current as any).__ro = ro;
    })();
    return () => {
      disposed = true;
      const ro = (chartRef.current as any)?.__ro as ResizeObserver | undefined;
      ro?.disconnect();
      chartRef.current?.remove();
      chartRef.current = null;
      apiRef.current = {};
    };
  }, [key, height]);

  // push data
  useEffect(() => {
    const chart = chartRef.current;
    const api = apiRef.current;
    if (!chart || !api.candles || !bundle?.candles?.length) return;
    const L = (window as any).__lc;

    const cs = bundle.candles as any[];
    api.candles.setData(cs.map((c) => ({ time: t(c.ts) as any, open: c.open, high: c.high, low: c.low, close: c.close })));
    api.volume.setData(cs.map((c) => ({ time: t(c.ts) as any, value: c.volume, color: c.close >= c.open ? "rgba(23,199,132,0.45)" : "rgba(234,57,67,0.45)" })));

    const lineData = (arr: (number | null)[]) =>
      cs.map((c, i) => (arr[i] != null ? { time: t(c.ts) as any, value: arr[i] as number } : null)).filter(Boolean) as any[];
    api.ema9.setData(showEma ? lineData(bundle.indicators.ema9) : []);
    api.ema21.setData(showEma ? lineData(bundle.indicators.ema21) : []);
    api.ema50.setData(showEma ? lineData(bundle.indicators.ema50) : []);
    api.ema200.setData(showEma ? lineData(bundle.indicators.ema200) : []);
    api.vwap.setData(showVwap ? lineData(bundle.indicators.vwap) : []);

    // zone price lines
    (api.candles as any).__lines?.forEach((pl: any) => api.candles.removePriceLine(pl));
    const lines: any[] = [];
    if (showZones && L) {
      const price = bundle.last.price;
      const zones = (bundle.zones ?? [])
        .filter((z: any) => z.status !== "INVALIDATED")
        .slice(0, 9);
      const colorFor = (z: any) => {
        if (z.type === "POC") return "#a371f7";
        if (z.type === "VAH" || z.type === "VAL") return "#8b6fd0";
        if (z.type === "PDH" || z.type === "PDL" || z.type === "PWH" || z.type === "PWL") return "#f0b90b";
        if (z.type === "ORH" || z.type === "ORL") return "#5aa2ff";
        return z.side === "resistance" ? "#ea3943" : "#17c784";
      };
      for (const z of zones) {
        const color = colorFor(z);
        const dashed = z.status === "POTENTIALLY_SWEPT" || z.status === "BROKEN" || z.status === "RECLAIMED";
        const st = L.LineStyle[dashed ? "Dashed" : "Solid"];
        const label = `${z.type}${z.status === "POTENTIALLY_SWEPT" ? " ·swept" : z.status === "TESTING" ? " ·test" : ""} ${z.strength}`;
        lines.push(api.candles.createPriceLine({ price: z.top, color, lineWidth: 1, lineStyle: st, axisLabelVisible: false, title: label }));
        lines.push(api.candles.createPriceLine({ price: z.bottom, color, lineWidth: 1, lineStyle: st, axisLabelVisible: false, title: "" }));
      }
      if (bundle.day?.prevHigh && showZones) {
        void price;
      }
    }
    if (showScenario && L && bundle.scenario && bundle.scenario.status !== "NO_TRADE") {
      const s = bundle.scenario;
      if (s.entryZone) for (const p of s.entryZone) lines.push(api.candles.createPriceLine({ price: p, color: "#5aa2ff", lineWidth: 1, lineStyle: L.LineStyle.Solid, title: "ENTRY" }));
      if (s.stop) lines.push(api.candles.createPriceLine({ price: s.stop, color: "#ea3943", lineWidth: 2, lineStyle: L.LineStyle.Solid, title: "SL" }));
      if (s.t1) lines.push(api.candles.createPriceLine({ price: s.t1, color: "#17c784", lineWidth: 1, lineStyle: L.LineStyle.Dashed, title: "T1" }));
      if (s.t2) lines.push(api.candles.createPriceLine({ price: s.t2, color: "#17c784", lineWidth: 1, lineStyle: L.LineStyle.Dotted, title: "T2" }));
    }
    (api.candles as any).__lines = lines;

    // markers
    if (showEvents && bundle.events?.length) {
      const markers = (bundle.events as any[])
        .map((e) => ({
          time: t(e.ts) as any,
          position: e.kind === "SWEEP" ? "aboveBar" : e.kind === "BOS" || e.kind === "CHOCH" ? "belowBar" : "aboveBar",
          color: e.kind === "SWEEP" ? "#f0b90b" : e.kind === "CHOCH" ? "#a371f7" : e.kind === "BOS" ? "#5aa2ff" : "#55606f",
          shape: e.kind === "SWEEP" ? "arrowDown" : e.kind === "BOS" || e.kind === "CHOCH" ? "arrowUp" : "circle",
          text: e.kind,
          size: 0,
        }))
        .sort((a, b) => (a.time as number) - (b.time as number));
      api.candles.setMarkers(markers as any);
    } else {
      api.candles.setMarkers([]);
    }

    // keep the visible window stable around the right edge
    chart.timeScale().scrollToRealTime();
  }, [bundle, showEma, showVwap, showZones, showEvents, showScenario]);

  return <div ref={hostRef} style={{ height }} className="w-full [&_a]:hidden" />;
}
