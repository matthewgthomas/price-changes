// Deterministic robo-journalism: turns the current view into prose.
// No randomness — phrasing is picked by hashing the series id and data month,
// so the same data always tells the same story.

import {
  data, getSeries, annualValues, firstValueIndex, monthIndex, clampStart,
  fmtMonth, fmtGBP,
} from "./data.js";
import { getState } from "./state.js";

// ---- Deterministic phrase picking -------------------------------------------

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const pick = (arr, seed) => arr[hashStr(seed) % arr.length];

const ROSE = ["climbed", "rose", "went up", "increased"];
const SURGED = ["surged", "soared", "shot up", "jumped"];
const FELL = ["fell", "dropped", "slid", "came down"];

// ---- Per-series statistics ---------------------------------------------------

function statsFor(id, startIdx) {
  const s = getSeries(id);
  const dates = data().dates;
  const lastIdx = dates.length - 1;
  const v = s.values;

  const baseIdx = firstValueIndex(id, startIdx);
  if (baseIdx < 0 || baseIdx >= lastIdx || v[lastIdx] == null) return null;

  const ann = annualValues(id);
  const total = (v[lastIdx] / v[baseIdx] - 1) * 100;
  const years = (lastIdx - baseIdx) / 12;

  let peak = null, trough = null;
  let runLen = 0, runEnd = -1, bestRunLen = 0, bestRunEnd = -1;
  for (let i = Math.max(baseIdx, 12); i <= lastIdx; i++) {
    const a = ann[i];
    if (a == null) { runLen = 0; continue; }
    if (peak === null || a > ann[peak]) peak = i;
    if (trough === null || a < ann[trough]) trough = i;
    if (a < 0) {
      runLen += 1; runEnd = i;
      if (runLen > bestRunLen) { bestRunLen = runLen; bestRunEnd = runEnd; }
    } else runLen = 0;
  }

  return {
    id, name: s.name, baseIdx, baseYm: dates[baseIdx],
    startedLate: baseIdx > startIdx,
    total, years,
    annualised: years >= 1 ? ((v[lastIdx] / v[baseIdx]) ** (1 / years) - 1) * 100 : null,
    latestAnnual: ann[lastIdx],
    prevAnnual: ann[lastIdx - 1],
    peakAnnual: peak != null ? { val: ann[peak], ym: dates[peak] } : null,
    troughAnnual: trough != null ? { val: ann[trough], ym: dates[trough] } : null,
    deflation: bestRunLen >= 6
      ? { months: bestRunLen, endYm: dates[bestRunEnd] }
      : null,
  };
}

// ---- Sentence builders ---------------------------------------------------------

