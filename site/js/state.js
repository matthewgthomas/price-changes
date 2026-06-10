// App state with URL-hash persistence, so any view is shareable.

export const MAX_SELECTED = 8;

export const PALETTE = [
  "#e4572e", "#2e86ab", "#9c528b", "#1b998b",
  "#f3a712", "#5d576b", "#a4243b", "#3f88c5",
];

const state = {
  metric: "annual",        // "annual" | "since" | "index"
  start: null,             // "YYYY-MM"
  selected: [],            // series ids, in selection order
  compareCpi: true,
  showEvents: true,
};

const listeners = [];

export const getState = () => state;

export function onChange(fn) {
  listeners.push(fn);
}

export function setState(patch, { silent = false } = {}) {
  Object.assign(state, patch);
  writeHash();
  if (!silent) listeners.forEach((fn) => fn(state));
}

export function toggleSelected(id) {
  const sel = state.selected.slice();
  const i = sel.indexOf(id);
  if (i >= 0) sel.splice(i, 1);
  else {
    if (sel.length >= MAX_SELECTED) return false;
    sel.push(id);
  }
  setState({ selected: sel });
  return true;
}

export const colorFor = (id) => {
  const i = state.selected.indexOf(id);
  return i >= 0 ? PALETTE[i % PALETTE.length] : "#999";
};

// ---- URL hash ----------------------------------------------------------------

function writeHash() {
  const p = new URLSearchParams();
  p.set("m", state.metric);
  if (state.start) p.set("s", state.start);
  if (state.selected.length) p.set("ids", state.selected.join(","));
  if (!state.compareCpi) p.set("cpi", "0");
  if (!state.showEvents) p.set("ev", "0");
  history.replaceState(null, "", "#" + p.toString());
}

export function readHash(validIds, defaultState) {
  Object.assign(state, defaultState);
  const h = location.hash.replace(/^#/, "");
  if (!h) return;
  try {
    const p = new URLSearchParams(h);
    const m = p.get("m");
    if (["annual", "since", "index"].includes(m)) state.metric = m;
    const s = p.get("s");
    if (s && /^\d{4}-\d{2}$/.test(s)) state.start = s;
    const ids = (p.get("ids") || "").split(",").filter((id) => validIds.has(id));
    if (ids.length) state.selected = ids.slice(0, MAX_SELECTED);
    if (p.get("cpi") === "0") state.compareCpi = false;
    if (p.get("ev") === "0") state.showEvents = false;
  } catch { /* malformed hash: keep defaults */ }
}
