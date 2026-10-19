# Captura de Apex en carrera — procedimiento rápido (pendiente T.Track/Pit)

Objetivo: cerrar la única duda que bloquea la Fase 6 (carteles BOX/PIT) y el tiempo de stint: la **semántica de la columna `T.Track/Pit`** (`data-type="otr"`) en los mensajes crudos de Apex.

Lo que ya sabemos (ver `docs/live-screen-pending.md`):
- En **modo carrera** el grid trae la columna `T.Track/Pit` (`data-type="otr"`, celda c11) y `Pits` (`pit`, c12). En práctica no aparecen.
- La celda es `<td data-id="rNc11" class="<in|to>">M:SS</td>`.
- Observado: clase `to` correlaciona con estado `si` (parado) y un valor con punto final (`26:03.`); clase `in` con `sf`.

Lo que falta confirmar: qué clase es "en pista" y cuál "en boxes", y qué significa el punto final, viendo una **transición real** de un equipo entrando y saliendo de boxes.

## Cuándo

Durante una **carrera en directo** en Apex (modo carrera). Basta con que haya actividad de paradas mientras corre el script. Una ventana de 3–5 minutos suele ser suficiente si alguien entra a boxes en ese rato.

## Cómo (una línea)

Desde la raíz del monorepo:

```bash
npm run apex:capture --workspace backend -- <urlDelCircuito> 300
```

Ejemplo con el circuito del pantallazo (KOTARR / Cronosystem):

```bash
npm run apex:capture --workspace backend -- https://www.apex-timing.com/live-timing/cronosystem2/ 300
```

Alternativa directa:

```bash
node backend/scripts/apex-capture.mjs <urlDelCircuito> 300
```

- `<urlDelCircuito>`: la URL de la página de live timing del circuito (la misma que abres en el navegador; se ignoran parámetros tipo `?fbclid=...`).
- `300`: segundos de captura (por defecto 300). Para con Ctrl+C también guarda.
- El script es **solo lectura**: se conecta al WebSocket público de Apex y no envía ningún comando.

## Qué produce

En `backend/apex-captures/` (ignorado por git):

- `apex-raw-<ts>.log`: todas las líneas crudas recibidas.
- `apex-otr-<ts>.log`: **solo los cambios de `T.Track/Pit`** por equipo, con hora, dorsal/equipo, clase y texto anterior → nuevo. Este es el fichero clave.

Por consola también aparecen la cabecera del grid (para confirmar que trae `otr`/`pit`), el modo (`race`) y los cambios de estado/vueltas.

## Qué hacer y qué mandarme

1. Lanza el script durante la carrera (idealmente cubriendo una parada de boxes de algún equipo).
2. Al terminar, mándame:
   - el fichero **`apex-otr-<ts>.log`** (y el `apex-raw-<ts>.log` si no es enorme),
   - el **dorsal/equipo nuestro** en esa carrera,
   - si puedes, la hora aproximada en que un equipo entró y salió de boxes.
3. Con eso confirmo:
   - clase `in` vs `to` = modo pista vs boxes,
   - el significado del **punto final** (`26:03.`),
   - cómo se comporta el valor al entrar y salir,
   - si el valor es tiempo de stint (en pista) y tiempo en boxes (parado).
4. Después actualizo `docs/live-screen-pending.md` y arranco la Fase 6 (`computeOverlayState` + carteles BOX/PIT) y el `stint_time` con semántica verificada.

## Si el grid no trae T.Track/Pit

El script avisa: `AVISO: este grid no trae T.Track/Pit (probablemente modo práctica...)`. En ese caso hay que esperar a una sesión que esté en **carrera** (`init|r|`).
