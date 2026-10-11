# Midnight Espresso Works

[![Tests](https://github.com/imtheSNT/midnight-espresso-works/actions/workflows/test.yml/badge.svg)](https://github.com/imtheSNT/midnight-espresso-works/actions/workflows/test.yml)

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
machine. That costs time: 63 tests took 30 minutes that way on the machine this
was last measured on, so take that as an order of magnitude rather than a
promise and time it on yours.
`npm run test:gpu` uses the real graphics card instead and is far quicker,
though results then depend on the machine; `npm run test:headed` lets you watch
them. For a quick loop, `npx playwright test -g "the tools"` runs one group.

You don't have to remember any of this before pushing: GitHub Actions runs the
whole suite on every push and pull request, on software rendering too, so a red
run there means what a red run means locally. The HTML report is attached to
every run, and traces are attached when something fails — open the trace first,
it shows what the kit was actually doing.

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
| Camera | Squaring up faces the piece, frames it whole and centred, and never goes under the desk or too close to see anything |
| Camera | A piece with no face is framed without spinning the view; one already in plain sight is left alone |
| Camera | The square-up button takes one tap, goes when the kit is finished, and the four camera buttons still fit a phone held sideways |
| Outline | The ghost on show has an outline, dark enough to clear 3.0 contrast on both the mat and the counter, drawn above the x-ray wash, and not dimmed while you look for the piece |
| Carrying | A piece in hand rides over the machine instead of through it, the glide in from the table does too, and the lift never takes the piece away from the pointer |
| Fitting | A piece is held only as far above its seat as there is room, checked against every piece of every step with denser sampling than the kit itself uses |
| Fitting | A piece with no way down comes in from the side, along a path that is clear |
| Budget | The finished kit stays under 950 draw calls and 400k triangles on a phone |
| Café | The door is in plain sight rather than behind a tab; the room stays shut until the kit is done, opens on every seat, and puts the front of the building back on the way out |
| Long game | All 322 pieces build to the final step; progress survives a reload; the finale plays and can always be skipped |
| Tools | A piece dropped on its outline seats and raises its screws; steady swirling drives one home; swirling far too fast strips it back to the start |
| Glue | A stroke along a seam glues the piece end to end; a stroke anywhere else glues nothing; the brush takes a press even when a loose piece lies on the seam |
| Press | Holding the ring clicks the piece down; letting go early lets it spring back unseated |

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

**The throttle works.** Measured at rest on a phone-sized screen, with nothing
animating and no finger on the screen: **2.3 draws per second at step 0** and
**2.2 once the whole kit is built** — the 400ms throttle, exactly as designed.

It takes several seconds to settle into that, because a few things hold the loop
awake briefly after the last change: the next-piece beacon has a six-second life
measured on the simulation clock, and that clock slows as the loop idles. Sample
too early and you will read a high rate and think it never sleeps. It does.

In the showcase the kit draws continuously, around 25 per second, and that is
correct: the machine is powered and turning. Gears, carousel, steam off the cups.
Nobody wants that frozen. The steam is gated on showcase (`BS.show`), so it costs
nothing during the ten hours of building.

So there is no battery problem to fix here. The app is quiet while you build and
busy while the machine runs, which is the right way round.

The budget test fails above 950 draw calls. If décor pushes it over, that is
the test working. The safe lever is instancing repeats *within* a single piece
— the screws on one bracket, say — because the instanced mesh still lives in
that piece's group and hides and moves with it. Instancing the same screw
across several pieces reintroduces exactly the problem batching has: the pieces
stop being separately addressable. Otherwise, raise the ceiling deliberately
with a note about why.

### Timing in tests: never race a timer you cannot win

Three separate tests in this suite have been caught passing or failing by
machine load, all the same way: a Playwright call waiting out a timer the kit
owns. The tool wheel's 430ms long press, the press ring's 0.45s of simulated
fill, and the recentre button's 320ms hold. Two CDP calls back to back have been
measured crossing 320ms under full-suite load, so even `down()` immediately
followed by `up()` is not a safe tap.

The remedies, in order of preference: assert the rule directly rather than
through the gesture; wait for the effect rather than for a duration, with a
predicate specific enough that something already in flight cannot satisfy it
(`tween.to.fit < before - 0.5`, not just "a tween exists"); or dispatch the
events from inside the page, where press and release land in the same task.

A test that depends on winning that race is not protecting anything — it is a
coin toss that will eventually be "fixed" by deleting the assertion.

The kit's own clocks are the other half of this. The café rolls its film after
**24 seconds** of quiet in the showcase, and `body.cine` hides the whole panel
and camera cluster while it plays; the coach card takes itself away after
**4.8 seconds**. A test that reaches the showcase and then spends longer than
that on round trips measures a door of width 0 and blames the door. Three
separate tests have been caught by that one. The remedy is the same: open it,
stop the film, pin `CINE.lastIn` and measure, all inside a single
`page.evaluate`.

### Timing in tests: hold by fill, not by the clock

The press ring fills over about 0.45s of *simulated* time, and the frame loop
clamps `dt` to 50ms. On a slow machine a fixed 700ms press therefore delivers
far less than 700ms of fill and the piece never clicks down — a flaky test
rather than a bug. `pressAndHold` holds until the ring reaches a given fill
instead of for a set duration.

It also polls once per animation frame rather than on a timer. A `setTimeout`
can be delayed for hundreds of milliseconds under load, which is long enough
for the ring to sail past the release point and reach the top; per-frame polling
can only overshoot by one frame's worth.

The same thinking applies to the screwdriver from the other direction: there, a
short `setTimeout` lands near 25ms under load, which is a perfectly safe swirling
pace, so testing the strip rule means dispatching with no pause at all.

### Carrying a piece over the work

A part in your hand used to have only the desk under it, so dragging it across
the kit buried it. Measured by casting rays down at the carried piece's own
footprint against the pieces already placed: sweeping three different pieces
across a built machine, the piece was **inside placed geometry at 26 of 63
points**, at the worst of them **13.57 units** below the surface overhead. The
glide in from the table was worse in its own way — the front service cover at
step 9 spent **38 of the first 40 frames** inside the machine.

It now rides over whatever is beneath it. Three things make that work, and each
of them is there because the simpler version failed:

- **Boxes, not triangles.** The height comes from the placed pieces' bounding
  boxes. A box round a piece is taller than the piece, so the part rides a shade
  high over fiddly detail — the forgiving direction, and steadier than tracking
  every lip and screw head. They are gathered once, when you pick something up,
  because nothing already placed moves while you carry.
- **Lift along the view ray, not straight up.** Straight up is simpler and takes
  the piece away from your hand the moment it crosses the machine. There is a
  test for that specifically.
- **Raise until it clears, then walk back down.** The view ray leans, so lifting
  also carries the piece towards you and off the thing it was lifted over, and
  the first height that clears can be far higher than the height that needs to.

### How far a piece is held above its seat

Every piece used to be held the same distance above where it goes — 0.9, or
1.2 for a pressed one — and lowered straight down, whether or not there was
that much room. Measured against real geometry, walking the build in order and
asking each piece whether it could rise by its own lift: **104 of them could
not.** The four feet under the floor plate are the plainest case — lifting one
puts it inside the plate it bolts to, then it comes back down through it.

The lift is now whatever room there is, up to the old figure. A part that drops
into open air still swings in from 0.9 above; one that fits under something
comes in through the gap it actually has. Where you aim does not change, because
the hold point only ever moves *closer* to the seat.

Two readings, smaller wins. Rays from the piece's own surface do nearly all the
work — they are the only thing that sees an interlocked part, like a gear
threaded on an axle, which has nothing above its silhouette and still cannot
rise an inch. A box check overhead is a free second opinion worth, measured, the
difference between 34 and 32.

It is measured once per piece, when the ghost first appears, not on the first
pointer move of a drag: the priciest piece in the kit takes 40ms, which you
would feel mid-gesture and will not notice while a step is opening.

### And which way it comes in

33 pieces have no room above them at all. With the lift cut to the room
available they would appear at the seat with no motion, which is honest and
dull. **30 of them now slide in from the side** — the four feet under the floor
plate come in from the left, the service cover off the front, a chair in from
the side of the room.

Sideways only, never from below. A piece held under its seat would be inside
the machine or the desk and hard to aim at; sideways it is held at most one
lift from where it goes, which is no further off than the lift it used to get,
so nothing about aiming gets harder.

Two numbers worth keeping. The direction is sampled **twice as densely** as the
lift measurement, because at the lift measurement's own density the direction
picked was blocked for **13 of 34** — it made the kit worse by its own survey.
Twice brings that to 4; four times brings it to 3 and doubles the worst piece
from 73ms to 103, which is not worth it. And a slide has to be worth taking:
without a 0.3 floor, six more pieces slide in by less than that, two of them
through something.

(An earlier survey of all this using bounding boxes claimed 95 pieces had no way
in at all. That was an artefact of boxes overlapping long before parts touch,
not a fact about the kit — it is in the history as a caution.)

What is still not real: a piece arrives already turned the right way round. You
never rotate it in your hands. Marcus's call, and the right one — it would be a
puzzle nobody asked for.

### The outline that shows where a piece goes

Marcus's aunt said she could not see it. She was right, and the reason was
structural rather than cosmetic: **the ghost had no outline at all.**
`ghostClone` only copies line segments the source mesh already carries, and a
kit piece gets its edges from `addEdges` *after* its ghost is cloned — so no
ghost ever had any. The BackSide rim was no substitute either; its 0.07-unit
offset works out at 0.93 of a pixel at the step view, which makes it a third
wash over the same silhouette rather than a halo around it.

Measured by rendering the same frame with the ghost shown and hidden and
diffing the pixels: the warm orange cleared the 3.0 non-text contrast floor
against **3–6%** of the backgrounds it actually lands on, and across its own
boundary the median contrast was **1.03**. Three translucent warm washes over
warm wood is a problem with no answer in colour — an earlier attempt at
recolouring stalled at 2.18.

An outline is a different problem. `#1a0f07`, a shade of the kit's own edge
brown, clears 3.0 against **92%** of the backgrounds on the dark cutting mat and
**97%** on the pale counter, with the darkest tenth still at 3.20 and 4.95. A
cream outline fails the other way round. It does not pulse and it does not dim:
a line at 0.28 alpha is a grey smudge whatever colour it is.

The fill was separately at fault. `ghostFX` sets it to 0.42–0.64 and then
`Build.update`, a few lines later, overrode that to **0.08–0.18 whenever nothing
was in hand** — which is exactly the state you are in while looking for where a
piece goes. It is 0.17–0.30 now: doubled, not restored, because the outline is
what gives the shape its edge and the fill only has to say something belongs
here.

Outlines are built the first time a ghost is shown, not at boot. All 322 pieces
have a ghost; `updateGhosts` only ever shows one or two.

The tests for this are arithmetic and structure, not pixels, and deliberately
so: a pixel measurement of it would not hold still between runs, because the
fill rides a sine and the quality ladder changes the pixel ratio under load.
What they pin is what was actually broken.

### Squaring up to a piece

Tap the framing button at the left of the camera cluster &mdash; or hold the
recentre button, or press **F** &mdash; and the camera turns to face the piece
you are placing. The button went in first in the row so the three that were
already there keep the exact positions a player has learned; the cluster is
right-anchored, so nothing moved. One rule decides the angle: look down the
direction the piece's own vertices vary least along. That is a plate's normal and a post's broadside,
both from the same line of code.

Least *variance*, not least width. Measured across all 322 pieces, the narrowest
direction sent the compound gear train down a 45-degree diagonal — it is a stack
2.35 tall and 0.6 across, so the two widths either side of it tie to three
decimal places and the answer came out of the order of a list. Variance weights
the bulk of the material rather than one stray vertex, and the stack then reads
square across itself.

Some pieces have no face at all. A bulb, a bean jar, an owl's head tie to within
a percent in every direction, because a round thing has no face: 50 of the 322
measure that way. Asking to square up to one frames it from where you are
standing; it never spins the camera for nothing.

The same thing happens without being asked when you pick up a piece, but only
when the piece is close to **edge-on** — more than about 70 degrees off its own
face, where what you are aiming at is a line. That is the whole difference
between a help and a nuisance, and it is worth keeping. Opening each of the
twelve steps at its own view and asking every piece of that step: correcting
anything not already within 35 degrees of square would turn the camera for 218
of the 322 pieces, which is the auto-camera people complain about. The edge-on
test turns it for 44, and for none at all on three of the steps. An unasked move
also keeps your own zoom, so it is a turn of the model rather than a lurch
towards it.

Distance was the part that went wrong three times before this landed, once
asking for a `fit` of 52 and leaving the camera looking along the desk with
nothing in shot. It is now in the same family as `benchView`, `glueView` and
`screwView` — `max(floor, span * k + c)` — plus one floor those three never
needed: never closer in than 35% of whatever the step itself is framed at. A
microcontroller chip is 0.4 units wide, and framed on its own span it gave a
screen of bare wood with an orange speck in it. Where a piece goes is told by
what is around it.

### Why the glue brush takes a press before a loose piece

The canvas used to ask "did you grab a piece off the table?" before "are you
brushing a seam?". Loose pieces often lie right on top of the seam you need to
glue: on the first glued piece — the veneer fascia, step one — only **1 of its
82 on-screen seam points** could start a stroke. The other 81 handed the press
to a piece, so with the brush in hand you picked up a part instead of gluing.

`pointerdown` now checks the brush first, but only when the glue tool is the one
in hand. That exception matters: the wrap pieces (the timing belt) are traced
with the **hand**, which is also the pick-up tool, so reordering for them would
have broken picking pieces up near the belt. They keep the old order.

| Tool in hand | Pointer on an unglued seam | What happens |
| --- | --- | --- |
| Glue brush | yes | brushes the seam |
| Glue brush | no | as before |
| Hand (incl. wrap pieces) | either | picks pieces up, as before |

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

## Shipping it

The kit is a web page, and stores sell installable apps, so `desktop/` holds a
shell: an 87-line Electron app whose only job is to open a window and show
`index.html` with no browser furniture around it. The game is untouched by it
and still runs by double-clicking the file in a browser.

```bash
cd desktop && npm install && npm start   # run it
npm run pack                             # package it to desktop/dist/
```

Running it and packaging it are both verified — the packaged binary was launched
and the kit driven inside it. The installer targets (`build:linux`, `build:win`,
`build:mac`) are configured but have never been run, and the macOS one needs a
Mac. This is the kind of thing Steam installs. See `desktop/README.md` for the
rest, including why iOS and Android aren't set up here.

Being self-contained is what makes this work — a kit that fetched three.js from
a CDN would open to a blank window on a plane.

## Roadmap

- [x] **Café décor** — all 23 items are built and restylable: three seats, three
      tables, shelves and cabinet, three lamps, plant, flowers, basket, rug,
      cushion, wall hanging, till, grinder, scales, pastry stand, and both
      signature pieces. Modelled procedurally. A Blender pass would be a
      *quality* upgrade to what exists, not new content — and note it would push
      the draw-call budget, which is why that test is there.
- [x] **Room view** — four seats, wider lens, the front of the building fades
      away, covered by tests.
- [x] **Assembly modules** — 322 pieces across 12 steps, inside the 300–350
      target.
- [x] **Mobile and tablet** — camera overhaul, radial tool wheel at the touch
      point, flattened pencil response, palm rejection for a stylus, and a
      readable instructions panel on a phone held sideways. All of it still
      wants trying on real hardware: every measurement here was taken under
      software rendering, which says nothing about how it feels.
- [x] **Squaring up to a piece** — a button in the camera cluster, a hold on
      recentre, or F; the camera also corrects itself when a piece is edge-on.
      Covered by tests, and the same on desktop and touch apart from the
      keyboard shortcut.
- [ ] **Store releases** — `desktop/` wraps the kit for Steam. iOS and Android
      need Xcode and Android Studio on your own machine.

## Credits

Created by **imtheSNT** (@marcus-robinson)

Three.js r128 — MIT, © 2010-2021 three.js authors.
Gloock and Barlow Semi Condensed — SIL Open Font License 1.1.
