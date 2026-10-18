# Replicar RaceBox App y RaceChrono en InLap

> Fecha de consulta: **2026-10-18**
> Objetivo: clonar la funcionalidad útil de las apps oficiales, y en particular dejar
> de detectar las vueltas por heurística.

## 1. De dónde sacan los mapas y los trazados

Hay que separar dos cosas que suelen confundirse:

**a) El mapa de fondo (calles/satélite).**
- **RaceBox** usa **Google Maps** (o su propio "RaceBox Map").
- **RaceChrono** usa un mapa propio por defecto y ofrece **Google Maps como opción**
  ("Added optional Google maps to settings").
- Ambos son proveedores comerciales de teselas. **No** es lo que define dónde empieza la vuelta.

**b) El trazado y la línea de meta (lo importante).**
- **No existe una API pública.** Cada app mantiene su **base de datos propietaria y curada a mano**:
  - RaceBox: "RaceBox maintains an exhaustive list of race tracks around the world" (~1500–2000+
    circuitos con **splits, start/finish y configuraciones**). El usuario también puede crear
    circuitos personalizados (hasta 4 líneas de split) en la app **o mientras conduce**.
  - RaceChrono: "official track library" (>2000–2600 circuitos). El listado público está en
    `my.racechrono.com/tracks`, pero los perfiles se descargan desde la app y **el formato no es público**.
- **Cómo define un circuito RaceChrono (documentado públicamente):** con **"traps"** (trampas):
  cada trap tiene **posición GPS, rumbo (dirección de paso), ancho (50 m por defecto, ajustable)** y
  puede ser bidireccional. El primer trap es **Start/Finish**; los demás son **splits**. El editor de
  circuitos permite mover, rotar y escalar cada trap. **Los sectores son los tramos entre traps.**
- **Cómo lo hace RaceBox:** el dispositivo guarda los circuitos en su memoria y el ancho de línea
  ("Custom Gate") es ajustable (4/6/8/10/20 m). La app sube/crea/gestiona los circuitos del dispositivo.

**Conclusión:** la precisión de las apps viene de un **catálogo de traps curado**, no de analizar el
GPS en el momento. Nuestra "heurística del cruce más cerrado" era el parche; lo correcto es un
**catálogo de traps** con respaldo de tres vías (abajo).

## 2. Alternativas abiertas para el trazado (licencias abiertas)

| Fuente | Qué da | Licencia |
| --- | --- | --- |
| **OpenStreetMap** (`highway=raceway`, nodo `raceway=start/finish`) | Trazado del circuito y, cuando existe, el **nodo de meta**. Consultable por **Overpass API**. Es lo más cercano a "el mapa oficial" pero abierto. | ODbL |
| TUMFTM/racetrack-database | Centerlines + anchos + racing line de ~20 circuitos (F1/DTM), **extraídos de OSM**. | Abierta |
| bacinger/f1-circuits | GeoJSON de circuitos de F1. | Abierta |
| LigasAVBrasil/RaceTracksAPI | JSON + SVG de circuitos con coordenadas y layouts (en crecimiento). | Fan-made |
| Wikidata · WikiProject Motorsports/Tracks | Coordenadas de circuitos (sin trazado). | CC0 |

OSM es la pieza clave: con Overpass se obtiene `highway=raceway` (trazado) y el nodo
`raceway=start/finish` (meta), que **junto con el rumbo** forman un trap exactamente igual al de
RaceChrono. Es replicable y legal con atribución.

## 3. Qué ofrecen (matriz de funcionalidades a replicar)

### 3.1. Circuitos y cronometraje
| Función | RaceChrono | RaceBox | Estado en InLap |
| --- | --- | --- | --- |
| Catálogo de circuitos | >2600 | ~1500–2000+ | Pendiente (OSM + aprendidos) |
| Custom / circuito propio | Sí (circuito y punto a punto) | Sí (+4 splits) | **A hacer (slice 1)** |
| Traps con rumbo y ancho | Sí (50 m, ajustable) | Sí (gate 4–20 m) | **A hacer (slice 1)** |
| Sectores (splits) | Sí | Sí (hasta 4 líneas) | A hacer |
| Vuelta óptima (teórica) | Sí | Sí ("theoretical best") | A hacer |
| Detección de vueltas válidas | Sí | Sí | Parcial (heurística) |

### 3.2. Análisis
| Función | RaceChrono | RaceBox | Estado |
| --- | --- | --- | --- |
| Gráfica ↔ mapa ↔ vídeo sincronizados | Sí | Sí | Parcial (mapa+gráfica) |
| Gráfica X/Y (G-G) | Sí | Sí (G-G plot) | Hecho |
| Delta de tiempo y de velocidad | Sí | Sí (Time Delta graph) | Delta de tiempo hecho |
| Comparar vueltas/vueltas de referencia | Sí | Sí (comparación) | Pendiente (delta ya existe) |
| Modos de lista: resumen/sectores/splits/canales | Sí | Resumen/sectores | Parcial |
| Ángulo de inclinación (moto) | — | Sí (lean angle) | A hacer (desde IMU) |
| Drag meter (0-100, 1/4 milla, custom) | Components | Sí (drag) | Fuera de alcance ahora |

