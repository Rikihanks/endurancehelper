# Pantalla en vivo — pendientes y supuestos

Documento de trabajo de la feature "Pantalla en vivo del piloto". Recoge lo que no se puede cerrar todavía y los supuestos que se están usando, para no inventar datos.

## 1. Pendiente bloqueante (no afecta a Fase 1)

### T.Track/Pit de Apex (`data-type="otr"`)

Estado: **pendiente de verificar con mensajes reales**. No se asume la semántica.

Lo que sí está comprobado:

- En modo carrera, el grid de Apex incluye la columna `T.Track/Pit` con `data-type="otr"` (c11 en cronosystem2) y `Pits` con `data-type="pit"` (c12).
- Cada celda de datos es `<td data-id="rNc11" class="<in|to>">M:SS</td>`.
- Valores observados: `1:00`, `0:20`, `1:28`, `26:03.` (con punto final), y celdas vacías.
- En la captura de cronosystem2, la clase `to` correlaciona con estado `si` (parado) y la clase `in` con `sf`; el único valor con punto final (`26:03.`) estaba en una celda `to`.

Lo que **no** está confirmado:

- Qué significa exactamente `in` vs `to` (modo pista vs modo boxes).
- Qué significa el punto final (¿contador vivo? ¿valor incompleto?).
- Cómo se comporta la celda al entrar y salir de boxes.
- Si el valor es tiempo de stint, tiempo en boxes, o cambia de significado.

Cómo cerrarlo (puntual y controlado, sin dejar procesos en segundo plano):

1. Capturar mensajes crudos de Apex durante una carrera, en el momento en que un equipo entra y sale de boxes.
2. Confirmar la transición de clase y de texto de `c11` para ese equipo.
3. Solo entonces se implementa `stint_time`, el cartel `PIT` y `PIT_HOLD` con semántica verificada.

Mientras tanto: no se implementa lógica que dependa de esa semántica. La Fase 1 (estructura con mock) no depende de ello.

## 2. Distinción de datos (criterio de auditoría)

| Nivel | Significado | Ejemplo |
|---|---|---|
| Apex lo proporciona | Está en el mensaje crudo del live timing | `T.Track/Pit` (`otr`), `Pits` (`pit`), `sta` (`in`/`si`/`so`/`sf`), `.P` con `inHour`/`outHour` |
| InLap lo procesa | El parser lo guarda en el snapshot | `on_track` (`apexClient.js:46`), `pits`, `status`, `ourPits` (`.P`) |
| InLap lo expone en UI | Hay un componente que lo pinta | posición, última/mejor vuelta, estado, stints por vueltas |

`on_track` está en el nivel "InLap lo procesa", pero **no** se expone en `view` ni se pinta hoy.

## 3. Supuestos adoptados (provisionales)

1. **Vueltas**: referencia visual `laps + 1` de Apex. El RaceBox aporta datos en vivo y su última vuelta; la reconciliación de cruces de meta se definirá en Fase 3 para no contar dos veces el mismo cruce.
2. **Delta**: se reutiliza el algoritmo del PoC RaceBox (distancia sobre la traza de la mejor vuelta: `resampleLapByDistance` + `computeDeltas`).
3. **Stint/boxes**: fuente `T.Track/Pit`, extrapolando entre mensajes y resincronizando en cada actualización; al salir, conservar el último valor para el `PIT_HOLD` de 3 s. **Semántica pendiente de verificar.**
4. **Canal BOX**: el estado BOX debe formar parte del estado completo de la sesión (snapshot), no un evento aislado, para sobrevivir a reconexiones.
5. **Formatos**: resistencia `HH:MM:SS`; stint `MM:SS`; vuelta `SS:mmm` y, a partir de 1 minuto, `M:SS:mmm` (p. ej. `1:00:123`); delta con dos decimales y coma, con signo (`-0,23`, `+0,41`).
6. **Colores**: hex aproximados del plan, centralizados como datos; provisionales hasta tener los definitivos.
7. **Mock**: solo en desarrollo (`import.meta.env.DEV`), marcado en pantalla y sin uso en producción.
8. **Pilotos**: no existen ids estables ni historial por piloto. Fase 7 no se implementa hasta que existan o se apruebe la propuesta de la Fase 7b.

## 4. Fase 7b

Pendiente: entregar propuesta escrita (identidad de móvil, presencia, asignación desde InLap, historial, permisos, modelo de datos y protocolo) antes de escribir código.

## 5. Fase 3 — supuestos implementados (RaceBox)

1. **Delta**: por distancia sobre la traza de la mejor vuelta de la sesión, reutilizando `resampleLapByDistance` + `haversine` del PoC (`RaceBoxLiveBridge`). En vivo se interpola el tiempo de referencia a la distancia actual y se resta el tiempo transcurrido de la vuelta.
2. **Sectores**: del motor RaceBox (`LiveTiming`) del circuito activo. El circuito es el track activo del PoC (`localStorage: inlap-active-track`), que es lo que hoy define meta y sectores en InLap. Sin track activo, sectores vacíos (un segmento gris).
3. **Traspaso best/last**: regla del plan. `useInLap = lapInLap >= lapRaceBox` (InLap = `laps + 1`); InLap manda si va igual o por delante, y por ítem cae a RaceBox si el dato falta.
4. **Supuesto crítico por confirmar**: la regla asume que **la numeración de vueltas de ambas fuentes está en la misma escala** (RaceBox empieza a contar en el mismo cruce en que Apex cuenta su vuelta). Si el RaceBox se arranca a mitad de carrera, las numeraciones no coinciden y hará falta un **offset** explícito; no se implementa heurística hasta confirmarlo con datos reales.
5. **Número de la mejor vuelta**: InLap no expone en qué vuelta se logró la mejor. Si el tiempo de InLap y el del RaceBox coinciden (±2 ms) se usa el número del RaceBox; si no, se muestra `V--` (no se inventa).
6. **Conexión RaceBox en la pantalla en vivo**: por ahora el conector BLE es **solo de desarrollo** (fila dev). En producción la conexión llega con la Fase 5; hasta entonces, sin conexión, delta y sectores muestran `--`.
7. **Tiempo de stint**: sigue pendiente de `T.Track/Pit` (sección 1). No dependía de la Fase 3.
