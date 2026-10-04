# Midnight Espresso Works

A beautiful 3D model-kit builder game inspired by Robotime/ROKR kits, featuring a mid-century modern espresso machine with café furniture and décor.

## About

**Midnight Espresso Works** (MEW) is an interactive 3D assembly experience built with Three.js. Assemble an intricate espresso machine piece-by-piece, complete with working components and a cozy café room setting.

- **322 pieces** with modular sub-assemblies
- **12 guided assembly steps** + free build mode
- **Café décor system** with furniture and styling options
- **Mid-century modern aesthetic**
- Built for desktop, tablet, and mobile (landscape-first)

## Getting Started

1. Open `index.html` in a modern web browser
2. Click pieces to pick them up
3. Follow the assembly guide or build freely
4. Customize the café with décor options

Nothing else is needed. `index.html` is fully self-contained — Three.js and both
typefaces are embedded — so it runs from a local file, from a USB stick, on a
plane, and inside a native app shell with no network at all.

## Development

This is a single-file Three.js application. To modify:

1. Edit `index.html` directly
2. Reload the browser to see changes
3. Test on multiple screen sizes (landscape mobile priority)

Keep it self-contained: don't add `<script src="https://…">` or a webfont link.
Anything the kit needs should be embedded, or the game goes blank the first time
a player is offline or a CDN has a bad day.

## Testing

Automated checks cover the things that have actually broken before — pieces
going invisible, unreadable text on a phone held sideways, and the camera.

```bash
npm install          # once
npx playwright install chromium   # once
npm test
```

Tests run headless against software rendering so results are the same on every
machine. `npm run test:gpu` uses the real graphics card instead (faster, but
machine-dependent), and `npm run test:headed` lets you watch them.

What's covered:

| Area | Check |
| --- | --- |
| Boot | Loads with every off-page request blocked; no console errors; Three.js r128 present |
| Type | Gloock, Barlow Semi Condensed and both MEW faces resolve offline |
| Table | The first piece is present and visible; every piece has a contact shadow |
| Table | A missed drop returns the piece to the table, still visible |
| Phone | The instructions panel opens with text ≥12px and doesn't scroll sideways |
| Phone | The model stays visible beside the panel; the wiring board fits without scrolling |
| Camera | A drag turns the model; the view can't flip under or over it; zoom stays in range |
| Tools | Press-and-hold opens the tool wheel centred on the touch |
| Budget | The finished kit stays under 950 draw calls and 400k triangles on a phone |

### The draw-call budget

The finished kit currently costs about **785 draw calls** over ~700 visible
meshes on a phone-sized screen, at roughly 209k triangles. The triangles are
not a problem — mobile GPUs handle far more. The draw calls are, and the
finished model is what players look at longest.

Two things keep it high: the scene uses ~158 separate materials, and almost
nothing is instanced (two instanced meshes in the whole scene). If the décor
list and the room view land as more individual meshes, this grows in step with
them. Batching static placed geometry, sharing materials, and instancing
repeats (screws, bolts, identical parts) are the levers, and they're worth
reaching for before the App Store build, not after.

The budget test fails above 950. If you add a lot of décor and it trips, that
is the test working — batch the new geometry, or raise the ceiling deliberately
with a note about why.

Add a case to `tests/mew.spec.js` whenever you fix something a player hit — a
test that doesn't fail when you put the bug back isn't protecting anything.

## Roadmap

- [ ] Blender-generated 3D models for café décor
- [ ] Room view (interior café perspective)
- [ ] Additional assembly modules
- [ ] Mobile/tablet optimizations
- [ ] App Store / Play Store / Steam releases

## Credits

Created by **imtheSNT** (@marcus-robinson)

Three.js r128 — MIT, © 2010-2021 three.js authors.
Gloock and Barlow Semi Condensed — SIL Open Font License 1.1.
