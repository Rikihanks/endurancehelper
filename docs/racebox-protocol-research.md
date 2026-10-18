# RaceBox Mini S — Investigación del protocolo BLE

> Fecha de consulta: **2026-10-18**
> Estado: PoC validada contra hardware real (RaceBox Mini S física).

Este documento se ha actualizado tras dos hitos:
1. La **documentación oficial Rev 9** (ver §1) quedó accesible e indexada y **confirma la tabla
   de campos y el paquete de ejemplo** (ya no depende de fuentes de terceros).
2. Se conectó una **RaceBox Mini S real** desde la pantalla PoC: 3373 tramas, 0 errores de
   checksum, 25.5 Hz.

## 1. Fuentes consultadas

| Fuente | URL | Qué aporta |
| --- | --- | --- |
| Documentación oficial RaceBox (Rev 9) | https://www.racebox.pro/products/mini-micro-protocol-documentation | Tabla de campos, flags, paquete de ejemplo y comandos. El PDF se descarga tras un formulario; el contenido es público e indexado. |
| Cliente BLE de referencia (C/Arduino) | https://github.com/lgnap/RaceBoxMicroBleClient (MIT) | Implementación de framing/parseo; declara compatibilidad Mini S y Micro. |
| Emulador open source RaceBox Mini | https://github.com/anchit92/Open-Source-RaceBox-mini-Emulator (GPL-3.0) | Confirmación independiente del paquete de 88 bytes y del nombre anunciado. |
| Gist de volcado binario | https://gist.github.com/francois-baptiste/236f0c1785de8731d18418db0de8e095 | `numpy` dtype con el mismo orden de campos. |

## 2. Datos confirmados (documentación oficial Rev 9)

### 2.1. Transporte GATT
- Servicio: **Nordic UART** `6e400001-b5a3-f393-e0a9-e50e24dcca9e`.
- **RX** (cliente → dispositivo, escritura): `6e400002-…` (`write`, `writeWithoutResponse`).
- **TX** (dispositivo → cliente, notificaciones): `6e400003-…` (`notify`).
- Verificado en la Mini S real: ambos UUIDs y propiedades coinciden.
- El mensaje LIVE **se activa al conectar**: «It is enabled immediately on connection and you can
  start receiving it as soon as you subscribe for the BLE characteristic notifications.» **No hace
  falta enviar ningún comando.**
- Firmware 3.3+ expone además NMEA 0183 v4.11 (RMC, GNS, GGA, GSA, hasta 25 Hz) por una
  característica BLE separada.

### 2.2. Framing (UBX)
- `B5 62 | class | id | length(LE) | payload | ckA | ckB`; overhead **8 bytes**.
- Clase RaceBox **`0xFF`**; en el ejemplo oficial `length = 0x0050 = 80`.
- **Checksum Fletcher-16** sobre `[class .. payload]` (2, `4 + length` bytes): `ckA += b; ckB += ckA`.
- Mensaje LIVE `0xFF/0x01` = 80 bytes, hasta 25 Hz. History `0xFF/0x21` = mismo payload.

### 2.3. Payload LIVE (80 bytes, LE) — Rev 9

| Offset | Campo | Tipo | Escala |
| --- | --- | --- | --- |
| 0 | iTOW | u32 | ms (time-of-week) |
| 4 | year | u16 | año |
| 6/7/8/9/10 | month/day/hour/minute/second | u8 | mes 1–12; hora UTC |
| 11 | Validity Flags | u8 | bit0 fecha válida, bit1 hora válida, bit2 resuelta |
| 12 | Time Accuracy | u32 | ns |
| 16 | Nanoseconds | i32 | ns (puede ser negativo) |
| 20 | Fix Status | u8 | 0 sin fix, 2 2D, 3 3D |
| 21 | Fix Status Flags | u8 | bit0 fix válido, bit1 dif., bits4..2 power, bit5 rumbo válido |
| 22 | Date/Time Flags | u8 | bits 5..7 confirmación UTC |
| 23 | Number of SVs | u8 | satélites usados |
| 24 | Longitude | i32 | grados × 1e7 |
| 28 | Latitude | i32 | grados × 1e7 |
| 32 | WGS Altitude | i32 | **mm** |
| 36 | MSL Altitude | i32 | **mm** |
| 40 | Horizontal Accuracy | u32 | mm |
| 44 | Vertical Accuracy | u32 | mm |
| 48 | Speed | i32 | mm/s |
| 52 | Heading | i32 | grados × 1e5 |
| 56 | Speed Accuracy | u32 | mm/s |
| 60 | Heading Accuracy | u32 | grados × 1e5 |
| 64 | PDOP | u16 | × 100 |
| 66 | Lat/Lon Flags | u8 | **bit0 = 1 → lat/lon/altitudes NO válidas**; bits4..1 diff age |
| 67 | Battery Status | u8 | Mini/Mini S: bit7 cargando + 0–100 %; Micro: tensión × 10 |
| 68 | GForceX | i16 | mG (1 g = 1000 mG) |
| 70 | GForceY | i16 | mG |
| 72 | GForceZ | i16 | mG |
| 74 | Rotation rate X | i16 | centi-grados/s (÷100 → deg/s) |
| 76 | Rotation rate Y | i16 | centi-grados/s |
| 78 | Rotation rate Z | i16 | centi-grados/s |

