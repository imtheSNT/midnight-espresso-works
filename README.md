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
| Café | The door is in plain sight rather than behind a tab; the room stays shut until the kit is done, opens on every seat, and puts the front of the building back on the way out |
| Long game | All 322 pieces build to the final step; progress survives a reload; the finale plays and can always be skipped |
| Tools | A piece dropped on its outline seats and raises its screws; steady swirling drives one home; swirling far too fast strips it back to the start |

### Performance

Measured on a phone-sized screen with the kit fully built: **785 draw calls**
over ~700 visible meshes, ~209k triangles, ~158 separate materials, and only
two instanced meshes in the whole scene. The triangles are not a concern —
mobile GPUs handle far more.

**Don't reach for geometry batching.** It is the usual fix for a draw-call
count like this, and it does not fit here. 594 of those ~700 meshes belong to
placed kit parts, so merging the scenery saves almost nothing, and merging the
kit would break everything that addresses pieces one at a time: `roomHide()`
hiding the front of the building, X-ray, per-piece highlighting, reset. The
cost is real but it is the price of a kit whose pieces stay individually alive.

Two mitigations already exist and are worth knowing before adding more:

- **An adaptive ladder.** Frame times are sampled 45 at a time; past a 20ms
  median the pixel ratio steps down in quarters, then `envTrim()` lightens the
  environment, then `postDegrade()` lightens post-processing. Weak devices
  degrade themselves without any work from you.
- **An idle throttle.** When nothing is moving the loop redraws at most once
  every 400ms instead of every frame.

**The throttle rarely engages.** The ambient touches — steam off the cups, dust
in the light — flick their visibility on and off, and each flick counts as
movement. Measured at step 0, box just opened, nothing animating and no finger
on the screen: with the ambient effects disabled the loop settles to 2.4 draws
per second exactly as designed; with them on it runs flat out. So a phone
renders the whole scene continuously from the moment the box opens until the
app closes.

That is probably a larger battery and heat cost than the draw calls, since draw
calls only cost while something is drawing. It is also a deliberate piece of
art direction, so the decision is a design one, not a bug fix. If it needs
reining in, the cheap options are to let the ambient effects stop after a while
without input and resume on touch, or to scope them to the showcase and room
view rather than running them through the whole build. Backgrounding is already
free — browsers pause the animation frame callback in hidden tabs.

The budget test fails above 950 draw calls. If décor pushes it over, that is
the test working. The safe lever is instancing repeats *within* a single piece
— the screws on one bracket, say — because the instanced mesh still lives in
that piece's group and hides and moves with it. Instancing the same screw
across several pieces reintroduces exactly the problem batching has: the pieces
stop being separately addressable. Otherwise, raise the ceiling deliberately
with a note about why.

### Where the detail actually lives

Most of the kit's craftsmanship — the owl's spectacles and bow tie, the menu
board, the till and scales, the glazed cup cabinet, the gear train — is only
legible from a few units away. At the distance the finished kit is framed on
the desk, it reads as empty shelving. The room view is what rescues it, so
treat "Inside the café" as a headline feature rather than a bonus.

"Step inside the café" therefore sits above the showcase tabs rather than
inside the Café pane. It used to be in that pane, which meant it measured 0×0
whenever the Machine tab was open — and Machine is the tab the showcase opens
on, so the payoff for a ten-hour build was behind a tab switch nothing prompted.
Keep it above the panes.

### Testing the tools

The build tests place pieces with `finishInstant`, which skips glue and screws.
The tool tests don't: they drag a piece onto its outline with real pointer
events and then trace circles on the screw handle, so the mechanic is exercised
the way a player drives it.

Two details worth knowing if you touch them. The snap target is not where the
ghost sits — it includes a pre-seat offset — so `dragPieceHome` hunts for the
spot the game calls hot rather than computing it, which is also what a hand
does. And the stripping guard is driven by elapsed time, so the frantic case
dispatches moves with no pause at all; a `setTimeout` of a few milliseconds
actually lands around 25ms under load, which is a perfectly safe pace and will
not strip anything.

Add a case to `tests/mew.spec.js` whenever you fix something a player hit — a
test that doesn't fail when you put the bug back isn't protecting anything.

## Roadmap

- [ ] Blender-generated 3D models for café décor
- [x] Room view (interior café perspective) — built, four seats, covered by tests
- [ ] Additional assembly modules
- [ ] Mobile/tablet optimizations
- [ ] App Store / Play Store / Steam releases

## Credits

Created by **imtheSNT** (@marcus-robinson)

Three.js r128 — MIT, © 2010-2021 three.js authors.
Gloock and Barlow Semi Condensed — SIL Open Font License 1.1.
