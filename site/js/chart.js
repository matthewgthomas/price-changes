// Main interactive line chart (D3).

/* global d3 */

import {
  data, getSeries, metricValues, monthIndex, ymToDate, fmtMonth, clampStart,
} from "./data.js";
import { getState, colorFor } from "./state.js";

const EVENTS = [
  { ym: "1992-09", label: "Black Wednesday" },
  { ym: "2008-09", label: "Financial crisis" },
  { ym: "2011-01", label: "VAT rises to 20%" },
  { ym: "2016-06", label: "Brexit vote" },
  { ym: "2020-03", label: "Covid lockdown" },
  { ym: "2022-02", label: "Ukraine invaded" },
];

const MARGIN = { top: 26, right: 14, bottom: 30, left: 48 };

let chartEl, tooltipEl, emptyMsgEl;
let width = 800;

export function initChart(el, tipEl) {
  chartEl = el;
  tooltipEl = tipEl;
  emptyMsgEl = document.createElement("div");
  emptyMsgEl.className = "chart-empty-msg";
  chartEl.parentElement.appendChild(emptyMsgEl);

  const ro = new ResizeObserver((entries) => {
    const w = Math.floor(entries[0].contentRect.width);
    if (w > 0 && Math.abs(w - width) > 4) {
      width = w;
      renderChart();
    }
  });
  ro.observe(chartEl);
}

// Build {id, name, color, dashed, points:[{date, value}]} for everything visible
function visibleSeries() {
  const st = getState();
  const startIdx = Math.max(0, monthIndex(clampStart(st.start)));
  const dates = data().dates;

  const ids = st.selected.slice();
  const showRef = st.compareCpi && !ids.includes("00");

  const make = (id, dashed) => {
    const vals = metricValues(id, st.metric, startIdx);
    const points = [];
    for (let i = startIdx; i < dates.length; i++) {
      points.push({ date: ymToDate(dates[i]), ym: dates[i], value: vals[i] });
    }
    return {
      id,
      name: getSeries(id).name,
      color: dashed ? null : colorFor(id),
      dashed,
      points,
    };
  };

  const series = ids.map((id) => make(id, false));
  if (showRef) series.push(make("00", true));
  return { series, startIdx };
}

