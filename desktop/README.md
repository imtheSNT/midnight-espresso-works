# Desktop shell

## What this is, in plain language

The kit is a web page. Stores don't sell web pages — they sell apps you install.
A **shell** is a tiny application whose only job is to open a window and show
that web page full screen, with none of a browser's furniture: no address bar,
no tabs, no back button. The player sees a normal app. Inside, it's your same
`index.html`, unchanged.

The shell is what Steam installs and launches. The game doesn't know it exists.

That separation is the point. `main.js` here is 87 lines, 29 of them blank or
comment, and contains no game logic at all. If it ever grows any, something has
gone wrong — the kit should stay a single file that still runs by
double-clicking it in a browser.

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
npm run pack           # unpacked app only — this is the one that has been run
npm run build:linux    # AppImage
npm run build:win      # installer + zip
npm run build:mac      # dmg + zip
```

Builds land in `desktop/dist/`.

Be precise about what has been proven here, because it is less than the list
above suggests. What I ran was `npm run pack` — `electron-builder --dir`, which
produces `dist/linux-unpacked/` without rolling it into an installer. I then
launched that binary and drove the kit inside it. So **packaging and the
packaged app are verified; no installer artifact has ever been produced.** The
AppImage, nsis, dmg and zip targets are configured and unexercised.

**The macOS build needs a Mac** — Apple's licensing, not an Electron limit.
Windows and Linux can often be cross-built from another platform, sometimes
needing Wine or Docker. Build each on its own machine if you want certainty
rather than my say-so, which is what you would want before shipping anyway.

Expect a large result. Measured here, `dist/linux-unpacked/` is 288 MB, of which
the Electron binary is 228 MB — against a 5,391,598-byte kit and a 3,967-byte
`app.asar`. Essentially all of it is Chromium; your game is under 2% of what
ships. Installers compress, so an AppImage will come out smaller than 288 MB,
but I have not built one, so don't quote a number for it until you have.

That bulk buys something specific. The shell ships its own renderer, so every
player runs the kit on the same Chromium you tested against — which matters more
than usual for a 3D kit, where the alternative is debugging one player's WebGL
driver against another's.

## What's verified

Both the source build and a packaged build were launched and driven here: the
window opens, the kit loads, Three.js r128 is present, all 322 pieces are there,
nothing is fetched from off-page, saving to local storage works, and the console
is clean.

## Steam

Steam takes an executable, which is what these builds produce — there is no
further wrapping step, and no Steam-specific code in the shell. Your AppImage or
`.exe` *is* the thing Steam would ship. The upload side (Steamworks, depots,
launch options) I have not done for you and cannot verify from here, so follow
Valve's own documentation for it rather than my description.

## iOS and Android

Not set up here, deliberately. Those need tooling this machine doesn't have —
Xcode for iOS, which also requires a Mac, and Android Studio for Android — so
anything written for them could not have been run, and an unverified build
script is worse than none.

The usual route is Capacitor, which wraps a web page in a native shell much as
this does and generates `ios/` and `android/` projects you then open in Xcode
and Android Studio to sign and submit. I have not run that here, so take it as
the direction to look rather than a tested recipe. Both stores also require a
paid developer account, and approval takes time — worth starting that paperwork
early, since the waiting is the slow part.
