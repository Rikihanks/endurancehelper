# Fase 7b — Propuesta: asignación del móvil del piloto desde InLap

Propuesta **escrita**, sin código, previa a implementar la Fase 7b (punto 9.7 del plan). Cubre los 10 puntos pedidos.

## Contexto

Caso real: a un piloto se le acaba la batería y conduce con el móvil de un compañero. En boxes los pilotos no tocan el móvil; lo decide el **ingeniero** al cambiar el piloto activo, indicando además **en qué móvil** va a conducir. El caso normal (un móvil por piloto) no debe costar clics extra.

## Estado actual (auditoría, Fase 0)

- `race.drivers[]` es `{ name, weightKg, ballastKg, category }`, **sin id** (`backend/config.js:44-49`); se direcciona por índice.
- El piloto activo es `race.manualDriverIdx` (`config.js:50`), se cambia con `POST /api/config` (`server.js:216-225`) desde el Topbar (`components/Topbar.jsx:54-69`) y llega a los móviles por el broadcast del snapshot completo.
- **No existe** historial de stints por piloto (los stints se derivan por vueltas, `strategy.js:73-108`; el informe deduce el piloto por rotación, `telemetry/report.js:31-40`).
- **No existe** identidad de piloto por móvil (el login es de usuario de app, sin vínculo con `race.drivers`).
- **No existe** concepto de móvil/dispositivo con id y presencia (solo los ESP32 lo tienen: `schema.js:52-60`, `wsHub.js:14-35`).
- El estado completo ya se envía al conectar (`server.js:326`) y hay `GET /api/race-sessions/:id/state` (`raceSessions/routes.js:98-106`); la reconexión del frontend es fija a 3 s (`api.js:356-359`).

Conclusión: la Fase 7 (base) y la 7b comparten cimientos que **hoy no existen** (id de piloto, historial, identidad de dispositivo). Conviene construirlos una vez.

## 1. Identidad y presencia del móvil

- **Identidad estable por instalación**: al primer arranque, el móvil genera un `deviceKey` (uuid v4) y lo guarda de forma persistente. Propuesta: `@capacitor/preferences` en nativo (sobrevive a limpiezas de datos del WebView) con `localStorage` como respaldo en web.
- **Nombre visible**: editable por el piloto/ingeniero (p. ej. "Móvil Javi"). Se envía junto a `platform` (`ios`/`android`/`web`).
- **Registro/presencia**:
  - Al conectar el WS (y en cada reconexión), el móvil envía `{ type: 'hello', deviceKey, name, platform, battery }`; después, un latido ligero cada ~30 s.
  - El servidor mantiene en memoria (hub, igual que la presencia ESP32) el mapa `deviceKey → { orgId, socket, name, platform, battery, lastSeenAt }`.
  - **Presente** = WS abierto; **ausente** = sin socket. `lastSeenAt` para mostrar "visto hace X".
  - Opcional: espejar `{ deviceKey, name, platform, lastSeenAt, battery }` en BD para que la lista del ingeniero sobreviva a reinicios del servidor.

## 2. Dónde y cómo se cambia hoy el piloto activo

Hoy: Topbar → `POST /api/config { manualDriverIdx }`. Problema: es config (no sesión) y no contempla móvil.

Propuesta: mover el "quién conduce y con qué móvil" al **runtime de la sesión**, en una acción única:
- Nuevo `POST /api/race-sessions/:id/active { driverId, deviceId? }` que fija ambos de forma atómica.
- En la pantalla del ingeniero, el select de piloto existente se amplía con un select de móvil que **se autocompleta** con el móvil habitual del piloto (`driver.defaultDeviceKey` o el último asignado). Cero clics extra en el caso normal: el ingeniero elige piloto y el móvil ya viene preseleccionado.
- Caso batería: el ingeniero abre el mismo select de móvil y elige otro de los conectados. Sigue siendo la misma acción de cambio de piloto.

## 3. Qué recibe el móvil y cambio de `computeDriverState`

- El snapshot incorpora `active: { driverId, deviceId }` y, por comodidad, `activeDriverName`/`activeDeviceName` y la lista `devices[]` (para el ingeniero). Va en el snapshot, en cada push y en `GET /state`, así que se recupera bien al reconectar.
- `computeDriverState` con la condición **aislada**:
  - Modo base (9.2): `ACTIVE` si `active.driverId === myDriverId`.
  - Modo 7b: `ACTIVE` si `active.deviceId === myDeviceKey`.
  - Un único punto de decisión (una constante/módulo), cambiable sin tocar el resto.

## 4. Historial para `STINT_FINISHED` vs `WAITING`

- Registrar **eventos de cambio de piloto**: `{ at, fromDriverId, toDriverId, deviceId }` por sesión, persistidos (tabla `race_events` con `type='driver_change'` o tabla `race_stints`). El snapshot incluye `driverHistory` (o se consulta).
- Derivación por **piloto** (no por móvil), para que un cambio de móvil por batería no altere la historia:
  - `STINT_FINISHED` si el piloto aparece como `fromDriverId` (ya condujo) y el activo es otro.
  - `WAITING` si el piloto no aparece aún como activo.
  - El `deviceId` se guarda en el evento para la cabecera de grabación y auditoría.