export function renderChart() {
  if (!chartEl || !data()) return;
  const st = getState();
  const { series } = visibleSeries();

  const height = width < 560 ? 340 : 430;
  const iw = width - MARGIN.left - MARGIN.right;
  const ih = height - MARGIN.top - MARGIN.bottom;

  chartEl.replaceChildren();

  if (!series.length) {
    emptyMsgEl.textContent =
      "Pick one or more categories from the list to start charting — or tap a bar above.";
    const svg = d3.create("svg").attr("viewBox", [0, 0, width, height]);
    chartEl.appendChild(svg.node());
    return;
  }
  emptyMsgEl.textContent = "";

  const allPoints = series.flatMap((s) => s.points.filter((p) => p.value != null));
  if (!allPoints.length) {
    emptyMsgEl.textContent = "No data for this combination — try an earlier start date.";
    return;
  }

  const x = d3.scaleUtc()
    .domain(d3.extent(series[0].points, (p) => p.date))
    .range([MARGIN.left, MARGIN.left + iw]);

  let [yMin, yMax] = d3.extent(allPoints, (p) => p.value);
  if (st.metric !== "index") { yMin = Math.min(yMin, 0); yMax = Math.max(yMax, 0); }
  const pad = (yMax - yMin) * 0.06 || 1;
  const y = d3.scaleLinear()
    .domain([yMin - pad, yMax + pad]).nice()
    .range([MARGIN.top + ih, MARGIN.top]);

  const svg = d3.create("svg")
    .attr("viewBox", [0, 0, width, height])
    .attr("aria-label", "Line chart of selected CPI series");

  // Grid + axes
  const yTicks = y.ticks(width < 560 ? 5 : 7);
  svg.append("g").attr("class", "grid")
    .selectAll("line").data(yTicks).join("line")
    .attr("x1", MARGIN.left).attr("x2", MARGIN.left + iw)
    .attr("y1", (d) => y(d)).attr("y2", (d) => y(d));

  const yFmt = (d) => st.metric === "index" ? d3.format("~f")(d) : d3.format("~f")(d) + "%";
  svg.append("g").attr("class", "axis")
    .attr("transform", `translate(${MARGIN.left},0)`)
    .call(d3.axisLeft(y).tickValues(yTicks).tickFormat(yFmt).tickSize(0))
    .call((g) => g.select(".domain").remove());

  svg.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${MARGIN.top + ih})`)
    .call(d3.axisBottom(x).ticks(width < 560 ? 4 : 7).tickSizeOuter(0));

  // Zero line for % metrics
  if (st.metric !== "index" && y.domain()[0] < 0 && y.domain()[1] > 0) {
    svg.append("line").attr("class", "zero-line")
      .attr("x1", MARGIN.left).attr("x2", MARGIN.left + iw)
      .attr("y1", y(0)).attr("y2", y(0));
  }

  // Event markers
  if (st.showEvents) {
    const [d0, d1] = x.domain();
    EVENTS.filter((e) => {
      const d = ymToDate(e.ym);
      return d >= d0 && d <= d1;
    }).forEach((e) => {
      const xPos = x(ymToDate(e.ym));
      svg.append("line").attr("class", "event-line")
        .attr("x1", xPos).attr("x2", xPos)
        .attr("y1", MARGIN.top - 4).attr("y2", MARGIN.top + ih);
      if (width >= 560) {
        svg.append("text").attr("class", "event-label")
          .attr("x", xPos).attr("y", MARGIN.top - 10)
          .attr("text-anchor", "middle")
          .text(e.label);
      }
    });
  }

  // Lines
  const line = d3.line()
    .defined((p) => p.value != null)
    .x((p) => x(p.date))
    .y((p) => y(p.value))
    .curve(d3.curveMonotoneX);

  for (const s of series) {
    svg.append("path")
      .attr("class", s.dashed ? "cpi-ref" : "series-line")
      .attr("stroke", s.dashed ? null : s.color)
      .attr("d", line(s.points));
  }

  // End-of-line value labels, nudged apart so they don't overlap
  const paper = getComputedStyle(document.body).getPropertyValue("--paper-raised").trim();
  const labels = series
    .map((s) => {
      const last = [...s.points].reverse().find((p) => p.value != null);
      return last ? { s, last, y: y(last.value) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) {
    if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;
  }
  const valFmt = (v) => st.metric === "index"
    ? v.toFixed(1)
    : (st.metric === "since" && v > 0 ? "+" : "") + v.toFixed(1) + "%";
  for (const { s, last, y: ly } of labels) {
    svg.append("text").attr("class", "end-label")
      .attr("x", x(last.date) + 4).attr("y", ly + 4)
      .attr("fill", s.dashed ? "currentColor" : s.color)
      .attr("stroke", paper)
      .attr("text-anchor", "end")
      .attr("dx", -6)
      .text(valFmt(last.value));
  }

  // ---- Hover / touch interaction ----
  const crosshair = svg.append("line").attr("class", "crosshair")
    .attr("y1", MARGIN.top).attr("y2", MARGIN.top + ih).style("display", "none");
  const dots = svg.append("g");

  const bisect = d3.bisector((p) => p.date).center;

  function showTip(event) {
    const [mx] = d3.pointer(event, svg.node());
    const i = bisect(series[0].points, x.invert(mx));
    const pts = series.map((s) => ({ s, p: s.points[i] })).filter((d) => d.p);
    if (!pts.length) return;
    const xPos = x(pts[0].p.date);

    crosshair.style("display", null).attr("x1", xPos).attr("x2", xPos);
    dots.selectAll("circle")
      .data(pts.filter((d) => d.p.value != null))
      .join("circle")
      .attr("cx", (d) => x(d.p.date))
      .attr("cy", (d) => y(d.p.value))
      .attr("r", 3.5)
      .attr("fill", (d) => d.s.dashed ? "currentColor" : d.s.color);

    const rows = pts
      .filter((d) => d.p.value != null)
      .sort((a, b) => b.p.value - a.p.value)
      .map((d) => `
        <div class="tip-row">
          <span class="swatch" style="background:${d.s.dashed ? "var(--cpi-line)" : d.s.color}"></span>
          <span class="name">${d.s.name}</span>
          <span class="val">${valFmt(d.p.value)}</span>
        </div>`)
      .join("");
    tooltipEl.innerHTML = `<div class="tip-date">${fmtMonth(pts[0].p.ym)}</div>${rows}`;
    tooltipEl.hidden = false;

    const wrapRect = chartEl.parentElement.getBoundingClientRect();
    const chartRect = chartEl.getBoundingClientRect();
    const tipW = tooltipEl.offsetWidth;
    const relX = chartRect.left - wrapRect.left + (xPos / width) * chartRect.width;
    const flip = relX + tipW + 24 > wrapRect.width;
    tooltipEl.style.left = `${flip ? relX - tipW - 14 : relX + 14}px`;
    tooltipEl.style.top = `${chartRect.top - wrapRect.top + 24}px`;
  }

  function hideTip() {
    tooltipEl.hidden = true;
    crosshair.style("display", "none");
    dots.selectAll("circle").remove();
  }

  svg.append("rect")
    .attr("x", MARGIN.left).attr("y", MARGIN.top)
    .attr("width", iw).attr("height", ih)
    .attr("fill", "transparent")
    .style("touch-action", "pan-y")
    .on("pointermove", showTip)
    .on("pointerleave", hideTip);

  chartEl.appendChild(svg.node());
}