### 3.3. Datos e integración
| Función | RaceChrono | RaceBox | Estado |
| --- | --- | --- | --- |
| GPS externo BLE | Sí (RaceBox, Qstarz, VBOX, Dual…) | — | Sí (RaceBox) |
| OBD-II (BT/WiFi) | Sí | Sí | Fuera de alcance |
| Pulsómetro BLE | Sí | — | Fuera de alcance |
| Vídeo + overlay | Sí (GoPro, cámara interna) | — | Fuera de alcance (grande) |
| Export | CSV, VBO, NMEA, ODS, RCZ, GPX | CSV, VBO, KML, GOX | GPX + CSV hechos |
| Nube / sync | Cuenta | RaceBox Cloud | Fuera de alcance (local-first) |

## 4. Plan por fases

**Slice 1 — Circuitos por traps (elimina la heurística). ← IMPLEMENTADO**
- Modelo de circuito: `{ id, name, startFinish: trap, splits: [] }`.
- Trap: `{ lat, lon, heading, width, bidirectional }` + test de cruce por **cambio de signo de la
  distancia firmada** con comprobación de **rumbo** y **ancho** (`RaceBoxTrack.js`).
- Cronometraje por traps: vueltas y sectores exactos; **vuelta óptima** = suma de mejores sectores.
- **Aprender circuito desde una sesión** (como RaceChrono "Method A"): botón «Guardar circuito» en
  el visor, que sugiere la meta en el cruce más cerrado y la guarda. A partir de ahí, esa sesión y
  las futuras del mismo sitio se cronometran con la meta (**sin heurística**).
- Circuitos guardados en local (IndexedDB, `TrackStore`) y asociados a las sesiones por proximidad.

**Slice 2 — Catálogo de circuitos desde OSM.**
- Importar por nombre/área vía Overpass: `highway=raceway` → centerline; nodo `raceway=start/finish`
  → meta (deducir rumbo del propio trazado). Exportar/importar JSON propio para compartir.

**Slice 3 — Análisis avanzado. ← PARCIAL (hecho: lap timer en vivo, sectores y vuelta óptima)**
- **Cronometraje en vivo** (pestaña «Cronometraje»): vuelta actual en grande, última, mejor,
  **vuelta óptima**, delta y sectores, con pop-ups al cruzar meta/splits, y grabación a local.
- **Circuitos** (pestaña «Circuitos»): marcar meta/splits en el sitio, invertir sentido, renombrar,
  borrar y crear un circuito desde una sesión guardada.
- Pendiente: sectores con colores ± vs referencia, comparación de 2 vueltas superpuestas y
  delta de velocidad.

**Slice 4 — Trazada sobre mapa real (opcional).**
- Teselas OSM/Mapbox con la trazada encima (requiere red; clave si se usa Mapbox). La trazada
  offline actual se mantiene como fallback.

**Slice 5 — Más allá (no ahora).** Vídeo+overlay, OBD-II, pulsómetro, drag meter, nube.

## 5. Decisiones tomadas

- **Local-first** (sin backend): los circuitos se guardan junto a las sesiones en IndexedDB.
- **OSM (Overpass)** como fuente de circuitos abierta, con **atribución** (ODbL).
- La heurística actual se conserva **solo como sugerencia inicial** al aprender un circuito; una vez
  hay trap, el cronometraje es determinista.

## 6. Caso concreto: Karting Canarias (La Esperanza)

- **OSM no sirve para este circuito**: en el área del recinto OSM solo tiene un `highway=raceway`
  parcial (way 78336797) y el polígono del recinto mide ~182×58 m, muy inferior al trazado real
  (circuito largo con una S central y un bucle inferior-derecho que **sí es parte de la pista**,
  aunque la ortofoto lo tapa con árboles).
- **Vías para tenerlo exacto**, en orden de fiabilidad:
  1. **Grabar una vuelta** con el RaceBox (Cronometraje → Iniciar grabación, funciona sin circuito) y
     crear el circuito desde esa sesión: es la trazada real, sin dibujar nada.
  2. **Dibujar sobre la ortofoto y exportar KML**: en **Google My Maps** (mymaps.google.com) →
     «Añadir línea» → dibujar la pista → «Exportar a KML» → importar en el editor. (Google Earth
     **Pro** de escritorio también tiene «Añadir → Ruta»; la versión **web** no permite dibujar
     rutas sin un proyecto.)
  3. **Pegar coordenadas**: clic derecho en Google Maps en cada punto del circuito (~15–30) y
     pegarlas en el editor.
- Después, la meta y los sectores se colocan **tocando el mapa** en el editor (el sentido se toma de
  la trazada, no del GPS parado).

## 7. Próximos pasos para validar

1. Aprender un circuito real (karting de Tenerife) desde una sesión descargada y comprobar que las
   vueltas cuadran con las de la app oficial.
2. Contrastar un circuito de OSM con el catalogo de la app (mismo circuito, misma meta).
3. Medir el ancho de trap necesario para capturar todas las vueltas con GPS de 25 Hz.
