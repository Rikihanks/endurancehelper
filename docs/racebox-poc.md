# PoC RaceBox Mini S ↔ InLap (BLE + Capacitor)

Prueba de concepto para conectar una **RaceBox Mini S** real con InLap por
Bluetooth Low Energy, sin romper la PWA actual y dejando lista la distribución
nativa (iOS/Android) vía Capacitor.

- Pantalla de diagnóstico: **`/racebox`** (también `#racebox`, útil en la app nativa).
- Código BLE: `frontend/src/services/bluetooth/**` y `frontend/src/services/devices/racebox/**`.
- UI PoC: `frontend/src/features/racebox-poc/**`.
- Investigación del protocolo: `docs/racebox-protocol-research.md`.

---

## 1. Requisitos de desarrollo

Comunes:
- **Node.js >= 20** (el proyecto y CI usan Node 20; local se ha validado con Node 24).
- **npm** (lockfile `package-lock.json` en la raíz; monorepo con workspaces).

Para nativo:
- **Android**: Android Studio (o Android SDK) + JDK 17.
- **iOS**: macOS + Xcode 15+ + CocoaPods. En Windows/Linux se genera el proyecto
  Xcode pero `pod install` y la compilación **no** son posibles.

## 2. Instalación de dependencias

```bash
npm install
```

Dependencias añadidas a `frontend/package.json` (versiones fijadas y compatibles entre sí):

| Paquete | Versión | Tipo |
| --- | --- | --- |
| `@capacitor/core` | `7.6.9` | dependency |
| `@capacitor/android` | `7.6.9` | dependency |
| `@capacitor/ios` | `7.6.9` | dependency |
| `@capacitor/cli` | `7.6.9` | devDependency |
| `@capacitor-community/bluetooth-le` | `7.3.2` | dependency |

Capacitor 7 requiere Node >= 20 (compatible con CI y Docker); Capacitor 8 exige
Node >= 22, por eso se eligió la rama 7. El plugin `bluetooth-le` 7.3.2 declara
`peerDependency @capacitor/core >= 7.0.0`.

## 3. PWA (web)

```bash
npm run dev:front          # servidor Vite en http://localhost:5173
# abre http://localhost:5173/racebox  (o el enlace "RaceBox PoC" en la landing en dev)
```

```bash
npm run build              # build de producción de la PWA -> frontend/dist
npm run preview --workspace frontend
```

Tests (protocolo, decodificador y máquina de estados; no requieren hardware):

```bash
npm test --workspace frontend
```

Nota Web Bluetooth: funciona en **Chrome/Edge de escritorio y Android** bajo
**HTTPS o localhost**. **iOS Safari no soporta Web Bluetooth**; para iOS hay que
usar la app nativa. La pantalla PoC detecta la ausencia de BLE y lo indica sin
provocar errores.

## 4. Capacitor (nativo)

El `webDir` es `frontend/dist` y la app **incluye los recursos web locales**
(no depende de GitHub Pages ni usa `server.url`). Configuración:
`frontend/capacitor.config.json` (`appId` provisional `com.inlap.poc`).

```bash
# Desde frontend/ (o con --workspace frontend)
npm run build --workspace frontend     # 1. compila la web
npm run cap:copy --workspace frontend   # 2. copia dist -> android/ios
npm run cap:sync --workspace frontend   # 3. copia + actualiza plugins nativos
```

Plataformas ya generadas:

- `frontend/android` (proyecto Gradle).
- `frontend/ios` (proyecto Xcode).

### Android Studio

```bash
npm run cap:open:android --workspace frontend   # abre Android Studio
```

- Permisos declarados en `frontend/android/app/src/main/AndroidManifest.xml`:
  - Android 12+ (API 31+): `BLUETOOTH_SCAN` con `neverForLocation` y `BLUETOOTH_CONNECT`.
  - Android <= 11 (API <= 30): `BLUETOOTH`, `BLUETOOTH_ADMIN` y `ACCESS_*_LOCATION` (limitados a `maxSdkVersion=30`).
- El plugin se inicializa con `androidNeverForLocation: true`, por lo que en
  Android 12+ **no se pide permiso de localización**.

### Xcode (solo macOS)

```bash
cd frontend/ios/App && pod install
npm run cap:open:ios --workspace frontend   # abre Xcode
```

- Privacidad declarada en `frontend/ios/App/App/Info.plist`:
  `NSBluetoothAlwaysUsageDescription`.
- **No** se añade modo de segundo plano (`bluetooth-central`): esta PoC valida
  la conexión **en primer plano** únicamente.
- Requiere **dispositivo físico**: el simulador de iOS no soporta Bluetooth.

## 5. Procedimiento para probar la RaceBox Mini S

1. Enciende la RaceBox Mini S y colócala al aire libre (necesita fix GPS 3D para
   datos útiles).
