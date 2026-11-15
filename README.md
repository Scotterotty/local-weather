# Local Weather

Weather for exactly where you are. In the US it uses the National Weather Service grid forecast for your 2.5 km square, live readings from the nearest weather station (only if reported in the last 90 minutes), and active NWS alerts. Elsewhere it uses Open-Meteo, which picks the best model for the region. No accounts or API keys.

The app is one web page (`www/index.html`) wrapped as a native iOS and Android app with [Capacitor](https://capacitorjs.com/). On a phone it uses the native GPS.

## Web version

https://scotterotty.github.io/local-weather/

## Install on Android

Every push to `main` builds an APK. On your phone, open this repo's **Releases** page, open **Latest Android build**, and tap `local-weather.apk`. Android will ask you to allow installs from your browser the first time.

## Install on iPhone

Apple only allows installing apps you build yourself through Xcode on a Mac:

1. Install Xcode and Node.js 22 on the Mac.
2. `git clone` this repo, then `npm ci && npx cap sync ios && npx cap open ios`.
3. In Xcode, select the **App** target > Signing & Capabilities, choose your Apple ID as the team, plug in your iPhone and press Run.

A free Apple ID works, but the app has to be reinstalled every 7 days. A paid Apple Developer account ($99/yr) removes that limit and allows TestFlight.

Without a Mac, open the web version at https://scotterotty.github.io/local-weather/ in Safari and use Share > Add to Home Screen.

## Develop

- Edit `www/index.html`, then `npx cap sync` to copy it into both native projects.
- `npm run serve` runs it in a desktop browser at http://localhost:8080.
- `npx cap open android` / `npx cap open ios` opens Android Studio / Xcode.