Ejes: G X frontal/trasero, Y derecha/izquierda, Z arriba/abajo; giro X roll, Y pitch, Z yaw.

**Criterio oficial de fix bueno:** `Fix Status Flags` bit0 = 1 **y** `Fix Status` = 3.
Nuestro decodificador expone esto como `isPositionValid()` (además exige `Lat/Lon Flags` bit0 = 0).

### 2.4. Paquete de ejemplo oficial (Rev 9)

Bytes de frame (0 = sync `B5 62`); los valores están verificados contra el documento:

```
02 FF 01        class=0xFF id=0x01
04 50 00        payload length 80
06 A0 E7 0C 07  iTOW 118286240
10 E6 07        year 2022
12 01 0A 08 33 08  month=1 day=10 hour=8 min=51 sec=8
17 37           Validity Flags (fecha/hora válidas y resueltas)
18 19 00 00 00  Time Accuracy 25 ns
22 2A AD 4D 0E  Nanoseconds
26 03           Fix Status 3D
27 01           Fix Status Flags (GNSS fix OK)
28 EA           Date/Time Flags
29 0B           Number of SVs 11
30 C6 93 E1 0D  Longitude 23.2887238
34 3B 37 6F 19  Latitude 42.6719035
38 61 8C 09 00  WGS Altitude 625.761 m
...
72 00           Lat/Lon Flags (coordenadas válidas)
73 59           Battery 89 %, no cargando
74 FD FF        GForceX -3 mG
76 71 00        GForceY 113 mG
78 CE 03        GForceZ 974 mG
80 2F FF        Rotation rate X -2.09 deg/s
82 56 00        Rotation rate Y 0.86 deg/s
84 FC FF        Rotation rate Z -0.04 deg/s
86 06 DB        Checksum Fletcher-16
```

Este ejemplo está codificado como test en `frontend/test/racebox-protocol.test.js`
(«decodes the official RaceBox rev 9 sample packet exactly»): decodifica exactamente
lat 42.6719035 / lon 23.2887238 / alt 625.761 m / 11 sat / batería 89 % / IMU -3,113,974 mG.

### 2.5. Frecuencia y flujo
- Tasas: **1 / 5 / 10 / 25 Hz** (25 Hz por defecto). Medido en real: **25.5 Hz**.
- LIVE se emite al suscribirse a TX. No requiere comando.

### 2.6. Memoria y grabación standalone (implementado en la pestaña «Sesiones»)
- **Estado** `0xFF/0x22` (payload vacío) → respuesta de 12 B: `[0]` grabando, `[1]` % de memoria,
  `[2]` bitmask de seguridad (bit0 habilitada, bit1 desbloqueada), `[4..7]` registros guardados,
  `[8..11]` capacidad total en registros (hasta **196 608**, ~16,5 MB).
- **Desbloqueo** `0xFF/0x30` + 4 B LE = código (por defecto **123456**). El bloqueo **se resetea
  en cada conexión**; hay que desbloquear antes de cualquier comando de memoria.
- **Descarga** `0xFF/0x23` (payload vacío) → respuesta `0xFF/0x23` con 4 B = registros esperados;
  después el dispositivo emite `0xFF/0x21` (registros, payload idéntico al LIVE) y `0xFF/0x26`
  (fronteras de sesión), y termina con ACK `0xFF/0x02` + `[FF 23]`. Durante la descarga
  **desactiva el LIVE**. Cancelar = `0xFF/0x23` con 1 byte.