2. Abre la pantalla PoC:
   - Web: `http://localhost:5173/racebox` (Chrome en Android/escritorio, HTTPS o localhost).
   - Nativo: abre la app y toca «RaceBox PoC» (enlace visible solo en dev/nativo),
     o navega a `#racebox`.
3. Comprueba el estado del transporte (nativo o Web Bluetooth) y pulsa
   **Iniciar escaneo**.
   - Nativo: aparecerá una lista de dispositivos con RSSI; localiza «RaceBox Mini…».
   - Web: el navegador abre su selector; elige la RaceBox.
4. Pulsa **Conectar** y revisa la sección **Información GATT**: debe aparecer el
   servicio Nordic UART `6e400001-…` con su característica TX `6e400003-…` (notify).
5. Pulsa **Iniciar recepción**: empiezan a llegar notificaciones `0xFF/0x01`.
   - Observa: paquetes, frecuencia (Hz), tiempo desde el último paquete, lat/lon,
     velocidad, aceleración, rumbo, hora del dispositivo, satélites y fix.
   - **Importante:** latitud/longitud/velocidad/rumbo sólo son válidos con **fix GNSS 3D**.
     Si el dispositivo está bajo techo verás ceros, `fixStatus = 0`, `0 sat`, `Lat/Lon Flags`
     bit0 = 1 y fecha `2020-08-02`. La pantalla muestra un aviso explicando esto y el frame
     crudo (hex) para compararlo con el ejemplo oficial. Sal al aire libre y espera al fix 3D.
6. Pulsa **Detener recepción**, **Desconectar** y vuelve a conectar sin reiniciar
   la app para validar el ciclo de vida.

## 6. Estado de validación (PoC)

- **Validado con hardware real**: escaneo, conexión GATT, descubrimiento NUS (RX/TX),
  suscripción y **streaming de datos** (`0xFF/0x01`) a ~25 Hz con **0 errores de checksum**
  (3373 tramas). Batería e IMU plausibles → offsets rev 9 correctos.
- **Pendiente**: captura **con fix GNSS 3D** (coordenadas reales); validación en iPhone y
  Android físicos; compilación nativa (requiere Xcode/Android SDK).
- El decodificador está verificado contra el **paquete de ejemplo oficial (rev 9)** en los tests.
- El motor de estrategia, el backend y las rutas existentes no se han modificado.

## 7. Limitaciones conocidas (PoC)

- **Sin fix GNSS no hay posición**: lat/lon/velocidad/rumbo llegan a cero y la fecha aparece
  como `2020-08-02`. Es el comportamiento del dispositivo, no un error de InLap.
- **Web Bluetooth no existe en iOS**; en Android funciona con Chrome.
- Sin servicio en segundo plano: si la app pasa a segundo plano, el sistema puede
  suspender BLE (la pantalla lo advierte).
- No se implementan grabación ni descarga de sesiones, ni integración con el
  motor de estrategia (fuera de alcance).
- La compilación nativa no se ha ejecutado en este entorno (falta Xcode/Android
  SDK). El proyecto se genera y sincroniza; el build queda pendiente.

## 8. Problemas habituales

| Síntoma | Causa / solución |
| --- | --- |
| «Este navegador no soporta Web Bluetooth» | iOS Safari o contexto no seguro. Usa la app nativa en iOS, Chrome en Android, o HTTPS/localhost. |
| No aparece ningún dispositivo al escanear (web) | El selector del navegador sólo muestra dispositivos cercanos; hay que elegir la RaceBox manualmente. |
| **Lat/lon/velocidad a cero** | **Sin fix GNSS** (`fixStatus = 0`, `0 sat`, `Lat/Lon Flags` bit0 = 1). Sal al aire libre hasta fix 3D (≥4 satélites). La app oficial muestra lo mismo. |
| «Hora del dispositivo» vacía o 2020-08-02 | Sin hora GNSS válida (`Validity Flags` bit0/bit1 = 0). Se resuelve con fix. |
| «Servicio ... no encontrado» al conectar | El dispositivo no expone NUS; ¿es realmente una RaceBox Mini S? Revisa el árbol GATT. |
| Sin datos tras «Iniciar recepción» | La RaceBox no está transmitiendo o se perdió la conexión; revisa el estado y vuelve a conectar. |
| `cap sync` avisa de CocoaPods en iOS | Estás fuera de macOS; `pod install` y el build iOS requieren macOS. |

## 9. Pasos pendientes para una integración de producción

1. Capturar 1 frame completo **con fix GNSS 3D** y guardarlo como vector real en los tests.
2. Validar en iPhone y Android físicos (escaneo, conexión, datos, reconexión).
3. Firmar la app y configurar identificadores de bundle/paquete definitivos
   (sustituir el provisional `com.inlap.poc`).
4. Diseñar la integración real con la estrategia (dónde y cómo consume InLap la
   telemetría RaceBox) y la política de permisos en producción.
5. Evaluar telemetría en segundo plano y reconexión automática limitada.
6. Añadir tests de integración con un emulador BLE.
