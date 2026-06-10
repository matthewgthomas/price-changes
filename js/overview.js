// "Inflation right now" — annual rate by division for the latest month,
// horizontal bars, click to add a division to the main chart.

/* global d3 */

import { data, childIds, getSeries, annualValues, fmtMonth } from "./data.js";
import { getState } from "./state.js";

let container, onPick;
let width = 900;

export function initOverview(el, pickHandler) {
  container = el;
  onPick = pickHandler;
  const ro = new ResizeObserver((entries) => {
    const w = Math.floor(entries[0].contentRect.width);
    if (w > 0 && Math.abs(w - width) > 4) {
      width = w;
      renderOverview();
    }
  });
  ro.observe(container);
}

export function renderOverview() {
  if (!container || !data()) return;
  const dates = data().dates;
  const lastIdx = dates.length - 1;

  const divisions = childIds("00")
    .map((id) => getSeries(id))
    .filter((s) => s.level === "division");

  const rows = divisions
    .map((s) => ({ id: s.id, name: s.name, rate: annualValues(s.id)[lastIdx] }))
    .filter((r) => r.rate != null)
    .sort((a, b) => b.rate - a.rate);

  const cpiRate = annualValues("00")[lastIdx];

  document.getElementById("now-sub").textContent =
    `Annual price change in the 12 CPIH divisions, year to ${fmtMonth(dates[lastIdx])}. ` +
    `Overall CPIH: ${cpiRate?.toFixed(1)}%.`;

  const narrow = width < 640;
  const rowH = narrow ? 30 : 32;
  const margin = { top: 6, right: 52, bottom: 22, left: narrow ? 150 : 250 };
  const height = margin.top + rows.length * rowH + margin.bottom;

  const maxAbs = Math.max(d3.max(rows, (r) => Math.abs(r.rate)), Math.abs(cpiRate ?? 0), 1);
  const x = d3.scaleLinear()
    .domain([Math.min(0, d3.min(rows, (r) => r.rate)), maxAbs])
    .nice()
    .range([margin.left, width - margin.right]);

  const yPos = (i) => margin.top + i * rowH;

  const svg = d3.create("svg")
    .attr("viewBox", [0, 0, width, height]);

  const styles = getComputedStyle(document.body);
  const up = styles.getPropertyValue("--accent").trim();
  const down = styles.getPropertyValue("--cool").trim();
  const inkFaint = styles.getPropertyValue("--ink-faint").trim();
  const ink = styles.getPropertyValue("--ink").trim();

  const selected = new Set(getState().selected);

  const truncate = (name, n) => name.length > n ? name.slice(0, n - 1) + "…" : name;

  const g = svg.selectAll("g.bar").data(rows).join("g")
    .attr("class", "bar")
    .attr("transform", (_, i) => `translate(0,${yPos(i)})`)
    .style("cursor", "pointer")
    .on("click", (_, d) => onPick && onPick(d.id));

  g.append("title").text((d) => `${d.name}: ${d.rate.toFixed(1)}% — click to chart`);

  // full-width hit area
  g.append("rect")
    .attr("x", 0).attr("y", 0).attr("width", width).attr("height", rowH)
    .attr("fill", "transparent");

  g.append("text")
    .attr("x", margin.left - 10).attr("y", rowH / 2).attr("dy", "0.35em")
    .attr("text-anchor", "end")
    .attr("font-size", narrow ? 11.5 : 13)
    .attr("font-weight", (d) => selected.has(d.id) ? 700 : 500)
    .attr("fill", ink)
    .text((d) => truncate(d.name, narrow ? 22 : 34));

  g.append("rect").attr("class", "fill")
    .attr("x", (d) => Math.min(x(0), x(d.rate)))
    .attr("y", rowH / 2 - (narrow ? 8 : 9))
    .attr("width", (d) => Math.max(Math.abs(x(d.rate) - x(0)), 1.5))
    .attr("height", narrow ? 16 : 18)
    .attr("rx", 3)
    .attr("fill", (d) => d.rate >= 0 ? up : down)
    .attr("opacity", (d) => selected.has(d.id) ? 1 : 0.82);

  g.append("text")
    .attr("x", (d) => d.rate >= 0 ? x(d.rate) + 7 : x(d.rate) - 7)
    .attr("y", rowH / 2).attr("dy", "0.35em")
    .attr("text-anchor", (d) => d.rate >= 0 ? "start" : "end")
    .attr("font-size", narrow ? 11.5 : 12.5)
    .attr("font-weight", 600)
    .attr("fill", (d) => d.rate >= 0 ? up : down)
    .text((d) => `${d.rate > 0 ? "+" : ""}${d.rate.toFixed(1)}%`);

  // zero axis + overall CPI reference
  svg.append("line")
    .attr("x1", x(0)).attr("x2", x(0))
    .attr("y1", margin.top - 2).attr("y2", height - margin.bottom + 2)
    .attr("stroke", inkFaint).attr("stroke-width", 1);

  if (cpiRate != null) {
    const cx = x(cpiRate);
    svg.append("line")
      .attr("x1", cx).attr("x2", cx)
      .attr("y1", margin.top - 2).attr("y2", height - margin.bottom + 2)
      .attr("stroke", ink).attr("stroke-dasharray", "4 4").attr("opacity", 0.6);
    svg.append("text")
      .attr("x", cx).attr("y", height - 6)
      .attr("text-anchor", "middle")
      .attr("font-size", 11).attr("font-weight", 600).attr("fill", ink)
      .attr("opacity", 0.75)
      .text(`CPIH ${cpiRate.toFixed(1)}%`);
  }

  container.replaceChildren(svg.node());
}
