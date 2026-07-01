/*
 * generateData.js
 * -------------------------------------------------------------
 * Lee peliculas.txt, busca cada título en TMDB y genera data.json
 * con toda la metadata que usa la app (título, año, géneros, duración,
 * sinopsis, director, elenco, URL del poster).
 *
 * No descarga imágenes: guarda las URLs de TMDB.
 *
 * USO:
 *   1. Conseguí una API key (v3) gratis en https://www.themoviedb.org/settings/api
 *   2. Ejecutá (Node 18+ ya trae fetch):
 *
 *        TMDB_API_KEY=tu_key node generateData.js         (bash / mac / linux)
 *        $env:TMDB_API_KEY="tu_key"; node generateData.js  (PowerShell)
 *
 *   3. Revisá review.txt para los casos ambiguos.
 * -------------------------------------------------------------
 */

const fs = require("fs");
const path = require("path");

const API_KEY = process.env.TMDB_API_KEY;
const LANG = process.env.TMDB_LANG || "en-US"; // idioma de títulos/sinopsis/géneros; poné "es-ES" para español
const POSTER_SIZE = "w500";
const IMG_BASE = "https://image.tmdb.org/t/p/";
const API = "https://api.themoviedb.org/3";
const CAST_COUNT = 5;

const INPUT = path.join(__dirname, "peliculas.txt");
const OUTPUT = path.join(__dirname, "data.json");
const REVIEW = path.join(__dirname, "review.txt");

if (!API_KEY) {
  console.error(
    "\n  Falta la API key de TMDB.\n" +
      "  Conseguila en https://www.themoviedb.org/settings/api y ejecutá:\n\n" +
      "    PowerShell:  $env:TMDB_API_KEY=\"tu_key\"; node generateData.js\n" +
      "    bash:        TMDB_API_KEY=tu_key node generateData.js\n"
  );
  process.exit(1);
}

// ---------- Parseo del .txt ----------------------------------

function parseList(text) {
  const movies = [];
  let shelf = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    // Estantes: //#region N  /  //#endregion N
    const region = line.match(/^\/\/\s*#region\s*(.+)$/i);
    if (region) {
      shelf = region[1].trim();
      continue;
    }
    if (/^\/\/\s*#endregion/i.test(line)) {
      shelf = null;
      continue;
    }
    if (line.startsWith("//")) continue; // cualquier otro comentario

    // "Título", true   |   "Título",false   |   "Título", truea  (tolerante)
    const m = line.match(/^"([^"]+)"\s*,\s*(\w+)/);
    if (!m) {
      console.warn("  (línea ignorada, formato raro) ->", rawLine);
      continue;
    }
    const title = m[1].trim();
    const seen = /^true/i.test(m[2]); // "true", "truea", etc. -> vista

    movies.push({ title, seen, shelf });
  }
  return movies;
}

// ---------- TMDB --------------------------------------------

