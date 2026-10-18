# Probar la app iOS sin un Mac

La app iOS es un proyecto Xcode (`frontend/ios/App`) y **Xcode solo existe en macOS**, así que
hay que compilar en un Mac (físico o en la nube). Estas son las vías reales, de más barata a
más completa. BLE **solo** funciona en un **iPhone físico** (el simulador no tiene Bluetooth).

## Opción A — Gratis, sin cuenta de pago: CI + Sideloadly

**Cómo:** GitHub Actions compila en un runner macOS y produce un `.ipa` **sin firmar**; luego lo
firmas e instalas desde Windows con **Sideloadly** (o **AltStore**) usando tu Apple ID gratuito.

1. Sube el repo a GitHub y ejecuta el workflow **iOS build** (`.github/workflows/ios-build.yml`)
   desde la pestaña *Actions* → *Run workflow*.
2. Cuando termine, descarga el artefacto **`InLap-unsigned-ipa`** (contiene `InLap-unsigned.ipa`).
3. En Windows: instala **Sideloadly** (sideloadly.io) y **iTunes** (o los drivers de Apple).
4. Conecta el iPhone por USB, arrastra el `.ipa` a Sideloadly, pon tu **Apple ID** y pulsa Start.
5. En el iPhone: *Ajustes → General → VPN y gestión de dispositivos* → confía en tu perfil.

**Límites del Apple ID gratuito:** la firma caduca a los **7 días** (hay que re-firmar), máximo
**3 apps** y **10 App IDs/semana**. Suficiente para probar BLE en el móvil.

**Requisitos:** el `bundle id` (`com.inlap.poc`) es provisional; con Apple ID gratuito vale tal cual.
No necesitas cuenta de pago ni certificados.

## Opción B — Cuenta Apple Developer (99 $/año): TestFlight

Permite **distribuir a testers** (TestFlight), builds de 90 días y sin re-firmar cada semana.

Recomendado sin Mac: **Codemagic** (gestiona certificados y perfiles automáticamente y sube a
TestFlight con tu Apple ID o API key) o **Ionic Appflow**. Alternativa: ampliar el workflow de
GitHub Actions con una **App Store Connect API key** + `fastlane` (te lo preparo si quieres).

Pasos previos (una vez):
1. Registra el `bundle id` en *Certificates, Identifiers & Profiles* (o cambia `appId` en
   `frontend/capacitor.config.json` por el definitivo).
2. Crea el registro de la app en **App Store Connect**.
3. Genera una **App Store Connect API key** (.p8 + Key ID + Issuer ID) y guárdala como secretos.

Para TestFlight hay que **firmar**; el workflow actual no lo hace a propósito (funciona sin secretos).

## Opción C — Alquilar un Mac en la nube

Si quieres usar Xcode con interfaz: **MacinCloud** (~25 $/mes), **MacStadium** o **AWS EC2 Mac**
(por horas). Útil para depurar el proyecto iOS con Xcode de verdad.

## Detalles del proyecto (ya resueltos en el repo)

- `frontend/capacitor.config.json` → `webDir: dist`, `appId: com.inlap.poc` (provisional).
- `frontend/ios/App/Podfile` ya incluye el plugin BLE (`@capacitor-community/bluetooth-le`).
- `frontend/ios/App/App/Info.plist` ya tiene `NSBluetoothAlwaysUsageDescription`.
- Añadido el **scheme compartido** `frontend/ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme`
  (Xcode lo genera solo al abrir el proyecto; sin él, `xcodebuild` no puede compilar en CI).

El workflow hace, en un runner `macos-14`:
`npm ci` → `npm run build --workspace frontend` → `npx cap sync ios` → `pod install` →
`xcodebuild archive` (sin firma) → empaqueta `Payload/App.app` en un `.ipa` → lo sube como artefacto.

## Coste y cuotas

- El runner **macOS** consume minutos de Actions **x10**. En repos de pago/privados del plan Free
  hay 2.000 min/mes → ~200 min de macOS (una compilación tarda ~5–10 min). En repos **públicos** es gratis.
- El workflow es **manual** (`workflow_dispatch`) para no gastar cuota en cada push.

## Siguiente paso recomendado

1. Ejecutar la **Opción A** y confirmar que la app arranca en el iPhone y detecta la RaceBox Mini S.
2. Cuando la PoC esté validada, pasar a la **Opción B** (TestFlight) con el `bundle id` definitivo.