- Si el servidor se reinicia, los eventos están en BD y el runtime los recarga.

## 5. Piloto activo sin móvil, o móvil asignado desconectado

- **Sin móvil asignado**: aviso al ingeniero. El móvil identificado por `driverId` (modo base) puede seguir mostrando `ACTIVE` si es el habitual; si no, no hay pantalla que lo muestre. Recomendación: la UI **nunca** deja cerrar la asignación sin móvil; por defecto propone el habitual.
- **Móvil asignado desconectado**: aviso al ingeniero ("el móvil de X está desconectado"). Al reconectar, ese móvil pide el estado completo y muestra `ACTIVE`; hasta entonces, los demás móviles derivan `STINT_FINISHED`/`WAITING` del último activo conocido.
- **Piloto sin móvil**: es responsabilidad del ingeniero; el sistema solo avisa.

## 6. Varios móviles por piloto

- Permitir **varios registrados** por piloto (repuesto); solo **uno activo por equipo** a la vez. El segundo queda como opción en la lista.
- Recomendación de partida: un único móvil activo por equipo simultáneamente.

## 7. Permisos

- Solo el **ingeniero** asigna (endpoint con auth + org y sesión de la org). Los móviles **solo leen** (WS `state` + `GET /state`); nunca escriben.

## 8. Cambios de modelo de datos y protocolo, riesgos y esfuerzo

**Modelo de datos**
- `race_config.drivers[]`: añadir `id` (uuid) estable y `defaultDeviceKey` (opcional).
- El snapshot de la sesión ya congela la config → incluye ids de piloto.
- Nueva `race_devices` (opcional, para la lista del ingeniero): `orgId, deviceKey, name, platform, lastSeenAt, battery, createdAt, updatedAt`.
- Nueva `race_events` `driver_change` (o tabla `race_stints`): `raceSessionId, at, fromDriverId, toDriverId, deviceId`.

**Protocolo / API**
- `POST /api/race-sessions/:id/active { driverId, deviceId }`.
- Snapshot: `active: { driverId, deviceId }`, `devices[]` presentes, y el historial de cambios de piloto.
- WS cliente→servidor: `hello` / `heartbeat` con `deviceKey`, `name`, `platform`, `battery`.

**Frontend móvil**
- `useDeviceIdentity` (genera/lee `deviceKey` y nombre) y envío de `hello`.
- `computeDriverState` con la condición aislada + tests.

**Riesgos**
- Invariante "solo un activo"; carreras de eventos.
- Pérdida de `deviceKey` al reinstalar → el ingeniero debe reasignar.
- Correctitud del historial tras reinicio del servidor.
- El ESP32 InLapBox también lee el piloto: mantener compatibilidad.
- Privacidad: nombres de móvil visibles para la org.

**Esfuerzo estimado** (backend+frontend, sin pruebas en dispositivo): ~3–5 días. Desglose: presencia+hello (0.5–1 d), endpoint activo+snapshot (0.5 d), UI ingeniero (0.5–1 d), eventos+derivación (1 d), switch de `computeDriverState`+tests (0.5 d), batería (0.25 d).

**Faseo propuesto**
- 7b.1 Registro de presencia + `hello`.
- 7b.2 Endpoint `active` + snapshot `active`/`devices`.
- 7b.3 UI del ingeniero (móvil por defecto, cero clics extra).
- 7b.4 Eventos de historial + derivación `STINT_FINISHED`/`WAITING`.
- 7b.5 (opcional) batería por móvil.
- 7b.6 Switch de `computeDriverState` a la condición por `deviceId`.

## 9. Batería de cada móvil (opcional)

El móvil lee `Device.getBatteryInfo()` (plugin `@capacitor/device`) y lo envía en `hello`/latido; el ingeniero ve el nivel por dispositivo conectado para anticipar el cambio. Requiere añadir `@capacitor/device` (comprobar compatibilidad con Capacitor 7).

## 10. Cabecera de grabación

Añadir `driver` y `deviceKey`/nombre de móvil a `meta.header` de la sesión grabada (el grabador ya reserva `driver: null`; se rellena cuando exista la Fase 7).

## Decisiones abiertas para Richard

1. ¿Presencia de dispositivos solo en memoria o espejada en BD?
2. ¿El piloto/móvil activo se mueve al **runtime de la sesión** (recomendado, se congela por carrera) o se queda en config?
3. ¿Un móvil activo por equipo (recomendado) o por piloto?
4. Identidad de dispositivo: `@capacitor/preferences` (recomendado) o `localStorage`.
5. ¿Incluimos el indicador de batería (7b.5) en la primera entrega?

## Nota de dependencia

La Fase 7 base y la 7b comparten cimientos (id de piloto, historial, identidad de dispositivo). Recomendación: implementarlos una vez (7b.1–7b.2 + ids de piloto) y, sobre eso, la máquina de estados base y después la asignación 7b.