const pct = (x, dp = 1) => `${Math.abs(x).toFixed(dp)}%`;
const signedPct = (x, dp = 1) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(dp)}%`;

function changePhrase(st, seed) {
  const t = st.total;
  if (t >= 100) {
    const mult = 1 + t / 100;
    const word = mult >= 2.95 ? `more than ${["trebled", "tripled"][hashStr(seed) % 2]}` : "more than doubled";
    return `${word} (${signedPct(t, 0)})`;
  }
  if (t >= 40) return `${pick(SURGED, seed)} ${pct(t, 0)}`;
  if (t >= 2) return `${pick(ROSE, seed)} ${pct(t, t >= 10 ? 0 : 1)}`;
  if (t > -2) return `barely moved (${signedPct(t)})`;
  return `${pick(FELL, seed)} ${pct(t, t <= -10 ? 0 : 1)}`;
}

function vsCpiPhrase(st, cpi) {
  if (!cpi || st.id === "00") return "";
  // Compare like with like: if this series starts later than the chosen
  // start date, measure overall CPI over the same shorter window
  if (st.startedLate) cpi = statsFor("00", st.baseIdx) || cpi;
  const diff = st.total - cpi.total;
  if (st.total < -2 && cpi.total > 2) return ` — getting cheaper even as prices in general rose ${pct(cpi.total, 0)}`;
  if (diff > Math.max(8, cpi.total)) return ` — far outpacing overall CPIH (${signedPct(cpi.total, 0)})`;
  if (diff > 5) return `, ahead of overall CPIH (${signedPct(cpi.total, 0)})`;
  if (diff < -Math.max(8, cpi.total * 0.5)) return ` — well behind overall CPIH (${signedPct(cpi.total, 0)})`;
  if (diff < -5) return `, lagging overall CPIH (${signedPct(cpi.total, 0)})`;
  return `, broadly tracking overall CPIH (${signedPct(cpi.total, 0)})`;
}

function directionPhrase(st) {
  if (st.latestAnnual == null) return "";
  const cur = st.latestAnnual, prev = st.prevAnnual;
  if (cur < 0) {
    let trend = "";
    if (prev != null) {
      if (cur < prev - 0.05) trend = ", and the falls are deepening";
      else if (cur > prev + 0.05) trend = ", though the falls are easing";
    }
    return ` Right now prices are falling, by ${pct(cur)} a year${trend}.`;
  }
  let trend = "";
  if (prev != null) {
    if (cur > prev + 0.05) trend = " and rising";
    else if (cur < prev - 0.05) trend = " and easing";
    else trend = " and steady";
  }
  return ` The current annual rate is ${pct(cur)}${trend}.`;
}

function peakSentence(st, startYm) {
  if (!st.peakAnnual) return "";
  const p = st.peakAnnual;
  if (p.val >= 4) {
    const seed = st.id + p.ym;
    return ` Annual inflation ${st.id === "00" ? "in this period " : ""}peaked at <strong>${pct(p.val)}</strong> in ${fmtMonth(p.ym)}.`;
  }
  return "";
}

// ---- Story assembly -------------------------------------------------------------

export function renderStory(el) {
  const st = getState();
  const dates = data().dates;
  const lastIdx = dates.length - 1;
  const lastYm = dates[lastIdx];
  const startYm = clampStart(st.start);
  const startIdx = Math.max(0, monthIndex(startYm));

  const cpi = statsFor("00", startIdx);
  const paras = [];

  // ---- Lede: overall CPI since the chosen start date
  if (cpi) {
    const seed = "00" + lastYm;
    const cost = fmtGBP(100 * (1 + cpi.total / 100));
    let lede = `Since <strong>${fmtMonth(startYm)}</strong>, prices overall have ` +
      `${changePhrase(cpi, seed)}: what cost ${fmtGBP(100)} then costs about ` +
      `<strong>${cost}</strong> in ${fmtMonth(lastYm)}.`;
    if (cpi.latestAnnual != null) {
      const dir = cpi.prevAnnual != null
        ? (cpi.latestAnnual > cpi.prevAnnual + 0.05 ? "up from" :
           cpi.latestAnnual < cpi.prevAnnual - 0.05 ? "down from" : "unchanged from")
        : "";
      lede += ` Headline CPIH inflation is <strong>${pct(cpi.latestAnnual)}</strong>` +
        (dir && dir !== "unchanged from"
          ? `, ${dir} ${pct(cpi.prevAnnual)} the month before.`
          : dir ? `, the same as the month before.` : ".");
    }
    paras.push(`<p class="lede">${lede}</p>`);
    if (cpi.peakAnnual && cpi.peakAnnual.val >= 4) {
      paras.push(`<p>${peakSentence(cpi, startYm).trim()}${
        cpi.troughAnnual && cpi.troughAnnual.val < 0.5
          ? ` At the other extreme, it fell as low as ${pct(cpi.troughAnnual.val)} in ${fmtMonth(cpi.troughAnnual.ym)}.`
          : ""}</p>`);
    }
  }

  // ---- Per-series paragraphs
  const picked = st.selected.filter((id) => id !== "00");
  const stats = picked.map((id) => statsFor(id, startIdx)).filter(Boolean);

  for (const s of stats.slice(0, 4)) {
    const seed = s.id + lastYm;
    let p = `<strong>${s.name}</strong> ` +
      `${s.startedLate ? `(data from ${fmtMonth(s.baseYm)}) ` : ""}` +
      `${changePhrase(s, seed)}${vsCpiPhrase(s, cpi)}.`;
    if (s.annualised != null && s.years >= 3 && Math.abs(s.total) >= 10) {
      p += ` That works out at ${pct(s.annualised)} a year, compounded.`;
    }
    p += peakSentence(s, startYm);
    p += directionPhrase(s);
    if (s.deflation && s.total > -2) {
      p += ` Notably, prices fell year-on-year for ${s.deflation.months >= 24
        ? `over ${Math.floor(s.deflation.months / 12)} years`
        : `${s.deflation.months} straight months`} up to ${fmtMonth(s.deflation.endYm)}.`;
    }
    paras.push(`<p>${p}</p>`);
  }
  if (stats.length > 4) {
    paras.push(`<p>…plus ${stats.length - 4} more ${stats.length - 4 === 1 ? "series" : "series"} on the chart.</p>`);
  }

  // ---- Superlatives across the selection
  if (stats.length >= 2) {
    const sorted = [...stats].sort((a, b) => b.total - a.total);
    const hi = sorted[0], lo = sorted[sorted.length - 1];
    const qualify = (s) => s.startedLate ? ` since ${fmtMonth(s.baseYm, true)}` : "";
    if (hi.total - lo.total > 5) {
      let p = `Of your picks, <strong>${hi.name}</strong> ${pick(ROSE, hi.id)} fastest ` +
        `(${signedPct(hi.total, 0)}${qualify(hi)}) while <strong>${lo.name}</strong> ` +
        `${lo.total < 0 ? `actually became cheaper (${signedPct(lo.total, 0)}${qualify(lo)})` : `rose least (${signedPct(lo.total, 0)}${qualify(lo)})`}.`;
      paras.push(`<p>${p}</p>`);
    }
  }

  // ---- Gentle nudge when nothing is selected
  if (!stats.length) {
    paras.push(`<p>Pick categories from the explorer — try drilling from
      <em>Food and non-alcoholic beverages</em> down to individual items like bread,
      butter or coffee — and this story will rewrite itself around your selection.</p>`);
  }

  el.innerHTML = paras.join("\n");
}
