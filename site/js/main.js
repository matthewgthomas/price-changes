// Entry point: load data, wire controls, render everything.

import {
  loadData, data, getSeries, annualValues, childIds, monthIndex, clampStart,
  fmtMonth,
} from "./data.js";
import {
  getState, setState, onChange, readHash, toggleSelected, colorFor,
} from "./state.js";
import { initTree, renderTree, revealInTree } from "./tree.js";
import { initChart, renderChart } from "./chart.js";
import { initOverview, renderOverview } from "./overview.js";
import { renderStory } from "./narrative.js";

const $ = (sel) => document.querySelector(sel);

const MONTH_NAMES = ["January","February","March","April","May","June",
  "July","August","September","October","November","December"];

async function init() {
  try {
    await loadData();
  } catch (err) {
    $("#story-body").innerHTML =
      `<p>Sorry — the data failed to load (${err.message}). Try refreshing.</p>`;
    return;
  }

  const dates = data().dates;
  const last = dates[dates.length - 1];

  // Default view: last 10 years, three everyday divisions, annual change
  const defaultStart = dates[Math.max(0, dates.length - 121)];
  readHash(new Set(data().byId.keys()), {
    metric: "annual",
    start: defaultStart,
    selected: ["01", "04", "07"],
    compareCpi: true,
    showEvents: true,
  });

  buildHeadlineStats();
  buildDateControls();
  buildMetricControl();
  buildCheckboxes();

  initTree($("#tree"), $("#tree-search"));
  initChart($("#chart"), $("#tooltip"));
  initOverview($("#overview-chart"), (id) => {
    const ok = toggleSelected(id);
    if (ok && getState().selected.includes(id)) revealInTree(id);
  });

  $("#clear-selection").addEventListener("click", () => setState({ selected: [] }));

  $("#release-info").textContent = data().meta.next_release
    ? `Next ONS release: ${data().meta.next_release}.`
    : "";

  // On small screens, start with the category panel collapsed so the chart
  // is immediately in reach
  if (window.innerWidth < 900) {
    $("#tree-panel").removeAttribute("open");
  }

  // Charts bake in computed CSS colours, so re-render if the scheme flips
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderAll);

  onChange(renderAll);
  renderAll();
}

function renderAll() {
  syncControls();
  renderTree();
  renderOverview();
  renderChart();
  renderLegend();
  renderMetricExplainer();
  renderStory($("#story-body"));
  $("#selected-count").textContent = `${getState().selected.length} selected`;
}

// ---- Headline stat cards -------------------------------------------------------

function buildHeadlineStats() {
  const dates = data().dates;
  const lastIdx = dates.length - 1;
  const cpiAnn = annualValues("00");
  const latest = cpiAnn[lastIdx];
  const prev = cpiAnn[lastIdx - 1];
  const yearAgo = cpiAnn[lastIdx - 12];

  const divisions = childIds("00").map((id) => getSeries(id))
    .filter((s) => s.level === "division")
    .map((s) => ({ name: s.name, rate: annualValues(s.id)[lastIdx] }))
    .filter((d) => d.rate != null);
  const hottest = divisions.reduce((a, b) => (b.rate > a.rate ? b : a));
  const coolest = divisions.reduce((a, b) => (b.rate < a.rate ? b : a));

  const deltaHtml = (cur, ref, refLabel) => {
    if (cur == null || ref == null) return "";
    const d = cur - ref;
    const cls = d > 0.05 ? "up" : d < -0.05 ? "down" : "flat";
    const arrow = d > 0.05 ? "▲" : d < -0.05 ? "▼" : "—";
    return `<span class="stat-delta ${cls}">${arrow} ${Math.abs(d).toFixed(1)}pt ${refLabel}</span>`;
  };

  const card = (label, sub, value, delta) => `
    <div class="stat-card">
      <span class="stat-label">${label}<small>${sub}</small></span>
      <span>
        <span class="stat-value">${value}</span><br>
        ${delta}
      </span>
    </div>`;

  $("#headline-stats").innerHTML =
    card("CPIH inflation", fmtMonth(dates[lastIdx]),
      latest != null ? `${latest.toFixed(1)}%` : "–",
      deltaHtml(latest, prev, "on last month") + " " + deltaHtml(latest, yearAgo, "on last year")) +
    card("Rising fastest", hottest.name,
      `${hottest.rate > 0 ? "+" : ""}${hottest.rate.toFixed(1)}%`, "") +
    card(coolest.rate < 0 ? "Falling fastest" : "Rising slowest", coolest.name,
      `${coolest.rate > 0 ? "+" : ""}${coolest.rate.toFixed(1)}%`, "");
}

