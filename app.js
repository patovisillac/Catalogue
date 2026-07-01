/* app.js — static DVD catalogue */

const state = {
  all: [],
  filtered: [],
  q: "",
  genre: "",
  seen: "",          // "" = all, "seen", "unseen"
  durMin: 0,
  durMax: 0,         // set from data
  fav: false,        // filter: only favourites
  rewatch: false,    // filter: only rewatch list
};

// ---------- Local state (localStorage): favourites & rewatch ----------
const FAV_KEY = "cat.favorites";
const REWATCH_KEY = "cat.rewatch";
const favSet = new Set(loadSet(FAV_KEY));
const rewatchSet = new Set(loadSet(REWATCH_KEY));

function loadSet(key) {
  try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; }
}
function movieKey(m) {
  return m.tmdbId != null ? "id:" + m.tmdbId : "t:" + (m.listedTitle || m.title);
}
const isFav = (m) => favSet.has(movieKey(m));
const isRewatch = (m) => rewatchSet.has(movieKey(m));
function toggleInSet(set, key, storeKey, m) {
  const k = movieKey(m);
  if (set.has(k)) set.delete(k); else set.add(k);
  localStorage.setItem(storeKey, JSON.stringify([...set]));
}
const toggleFav = (m) => toggleInSet(favSet, FAV_KEY, FAV_KEY, m);
const toggleRewatch = (m) => toggleInSet(rewatchSet, REWATCH_KEY, REWATCH_KEY, m);

// Duration slider bounds (minutes), computed from the data.
let DUR_MIN = 0;
let DUR_MAX = 240;

const els = {
  grid: document.getElementById("grid"),
  count: document.getElementById("count"),
  empty: document.getElementById("empty"),
  search: document.getElementById("search"),
  genre: document.getElementById("genre"),
  seenSeg: document.getElementById("seen-seg"),
  filterFav: document.getElementById("filter-fav"),
  filterRewatch: document.getElementById("filter-rewatch"),
  reset: document.getElementById("reset"),
  durMin: document.getElementById("dur-min"),
  durMax: document.getElementById("dur-max"),
  durFill: document.getElementById("dur-fill"),
  durLabel: document.getElementById("dur-label"),
  modal: document.getElementById("modal"),
  modalBody: document.getElementById("modal-body"),
};

// ---------- Load ----------
async function load() {
  try {
    const res = await fetch("data.json", { cache: "no-store" });
    if (!res.ok) throw new Error(res.status);
    state.all = await res.json();
  } catch (e) {
    els.grid.innerHTML = "";
    els.empty.hidden = false;
    els.empty.innerHTML =
      "Could not load <code>data.json</code>.<br>Run <code>node generateData.js</code> " +
      "and open the site with a local server (e.g. <code>npx serve</code>) or from GitHub Pages.";
    return;
  }
  buildGenreOptions();
  setupDurationSlider();
  apply();
}

function buildGenreOptions() {
  const set = new Set();
  state.all.forEach((m) => (m.genres || []).forEach((g) => set.add(g)));
  const genres = [...set].sort((a, b) => a.localeCompare(b));
  els.genre.innerHTML =
    '<option value="">Genre</option>' +
    genres.map((g) => `<option value="${g}">${g}</option>`).join("");
}

function setupDurationSlider() {
  const runtimes = state.all.map((m) => m.runtime).filter((r) => r && r < 300);
  const max = runtimes.length ? Math.max(...runtimes) : 240;
  DUR_MIN = 0;
  DUR_MAX = Math.ceil(max / 10) * 10; // round up to nearest 10
  for (const el of [els.durMin, els.durMax]) {
    el.min = DUR_MIN;
    el.max = DUR_MAX;
    el.step = 5;
  }
  els.durMin.value = DUR_MIN;
  els.durMax.value = DUR_MAX;
  state.durMin = DUR_MIN;
  state.durMax = DUR_MAX;
  updateDurationUI();
}