function tmdbUrl(endpoint, params = {}) {
  const url = new URL(API + endpoint);
  url.searchParams.set("api_key", API_KEY);
  url.searchParams.set("language", LANG);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

async function tmdb(endpoint, params, attempt = 0) {
  let res;
  try {
    res = await fetch(tmdbUrl(endpoint, params));
  } catch (err) {
    // Fallo de red (fetch failed): reintentar con backoff
    if (attempt < 3) {
      await sleep(500 * (attempt + 1));
      return tmdb(endpoint, params, attempt + 1);
    }
    throw err;
  }
  if (res.status === 429) {
    // rate limit: esperar y reintentar
    const wait = Number(res.headers.get("retry-after") || 1) * 1000 + 250;
    await sleep(wait);
    return tmdb(endpoint, params, attempt);
  }
  if (!res.ok) throw new Error(`TMDB ${res.status} en ${endpoint}`);
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const yearOf = (r) => (r && r.release_date ? r.release_date.slice(0, 4) : "?");
const yearNum = (r) => (r && r.release_date ? Number(r.release_date.slice(0, 4)) : null);

// Normaliza para comparar títulos: minúsculas, sin acentos, sin puntuación/espacios.
function normalize(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// hints.json (opcional) permite fijar casos ambiguos por título exacto del .txt:
//   "Snow White": 1937                      -> prefiere el resultado de ese año
//   "Sharktale": "Shark Tale"               -> usa esa búsqueda
//   "House": { "query": "House", "year": 1977 }
//   "Lupin III": { "id": 12345 }            -> usa ese id de TMDB directamente
function hintQuery(hint) {
  if (!hint) return null;
  if (typeof hint === "string") return hint;
  if (typeof hint === "object") return hint.query || null;
  return null;
}
function hintYear(hint) {
  if (!hint) return null;
  if (typeof hint === "number") return hint;
  if (typeof hint === "object") return hint.year || null;
  return null;
}
function hintId(hint) {
  return hint && typeof hint === "object" ? hint.id || null : null;
}
function hintTvId(hint) {
  return hint && typeof hint === "object" ? hint.tvId || null : null;
}

// Puntúa un resultado: prioriza match EXACTO de título (o título original en
// inglés) y, si hay hint de año, ese año. La popularidad es solo un desempate.
function scoreResult(r, qNorm, wantYear) {
  let score = 0;
  const t = normalize(r.title);
  const ot = normalize(r.original_title);
  const exact = t === qNorm || ot === qNorm;

  if (exact) score += 1000;
  else if (t.startsWith(qNorm) || ot.startsWith(qNorm)) score += 80;
  else if (t.includes(qNorm) || ot.includes(qNorm)) score += 20;

  const y = yearNum(r);
  if (wantYear && y && Math.abs(y - wantYear) <= 1) score += 5000;

  // La popularidad pesa para que el film famoso le gane a un homónimo oscuro
  // (p.ej. un "making-of") cuando ninguno matchea exacto.
  score += Math.min(r.popularity || 0, 500) * 1.0;
  return { score, exact, year: y };
}

function pickResult(results, query, hint) {
  if (!results || results.length === 0)
    return { chosen: null, ambiguous: true, reason: "sin resultados" };

  const qNorm = normalize(query);
  const wantYear = hintYear(hint);

  const scored = results
    .map((r) => ({ r, ...scoreResult(r, qNorm, wantYear) }))
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  const second = scored[1];
  let ambiguous = false;
  let reason = "";

  const yearDiff = second ? Math.abs((top.year || 0) - (second.year || 0)) : 0;

  if (wantYear) {
    // El usuario ya desambiguó con un hint: confiamos.
  } else if (
    second &&
    second.exact &&
    (second.r.popularity || 0) > (top.r.popularity || 0) * 0.5 &&
    yearDiff > 1
  ) {
    // Dos con el MISMO título, de épocas distintas y popularidad comparable
    // (remake real sin resolver) -> conviene revisar / fijar el año en hints.json
    ambiguous = true;
    reason = `posible remake ("${top.r.title}" ${top.year} vs "${second.r.title}" ${second.year}) — fijá el año en hints.json`;
  } else if (!top.exact && (top.r.popularity || 0) < 1) {
    // Ningún título coincide y el elegido es muy oscuro -> probablemente equivocado
    ambiguous = true;
    reason = "match poco confiable (posible título equivocado)";
  }
  if (!top.r.poster_path) {
    ambiguous = true;
    reason = reason || "sin poster";
  }
  return { chosen: top.r, ambiguous, reason };
}

async function enrich(movie) {
  const hint = HINTS[movie.title];

  // Si el hint trae un id de película de TMDB, vamos directo al detalle.
  if (hintId(hint)) {
    const details = await tmdb(`/movie/${hintId(hint)}`, { append_to_response: "credits" });
    return buildEntry(movie, details, { id: details.id, poster_path: details.poster_path }, false, "");
  }

  // Si el hint trae un id de SERIE de TV (miniseries en DVD, p.ej. Twin Peaks).
  if (hintTvId(hint)) {
    const t = await tmdb(`/tv/${hintTvId(hint)}`, { append_to_response: "credits" });
    const epRun = Array.isArray(t.episode_run_time) && t.episode_run_time.length ? t.episode_run_time[0] : null;
    const details = {
      id: t.id,
      title: t.name,
      original_title: t.original_name,
      release_date: t.first_air_date,
      runtime: epRun && t.number_of_episodes ? epRun * t.number_of_episodes : epRun,
      genres: t.genres,
      overview: t.overview,
      poster_path: t.poster_path,
      backdrop_path: t.backdrop_path,
      vote_average: t.vote_average,
      credits: {
        cast: t.credits?.cast || [],
        // los creadores de la serie hacen las veces de "director"
        crew: (t.created_by || []).map((c) => ({ job: "Director", name: c.name })),
      },
    };
    return buildEntry(movie, details, { id: t.id, poster_path: t.poster_path }, false, "");
  }

  // Query: hint.query si existe, si no el título tal cual.
  const query = hintQuery(hint) || movie.title;
  let search = await tmdb("/search/movie", { query, include_adult: "false", language: "en-US" });

  // Fallback: sin dígitos finales ("Spiderman 1" -> "Spiderman") solo si no hubo nada.
  if (!search.results || search.results.length === 0) {
    const fallback = query.replace(/\s+\d+$/, "").trim();
    if (fallback && fallback !== query) {
      search = await tmdb("/search/movie", { query: fallback, include_adult: "false", language: "en-US" });
    }
  }

  const { chosen, ambiguous, reason } = pickResult(search.results, query, hint);

  if (!chosen) {
    return {
      title: movie.title,
      seen: movie.seen,
      shelf: movie.shelf,
      needsReview: true,
      reviewReason: reason,
      tmdbId: null,
      year: null,
      genres: [],
      runtime: null,
      overview: "",
      director: null,
      cast: [],
      poster: null,
    };
  }

  const details = await tmdb(`/movie/${chosen.id}`, { append_to_response: "credits" });
  return buildEntry(movie, details, chosen, ambiguous, reason);
}

function buildEntry(movie, details, chosen, ambiguous, reason) {
  const director =
    (details.credits?.crew || []).find((c) => c.job === "Director")?.name || null;
  const cast = (details.credits?.cast || [])
    .slice(0, CAST_COUNT)
    .map((c) => c.name);

  return {
    title: details.title || chosen.title,
    originalTitle: details.original_title,
    seen: movie.seen,
    shelf: movie.shelf,
    needsReview: ambiguous,
    reviewReason: ambiguous ? reason : "",
    listedTitle: movie.title, // lo que estaba en tu txt, por si el match difiere
    tmdbId: chosen.id,
    year: details.release_date ? Number(details.release_date.slice(0, 4)) : null,
    genres: (details.genres || []).map((g) => g.name),
    runtime: details.runtime || null,
    overview: details.overview || "",
    director,
    cast,
    poster: details.poster_path ? `${IMG_BASE}${POSTER_SIZE}${details.poster_path}` : null,
    backdrop: details.backdrop_path ? `${IMG_BASE}w780${details.backdrop_path}` : null,
    rating: details.vote_average ? Math.round(details.vote_average * 10) / 10 : null,
  };
}

// ---------- Main --------------------------------------------

let HINTS = {};

async function main() {
  const hintsPath = path.join(__dirname, "hints.json");
  if (fs.existsSync(hintsPath)) {
    HINTS = JSON.parse(fs.readFileSync(hintsPath, "utf8"));
    console.log(`Cargados ${Object.keys(HINTS).length} hints de hints.json`);
  }

  const text = fs.readFileSync(INPUT, "utf8");
  const movies = parseList(text);
  console.log(`Leídas ${movies.length} películas de peliculas.txt\n`);

  const out = [];
  const review = [];

  for (let i = 0; i < movies.length; i++) {
    const m = movies[i];
    process.stdout.write(`[${i + 1}/${movies.length}] ${m.title} ... `);
    try {
      const data = await enrich(m);
      out.push(data);
      if (data.needsReview) {
        review.push(`• ${m.title}  ->  ${data.title ?? "(nada)"} (${data.year ?? "?"})  [${data.reviewReason}]`);
        console.log(`⚠  revisar (${data.reviewReason})`);
      } else {
        console.log(`ok -> ${data.title} (${data.year ?? "?"})`);
      }
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      out.push({ title: m.title, seen: m.seen, shelf: m.shelf, needsReview: true, reviewReason: err.message, poster: null, genres: [], cast: [] });
      review.push(`• ${m.title}  ->  ERROR: ${err.message}`);
    }
    await sleep(60); // gentil con la API
  }

  // Respaldo: si TMDB no tiene sinopsis en español, usamos la inglesa.
  let backfilled = 0;
  for (const m of out) {
    if (m.overview || !m.tmdbId) continue;
    try {
      const en = await tmdb(`/movie/${m.tmdbId}`, { language: "en-US" });
      if (en.overview) {
        m.overview = en.overview;
        backfilled++;
      }
    } catch {}
    await sleep(60);
  }
  if (backfilled) console.log(`\nSinopsis completadas en inglés (respaldo): ${backfilled}`);

  fs.writeFileSync(OUTPUT, JSON.stringify(out, null, 2), "utf8");
  fs.writeFileSync(
    REVIEW,
    `Casos a revisar manualmente (${review.length}):\n\n` + review.join("\n") + "\n",
    "utf8"
  );

  console.log(`\n✔ Escrito ${OUTPUT} (${out.length} películas)`);
  console.log(`⚠ ${review.length} casos para revisar en ${REVIEW}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
