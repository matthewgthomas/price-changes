// Hierarchical component explorer with search and checkbox selection.

import { childIds, getSeries, isFolder, nodeName } from "./data.js";
import { getState, toggleSelected, MAX_SELECTED } from "./state.js";

const expanded = new Set(["00"]);
let container, searchInput, query = "";

const CARET_SVG =
  `<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
     <path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function initTree(el, searchEl) {
  container = el;
  searchInput = searchEl;
  searchInput.addEventListener("input", () => {
    query = searchInput.value.trim().toLowerCase();
    renderTree();
  });
  renderTree();
}

// ids visible under search: matches plus all their ancestors
function searchVisibleIds() {
  if (query.length < 2) return null;
  const visible = new Set();
  const walk = (id, ancestors) => {
    const name = nodeName(id).toLowerCase();
    const code = getSeries(id)?.code || "";
    const hit = name.includes(query) || code.startsWith(query);
    const kids = childIds(id);
    let anyDescendant = false;
    for (const kid of kids) {
      if (walk(kid, [...ancestors, id])) anyDescendant = true;
    }
    if (hit || anyDescendant) {
      visible.add(id);
      ancestors.forEach((a) => visible.add(a));
      return true;
    }
    return false;
  };
  childIds("").forEach((root) => walk(root, []));
  return visible;
}

export function renderTree() {
  const visible = searchVisibleIds();
  const ul = buildList(childIds(""), visible);
  container.replaceChildren(
    ul.children.length
      ? ul
      : Object.assign(document.createElement("p"), {
          className: "tree-empty",
          textContent: `Nothing matching “${query}” — try a simpler word.`,
        })
  );
}

function buildList(ids, visible) {
  const ul = document.createElement("ul");
  for (const id of ids) {
    if (visible && !visible.has(id)) continue;
    ul.appendChild(buildNode(id, visible));
  }
  return ul;
}

function buildNode(id, visible) {
  const li = document.createElement("li");
  li.setAttribute("role", "treeitem");
  const kids = childIds(id);
  const hasKids = kids.length > 0;
  const isOpen = visible ? true : expanded.has(id);
  const series = isFolder(id) ? null : getSeries(id);
  const selected = series && getState().selected.includes(id);

  const row = document.createElement("div");
  row.className = "tree-row" + (selected ? " is-selected" : "");

  if (hasKids) {
    const caret = document.createElement("button");
    caret.type = "button";
    caret.className = "caret" + (isOpen ? " open" : "");
    caret.innerHTML = CARET_SVG;
    caret.setAttribute("aria-label", (isOpen ? "Collapse " : "Expand ") + nodeName(id));
    caret.setAttribute("aria-expanded", String(isOpen));
    caret.addEventListener("click", () => {
      expanded.has(id) ? expanded.delete(id) : expanded.add(id);
      renderTree();
    });
    row.appendChild(caret);
  } else {
    row.insertAdjacentHTML("beforeend", `<span class="caret-spacer"></span>`);
  }

  if (series) {
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!selected;
    cb.addEventListener("change", () => {
      const ok = toggleSelected(id);
      if (!ok) {
        cb.checked = false;
        flashLimitMessage();
      }
    });
    label.appendChild(cb);
    const name = document.createElement("span");
    name.className = "node-name";
    name.textContent = series.name;
    name.title = series.name + (series.code ? ` (COICOP ${series.code})` : "");
    label.appendChild(name);
    if (series.code) {
      const badge = document.createElement("span");
      badge.className = "code-badge";
      badge.textContent = series.code;
      label.appendChild(badge);
    }
    row.appendChild(label);
  } else {
    const name = document.createElement("span");
    name.className = "node-name folder-name";
    name.style.fontWeight = "600";
    name.textContent = nodeName(id);
    name.style.cursor = hasKids ? "pointer" : "default";
    if (hasKids) {
      name.addEventListener("click", () => {
        expanded.has(id) ? expanded.delete(id) : expanded.add(id);
        renderTree();
      });
    }
    row.appendChild(name);
  }

  li.appendChild(row);

  if (hasKids && isOpen) {
    li.appendChild(buildList(kids, visible));
  }
  return li;
}

let limitTimer = null;
function flashLimitMessage() {
  const counter = document.getElementById("selected-count");
  if (!counter) return;
  const prev = counter.textContent;
  counter.textContent = `max ${MAX_SELECTED} at once`;
  clearTimeout(limitTimer);
  limitTimer = setTimeout(() => { counter.textContent = prev; }, 2200);
}

// Expand ancestors of an id (used when selecting from the overview bars)
export function revealInTree(id) {
  let node = getSeries(id);
  while (node && node.parent) {
    expanded.add(node.parent);
    node = getSeries(node.parent);
  }
  renderTree();
}