function updateDurationUI() {
  const span = DUR_MAX - DUR_MIN || 1;
  const lo = ((state.durMin - DUR_MIN) / span) * 100;
  const hi = ((state.durMax - DUR_MIN) / span) * 100;
  els.durFill.style.left = lo + "%";
  els.durFill.style.right = 100 - hi + "%";

  const full = state.durMin === DUR_MIN && state.durMax === DUR_MAX;
  if (full) {
    els.durLabel.textContent = "Any";
  } else if (state.durMin === DUR_MIN) {
    els.durLabel.textContent = `< ${state.durMax} min`;
  } else if (state.durMax === DUR_MAX) {
    els.durLabel.textContent = `> ${state.durMin} min`;
  } else {
    els.durLabel.textContent = `${state.durMin}–${state.durMax} min`;
  }
}

// ---------- Filtering ----------
function apply() {
  const q = state.q.trim().toLowerCase();
  const durActive = state.durMin > DUR_MIN || state.durMax < DUR_MAX;

  state.filtered = state.all.filter((m) => {
    if (q) {
      const hay = (m.title + " " + (m.originalTitle || "") + " " + (m.listedTitle || "")).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (state.genre && !(m.genres || []).includes(state.genre)) return false;
    if (state.seen === "seen" && !m.seen) return false;
    if (state.seen === "unseen" && m.seen) return false;
    if (state.fav && !isFav(m)) return false;
    if (state.rewatch && !isRewatch(m)) return false;
    if (durActive) {
      if (m.runtime == null) return false;
      if (m.runtime < state.durMin || m.runtime > state.durMax) return false;
    }
    return true;
  });
  render();
}

// ---------- Render ----------
function render() {
  const list = state.filtered;
  els.count.textContent = `${list.length} movie${list.length === 1 ? "" : "s"}`;
  els.empty.hidden = list.length !== 0;

  // Dim unseen posters only in the mixed "All" view (useful cue there).
  const dimUnseen = state.seen === "";

  els.grid.innerHTML = list
    .map((m) => {
      const idx = state.all.indexOf(m);
      const poster = m.poster
        ? `<img loading="lazy" src="${m.poster}" alt="${escapeAttr(m.title)}" />`
        : `<div class="placeholder">${escapeHtml(m.title)}</div>`;
      const reviewBadge = m.needsReview ? `<span class="badge review">?</span>` : "";
      const dim = dimUnseen && !m.seen ? " dim" : "";
      const flags =
        (isFav(m) ? `<span class="flag fav" title="Favorite">♥</span>` : "") +
        (isRewatch(m) ? `<span class="flag rewatch" title="Rewatch">↻</span>` : "");
      const flagsHtml = flags ? `<div class="card-flags">${flags}</div>` : "";
      return `
        <div class="card${dim}" data-idx="${idx}" role="button" tabindex="0">
          ${poster}
          ${reviewBadge}${flagsHtml}
          <div class="cap">${escapeHtml(m.title)}${m.year ? ` (${m.year})` : ""}</div>
        </div>`;
    })
    .join("");
}

// ---------- Modal ----------
let currentMovie = null;

function actionsHtml(movie) {
  return `
    <div class="actions">
      <button type="button" class="action-btn fav ${isFav(movie) ? "active" : ""}" data-action="fav">
        ${isFav(movie) ? "♥ Favorited" : "♡ Favorite"}
      </button>
      <button type="button" class="action-btn rewatch ${isRewatch(movie) ? "active" : ""}" data-action="rewatch">
        ↻ ${isRewatch(movie) ? "On rewatch list" : "Want to rewatch"}
      </button>
    </div>`;
}

function openModal(movie) {
  currentMovie = movie;
  const runtime = movie.runtime ? `${movie.runtime} min` : "—";
  const genres = (movie.genres || []).map((g) => `<span>${escapeHtml(g)}</span>`).join("");
  const cast = (movie.cast || []).join(", ") || "—";
  const hero = movie.backdrop
    ? `<div class="modal-hero"><img src="${movie.backdrop}" alt="" /></div>`
    : `<div class="modal-hero"></div>`;
  const posterSmall = movie.poster
    ? `<img class="modal-poster" src="${movie.poster}" alt="" />`
    : "";

  const statusPills = [
    movie.seen
      ? `<span class="status-pill seen">✓ Watched</span>`
      : `<span class="status-pill unseen">To watch</span>`,
    movie.needsReview ? `<span class="status-pill review">⚠ Check match</span>` : "",
  ].join("");

  els.modalBody.innerHTML = `
    ${hero}
    <div class="modal-content">
      ${posterSmall}
      <h2 id="m-title">${escapeHtml(movie.title)}</h2>
      <div class="meta-row">
        ${movie.year ? `<span>${movie.year}</span>` : ""}
        <span class="dot">${runtime}</span>
        ${movie.rating ? `<span class="dot star">★ ${movie.rating}</span>` : ""}
      </div>
      <div class="status-line">${statusPills}</div>
      ${actionsHtml(movie)}
      ${genres ? `<div class="genre-chips">${genres}</div>` : ""}
      ${movie.overview ? `<p class="overview">${escapeHtml(movie.overview)}</p>` : ""}
      <div class="detail-block">
        <div class="label">Director</div>
        <div class="value">${escapeHtml(movie.director || "—")}</div>
      </div>
      <div class="detail-block">
        <div class="label">Main cast</div>
        <div class="value">${escapeHtml(cast)}</div>
      </div>
    </div>`;

  els.modal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeModal() {
  els.modal.hidden = true;
  document.body.style.overflow = "";
}

// ---------- Utils ----------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
const escapeAttr = escapeHtml;

// ---------- Events ----------
els.search.addEventListener("input", (e) => {
  state.q = e.target.value;
  apply();
});
els.genre.addEventListener("change", (e) => {
  state.genre = e.target.value;
  apply();
});

// Ternary segmented toggle: All / Seen / Unseen
els.seenSeg.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  state.seen = btn.dataset.val;
  els.seenSeg.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
  apply();
});

