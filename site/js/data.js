// Data loading, hierarchy helpers and metric derivations.

let DATA = null;

export async function loadData() {
  const resp = await fetch("data/cpi.json");
  if (!resp.ok) throw new Error(`Failed to load data (${resp.status})`);
  const raw = await resp.json();

  const byId = new Map();
  raw.series.forEach((s, i) => byId.set(s.id, { ...s, order: i }));

  // Folder nodes (no values) for the special-aggregates branch
  const folders = new Map();
  (raw.folders || []).forEach((f) => folders.set(f.id, f));

  // children: parentId (or "" for roots) -> [child ids], series and folders mixed
  const children = new Map();
  const addChild = (parent, id) => {
    const key = parent || "";
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(id);
  };
  raw.series.forEach((s) => addChild(s.parent, s.id));
  (raw.folders || []).forEach((f) => addChild(f.parent, f.id));

  DATA = {
    meta: raw.meta,
    dates: raw.dates,
    byId,
    folders,
    children,
    annualCache: new Map(),
  };
  return DATA;
}

export const data = () => DATA;

export const getSeries = (id) => DATA.byId.get(id);
export const isFolder = (id) => DATA.folders.has(id);

export function nodeName(id) {
  if (DATA.folders.has(id)) return DATA.folders.get(id).name;
  return DATA.byId.get(id)?.name ?? id;
}

export function childIds(parentId) {
  const kids = DATA.children.get(parentId ?? "") || [];
  // Folders keep insertion order; series keep MM23 column order
  return kids;
}

export const monthIndex = (ym) => DATA.dates.indexOf(ym);

export function clampStart(ym) {
  if (monthIndex(ym) >= 0) return ym;
  const first = DATA.dates[0];
  const last = DATA.dates[DATA.dates.length - 1];
  return ym < first ? first : last;
}

// ---- Metric derivations ----------------------------------------------------

// Year-on-year % change, aligned to dates (null where unavailable)
export function annualValues(id) {
  if (DATA.annualCache.has(id)) return DATA.annualCache.get(id);
  const v = getSeries(id).values;
  const out = v.map((val, i) => {
    if (i < 12 || val == null || v[i - 12] == null || v[i - 12] === 0) return null;
    return (val / v[i - 12] - 1) * 100;
  });
  DATA.annualCache.set(id, out);
  return out;
}

// First index >= startIdx where the series has a value
export function firstValueIndex(id, startIdx) {
  const v = getSeries(id).values;
  for (let i = Math.max(0, startIdx); i < v.length; i++) {
    if (v[i] != null) return i;
  }
  return -1;
}

// Cumulative % change relative to the series value at/just after startIdx
export function sinceValues(id, startIdx) {
  const v = getSeries(id).values;
  const base = firstValueIndex(id, startIdx);
  if (base < 0) return v.map(() => null);
  const baseVal = v[base];
  return v.map((val, i) => {
    if (i < base || val == null) return null;
    return (val / baseVal - 1) * 100;
  });
}

export function metricValues(id, metric, startIdx) {
  if (metric === "annual") return annualValues(id);
  if (metric === "since") return sinceValues(id, startIdx);
  return getSeries(id).values;
}

// ---- Formatting helpers ------------------------------------------------------

const MONTHS_LONG = ["January","February","March","April","May","June",
  "July","August","September","October","November","December"];
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function ymToDate(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}

export function fmtMonth(ym, short = false) {
  const [y, m] = ym.split("-").map(Number);
  return `${(short ? MONTHS_SHORT : MONTHS_LONG)[m - 1]} ${y}`;
}

export const fmtPct = (x, dp = 1) =>
  x == null ? "–" : `${x.toFixed(dp)}%`;

export const fmtSigned = (x, dp = 1) =>
  x == null ? "–" : `${x > 0 ? "+" : ""}${x.toFixed(dp)}%`;

export const fmtGBP = (x) =>
  x.toLocaleString("en-GB", { style: "currency", currency: "GBP",
    minimumFractionDigits: 0, maximumFractionDigits: 0 });
