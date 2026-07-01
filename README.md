# Mi Catálogo de DVDs

Catálogo visual estático (sin backend, sin base de datos) para ver tu colección de DVDs.
Estética oscura inspirada en Letterboxd / Plex, pensado sobre todo para el celular.

## Cómo usarlo

### 1. Enriquecer los datos con TMDB
El repo ya trae un `data.json` **provisorio** (solo títulos y estado visto/no visto),
así la app funciona apenas la abrís. Para tener posters, sinopsis, director, etc.:

1. Conseguí una API key (v3) gratis: https://www.themoviedb.org/settings/api
2. Corré el generador:

   ```powershell
   # PowerShell (Windows)
   $env:TMDB_API_KEY="tu_key"; node generateData.js
   ```
   ```bash
   # bash / mac / linux
   TMDB_API_KEY=tu_key node generateData.js
   ```

Esto reescribe `data.json` con toda la metadata y crea `review.txt` con los
casos ambiguos para que los revises a mano.

- Idioma de sinopsis/géneros: por defecto `es-ES`. Cambialo con `TMDB_LANG=en-US`.
- No descarga imágenes: los posters se cargan desde las URLs de TMDB.

### Corregir un match equivocado (`hints.json`)
El generador busca en inglés y prioriza coincidencia exacta de título, pero para
remakes/homónimos (dos películas con el mismo nombre) usa `hints.json`. Cada
entrada se indexa por el título **exacto** de `peliculas.txt`:

```jsonc
{
  "Snow White": 1937,                                  // preferí ese año
  "Sharktale": "Shark Tale",                           // corregí la búsqueda
  "House": { "query": "Hausu", "year": 1977 },         // búsqueda + año
  "Wall-E": { "id": 10681 },                           // fijá el id de TMDB (película)
  "Twin Peaks": { "tvId": 1920 }                       // serie de TV (miniserie en DVD)
}
```

Para encontrar un id: abrí la peli en themoviedb.org y miralo en la URL
(`.../movie/10681`). Después volvé a correr `node generateData.js`.

Casos que quedaron para revisar salen en `review.txt`. Hoy queda **1**: *The Hole*
(hay varias homónimas — fijá el año o el id de la que tengas).

### 2. Ver la app localmente
El navegador bloquea `fetch("data.json")` al abrir el HTML con doble clic (`file://`).
Usá un servidor local:

```bash
npx serve          # o:  python -m http.server
```

Y abrí la URL que te muestre (ej. http://localhost:3000).

### 3. Publicar en GitHub Pages
1. Subí la carpeta a un repo de GitHub.
2. Settings → Pages → Deploy from branch → `main` / root.
3. Abrí la URL desde el celular.

## Funciones actuales
- Grid de posters responsive (mobile-first), interfaz en inglés.
- Buscar por título.
- Filtrar por género, vista / no vista (toggle), duración (slider), favoritas y rewatch.
- Detalle en modal: sinopsis, duración, director, elenco, año, rating.
- **Favoritas** y lista **"quiero volver a ver" (rewatch)**, guardadas en `localStorage`
  (por navegador/dispositivo: no se sincronizan entre el celu y la compu).

## Próximos pasos posibles
- Puntuación personal (descartada por ahora).
- Sincronización entre dispositivos (requeriría guardar el estado en el repo o un backend).

## Archivos
| archivo | qué hace |
|---|---|
| `index.html` / `styles.css` / `app.js` | la app |
| `generateData.js` | genera `data.json` desde `peliculas.txt` + TMDB |
| `peliculas.txt` | tu lista original |
| `data.json` | datos que consume la app |
| `review.txt` | casos dudosos (lo crea el generador) |