// Favourites / rewatch filter chips
function toggleChip(el, key) {
  state[key] = !state[key];
  el.setAttribute("aria-pressed", String(state[key]));
  apply();
}
els.filterFav.addEventListener("click", () => toggleChip(els.filterFav, "fav"));
els.filterRewatch.addEventListener("click", () => toggleChip(els.filterRewatch, "rewatch"));

// Dual range slider
function onDurInput() {
  let lo = Number(els.durMin.value);
  let hi = Number(els.durMax.value);
  if (lo > hi) {
    // keep thumbs from crossing
    if (document.activeElement === els.durMin) hi = lo;
    else lo = hi;
    els.durMin.value = lo;
    els.durMax.value = hi;
  }
  state.durMin = lo;
  state.durMax = hi;
  updateDurationUI();
  apply();
}
els.durMin.addEventListener("input", onDurInput);
els.durMax.addEventListener("input", onDurInput);

// Clear all filters (X)
els.reset.addEventListener("click", () => {
  state.q = state.genre = "";
  state.seen = "";
  state.fav = state.rewatch = false;
  state.durMin = DUR_MIN;
  state.durMax = DUR_MAX;
  els.search.value = "";
  els.genre.value = "";
  els.durMin.value = DUR_MIN;
  els.durMax.value = DUR_MAX;
  els.filterFav.setAttribute("aria-pressed", "false");
  els.filterRewatch.setAttribute("aria-pressed", "false");
  els.seenSeg.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.val === ""));
  updateDurationUI();
  apply();
});

els.grid.addEventListener("click", (e) => {
  const card = e.target.closest(".card");
  if (!card) return;
  openModal(state.all[Number(card.dataset.idx)]);
});
els.grid.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const card = e.target.closest(".card");
  if (!card) return;
  e.preventDefault();
  openModal(state.all[Number(card.dataset.idx)]);
});

// Favourite / rewatch buttons inside the modal
els.modalBody.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn || !currentMovie) return;
  if (btn.dataset.action === "fav") toggleFav(currentMovie);
  else toggleRewatch(currentMovie);
  // refresh the buttons in place, then update the grid underneath
  const wrap = els.modalBody.querySelector(".actions");
  if (wrap) wrap.outerHTML = actionsHtml(currentMovie);
  apply();
});

els.modal.addEventListener("click", (e) => {
  if (e.target.hasAttribute("data-close")) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !els.modal.hidden) closeModal();
});

load();