- **Borrado** `0xFF/0x24` (irreversible; notifica progreso con payload de 1 byte 0–100; ACK final).
- **Grabar** `0xFF/0x25` (12 B): `[0]` enable, `[1]` tasa, `[2]` flags (bit0 wait-fix, bit1
  estacionario, bit2 sin-fix, bit3 auto-apagado), `[4..5]` umbral estacionario mm/s, `[6..7]`,
  `[8..9]`, `[10..11]` intervalos (s).
- NACK si: no hay standalone, memoria bloqueada u otra operación en curso.

## 3. Datos observados experimentalmente (hardware real)

**Captura 1 (bajo techo, sin fix):**
- Conexión GATT a **RaceBox Mini S** (`RaceBox Mini S 2242504377`) correcta, con NUS + TX notify.
- **3373 tramas, 3373 paquetes, 0 errores de decodificación**, ~**25.5 Hz**.
- IMU plausible (−722, 173, 671 mG; giro 0.1, 1.0, 2.5 deg/s) y batería 93 % → offsets 67–79 correctos.
- Sin fix: `fixStatus = 0`, `numSVs = 0`, `PDOP ≈ 99.99`, lat/lon = 0, fecha `2020-08-02`.

**Captura 2 (aire libre, con fix):**
- Lat **28.4524518**, Lon **−16.3611631**, MSL alt **908.654 m**, WGS alt **944.311 m**.
- **7 satélites**, `PDOP = 5.02`, precisión horizontal **8.5 m**, vertical 6.6 m, fecha/hora **2026-10-18 17:27:00 UTC** (válidas).
- `Lat/Lon Flags = 0x00` → **coordenadas válidas**.
- **Anomalía relevante:** `fixStatus = 0` y `Fix Status Flags = 0x00` **a pesar de tener posición
  válida y 7 satélites**. La Mini S no usa esos dos campos como cabría esperar de la Rev 9.
- Frame real capturado (88 B), verificado byte a byte y usado como test:
  `B5 62 FF 01 50 00 F0 D4 BE 03 EA 07 0A 12 11 1B 00 F7 00 04 00 00 88 B1 FA FF 00 00 E6 07 11 7C 3F F6 E6 7F F5 10 B7 68 0E 00 6E DD 0D 00 34 21 00 00 C7 19 00 00 17 00 00 00 00 00 00 00 7A 00 00 00 DC 5F FC 00 F6 01 00 5B 28 FD 62 01 4D 02 05 00 67 00 F3 00 5E F9`

## 4. Respuesta a «¿cómo lo hace la app oficial?»

La app oficial (y RaceChrono, LITPro, la app companion NSAT, etc.) **no hace nada especial**:
se suscribe a la característica TX y lee el mismo mensaje `0xFF/0x01`. La posición sólo es válida
cuando el dispositivo tiene solución GNSS.

**Conclusión práctica:** la validez de la posición se decide con **`Lat/Lon Flags` bit0** (0 =
coordenadas válidas) y el número de satélites —**no** con `fixStatus`/`Fix Status Flags`—, porque
una Mini S real reporta esos dos campos a 0 incluso con posición válida. Nuestra implementación lo
hace así: `coordinatesValid()` / `isPositionValid()` (Lat/Lon Flags + ≥4 satélites).

## 5. Hipótesis resueltas y pendientes

Resueltas:
- Offsets de **IMU (68–79)** y **batería (67)**: confirmados por la tabla oficial y por capturas reales.
- `speed`/`heading` (48/52) y precisiones (56/60): confirmados.
- LIVE se activa al conectar, sin comando: confirmado.
- **`fixStatus`/`fixFlags` no son fiables en esta unidad** para decidir la validez de posición; se
  usa `Lat/Lon Flags` + satélites.
- `PDOP ≈ 99.99` (raw 9999) corresponde a «sin solución»; con fix baja a valores normales (5.02).

Pendientes (menores, no bloquean la PoC):
1. Confirmar si el `fixStatus = 0` con posición válida depende del firmware o del estado de grabación.
2. Confirmar la característica NMEA (firmware 3.3+) en la unidad probada.
3. Validar reconexión tras desconexión inesperada con la unidad física.

## 6. Próximos pasos

1. Repetir la captura **al aire libre** y comprobar `fixStatus = 3`, `fixFlags` bit0 = 1,
   `Lat/Lon Flags` = 0 y coordenadas reales, y capturar 1 frame completo para guardarlo como
   vector real en los tests.
2. Validar en iPhone físico (Xcode) y Android físico (Android Studio) el ciclo completo.
3. Documentar la característica NMEA si se va a usar en el futuro.