// ---- Controls -----------------------------------------------------------------

function buildDateControls() {
  const dates = data().dates;
  const [firstY] = dates[0].split("-").map(Number);
  const [lastY] = dates[dates.length - 1].split("-").map(Number);

  const monthSel = $("#start-month");
  monthSel.innerHTML = MONTH_NAMES
    .map((m, i) => `<option value="${String(i + 1).padStart(2, "0")}">${m}</option>`)
    .join("");

  const yearSel = $("#start-year");
  let opts = "";
  for (let y = firstY; y <= lastY; y++) opts += `<option value="${y}">${y}</option>`;
  yearSel.innerHTML = opts;

  const apply = () => {
    const ym = clampStart(`${yearSel.value}-${monthSel.value}`);
    setState({ start: ym });
  };
  monthSel.addEventListener("change", apply);
  yearSel.addEventListener("change", apply);
}

function buildMetricControl() {
  document.querySelectorAll(".seg").forEach((btn) => {
    btn.addEventListener("click", () => setState({ metric: btn.dataset.metric }));
  });
}

function buildCheckboxes() {
  $("#compare-cpi").addEventListener("change", (e) =>
    setState({ compareCpi: e.target.checked }));
  $("#show-events").addEventListener("change", (e) =>
    setState({ showEvents: e.target.checked }));
}

function syncControls() {
  const st = getState();
  document.querySelectorAll(".seg").forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.metric === st.metric));
  const [y, m] = clampStart(st.start).split("-");
  $("#start-year").value = String(Number(y));
  $("#start-month").value = m;
  $("#compare-cpi").checked = st.compareCpi;
  $("#show-events").checked = st.showEvents;
}

// ---- Legend ---------------------------------------------------------------------

function renderLegend() {
  const st = getState();
  const legend = $("#legend");
  const chips = st.selected.map((id) => {
    const s = getSeries(id);
    return `
      <span class="legend-chip">
        <span class="swatch" style="background:${colorFor(id)}"></span>
        <span class="chip-name" title="${s.name}">${s.name}</span>
        <button type="button" class="remove" data-id="${id}" aria-label="Remove ${s.name}">×</button>
      </span>`;
  });
  if (st.compareCpi && !st.selected.includes("00")) {
    chips.push(`
      <span class="legend-chip cpi-chip">
        <span class="swatch dashed"></span>
        <span class="chip-name">Overall CPIH</span>
      </span>`);
  }
  legend.innerHTML = chips.length
    ? chips.join("")
    : `<span class="legend-empty">Nothing selected yet.</span>`;
  legend.querySelectorAll(".remove").forEach((btn) =>
    btn.addEventListener("click", () => toggleSelected(btn.dataset.id)));
}

function renderMetricExplainer() {
  const st = getState();
  const startTxt = fmtMonth(clampStart(st.start));
  $("#metric-explainer").textContent = {
    annual: "Year-on-year inflation: each point compares prices with the same month a year earlier.",
    since: `Cumulative price change since ${startTxt} — every line starts at zero.`,
    index: "Price level, indexed so that average 2015 prices = 100.",
  }[st.metric];
}

init();
