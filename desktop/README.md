# Desktop shell

## What this is, in plain language

The kit is a web page. Stores don't sell web pages — they sell apps you install.
A **shell** is a tiny application whose only job is to open a window and show
that web page full screen, with none of a browser's furniture: no address bar,
no tabs, no back button. The player sees a normal app. Inside, it's your same
`index.html`, unchanged.

The shell is what Steam installs and launches. The game doesn't know it exists.

That separation is the point. `main.js` here is about seventy lines and contains
no game logic at all. If it ever grows any, something has gone wrong — the kit
should stay a single file that still runs by double-clicking it in a browser.

This is also why making the kit self-contained mattered. A shell has no internet
to fall back on, so a kit that fetched three.js from a CDN would have shown a
blank window on a plane.

## Running it

```bash
cd desktop
npm install          # once; downloads Electron, which is large
npm start
```

## Building something you can ship

```bash
npm run build:linux    # AppImage
npm run build:win      # installer + zip
npm run build:mac      # dmg + zip
```

Builds land in `desktop/dist/`. You can only build for a platform from that
platform, with one exception: Windows can be built from Linux or macOS. **macOS
builds need a Mac.** That's Apple's rule, not Electron's.

The packaged app is around 230 MB, almost all of it Chromium. That is the cost
of the shell guaranteeing every player gets the same renderer — which matters
more than usual here, because this is a 3D kit and you do not want to debug one
player's WebGL against another's.

## What's verified

Both the source build and a packaged build were launched and driven here: the
window opens, the kit loads, Three.js r128 is present, all 322 pieces are there,
nothing is fetched from off-page, saving to local storage works, and the console
is clean.

## Steam

Steam takes an executable. Build for the platforms you want, upload the contents
of the build folder through Steamworks, and point the launch option at the
binary. There is no extra wrapping — your AppImage or `.exe` *is* the thing
Steam ships.

## iOS and Android

Not set up here, deliberately. Those need tooling this machine doesn't have —
Xcode for iOS, which also requires a Mac, and Android Studio for Android — so
anything written for them could not have been run, and an unverified build
script is worse than none.

When you have that tooling, the route is Capacitor: it wraps the same
`index.html` in a native shell the same way this does, adds `ios/` and
`android/` project folders, and you open those in Xcode and Android Studio to
sign and submit. Both stores also want an Apple Developer or Google Play
account, which are paid and take a few days to approve. Worth starting that
paperwork before the build work, since the waiting is the slow part.
