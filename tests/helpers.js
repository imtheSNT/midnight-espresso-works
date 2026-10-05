// @ts-check
const path = require('path');
const { pathToFileURL } = require('url');

const KIT_URL = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

/** Phone held sideways — the layout the kit is designed around. */
const PHONE_LANDSCAPE = { width: 844, height: 390 };

/**
 * Open the kit with every off-page request blocked, so any test failing here
 * means the file stopped being self-contained.
 * Returns { errors, blocked } — both must stay empty for a clean boot.
 */
async function openKit(page, { viewport, render = false } = {}) {
  const errors = [];
  const blocked = [];

  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', e => errors.push('pageerror: ' + String(e).slice(0, 300)));

  await page.route('**/*', route => {
    const url = route.request().url();
    if (/^(file|data|blob):/.test(url)) return route.continue();
    blocked.push(url.slice(0, 120));
    return route.abort();
  });

  if (viewport) await page.setViewportSize(viewport);
  await page.goto(KIT_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__mew, null, { timeout: 60_000 });
  await page.waitForFunction(() => window.__mew.renderer && document.fonts.status === 'loaded',
    null, { timeout: 60_000 });

  /* Tests about behaviour don't need pixels, and drawing 322 pieces in software blocks the
     main thread hard enough to starve input. The kit's own noRender hook keeps the camera
     matrices updated while skipping the draw, so positions and hit-testing stay honest. */
  if (!render) await page.evaluate(() => { window.__mew.noRender = true; });

  return { errors, blocked };
}

/** Skip the box intro and lay the pieces out on the table, as the player sees them at step 0. */
async function openBoxAndLayOut(page) {
  await page.evaluate(() => {
    const m = window.__mew;
    m.boxFinish(true);
    m.tableLayout();
  });
  await page.waitForFunction(() => Object.keys(window.__mew.TABLE.clones || {}).length > 0,
    null, { timeout: 30_000 });
  // let intro tweens settle so nothing is mid-flight when a test looks
  await page.evaluate(() => { for (let i = 0; i < 90; i++) window.__mew.tick(1 / 60); });
}

/** Where a table piece sits on screen right now, in CSS pixels. */
async function pieceScreenPos(page, pieceId) {
  return page.evaluate((id) => {
    const m = window.__mew;
    const clone = m.TABLE.clones[id];
    if (!clone) return null;
    const pick = clone.userData.pick || clone;
    const v = new THREE.Vector3();
    pick.getWorldPosition(v).project(m.camera);
    const r = m.renderer.domElement.getBoundingClientRect();
    return {
      x: r.left + (v.x * 0.5 + 0.5) * r.width,
      y: r.top + (-v.y * 0.5 + 0.5) * r.height,
      onScreen: v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1,
    };
  }, pieceId);
}

/** The piece the manual wants next at the current step. */
async function nextPieceId(page) {
  return page.evaluate(() => window.__mew.strictNext());
}

/**
 * A point on the stage with no piece under it, so a drag there turns the camera
 * instead of picking something up. Scans a coarse grid and keeps the candidate
 * furthest from any piece.
 */
async function emptyStagePoint(page) {
  return page.evaluate(() => {
    const m = window.__mew;
    const r = m.renderer.domElement.getBoundingClientRect();
    const picks = m.TABLE.shown
      .map(id => m.TABLE.clones[id] && m.TABLE.clones[id].userData.pick)
      .filter(Boolean);
    const rc = new THREE.Raycaster();
    const v = new THREE.Vector2();
    let best = null, bestGap = -1;

    for (let gx = 1; gx <= 9; gx++) {
      for (let gy = 1; gy <= 6; gy++) {
        const x = r.left + (r.width * gx) / 10;
        const y = r.top + (r.height * gy) / 10;
        v.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
        rc.setFromCamera(v, m.camera);
        if (rc.intersectObjects(picks, true).length) continue;

        // keep clear of the pieces on screen, so a sloppy drag doesn't clip one
        let gap = Infinity;
        for (const pk of picks) {
          const p = new THREE.Vector3();
          pk.getWorldPosition(p).project(m.camera);
          if (p.z > 1) continue;
          gap = Math.min(gap, Math.hypot(
            r.left + (p.x * 0.5 + 0.5) * r.width - x,
            r.top + (-p.y * 0.5 + 0.5) * r.height - y));
        }
        if (gap > bestGap) { bestGap = gap; best = { x, y, gap }; }
      }
    }
    return best;
  });
}

/**
 * Build the whole kit: every piece of every step, plus the wiring board.
 * Leaves the scene in the state a player stares at longest — everything on screen.
 */
async function buildWholeKit(page) {
  await page.evaluate(() => {
    const m = window.__mew;
    const tick = (n) => { for (let i = 0; i < n; i++) m.tick(1 / 60); };
    for (let s = 0; s < m.STEPS.length; s++) {
      let id;
      while ((id = m.strictNext())) { m.finishInstant(id); tick(2); }
      if (m.STEPS[m.BS.step].wire && !m.BS.wired) m.Wire.finish(true);
      if (m.BS.step < m.STEPS.length - 1) { m.Build.nextStep(); tick(2); }
    }
    tick(60);
  });
}

/**
 * Finish the kit and enter showcase mode — the state the café door unlocks behind.
 * Skips the reveal cinematic so tests don't wait on it.
 */
async function enterShowcase(page) {
  await page.evaluate(() => {
    const m = window.__mew;
    m.UI.enterShowcaseNow();
    for (let i = 0; i < 180; i++) m.tick(1 / 60);
  });
}

/**
 * Drag a piece from the table onto its outline and release, the way a player does.
 * The snap target is not the ghost's position — it includes a pre-seat offset the
 * game keeps private — so this hunts for the spot the game calls "hot", which is
 * also what a hand does. Returns true if the piece landed.
 */
async function dragPieceHome(page, pieceId) {
  const start = await pieceScreenPos(page, pieceId);
  if (!start || !start.onScreen) return false;

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 25, start.y - 20, { steps: 3 });
  await page.waitForTimeout(120);

  const ghost = await page.evaluate((id) => {
    const rt = window.__mew.RT[id];
    if (!rt.ghost) return null;
    const v = new THREE.Vector3();
    rt.ghost.getWorldPosition(v).project(window.__mew.camera);
    const r = window.__mew.renderer.domElement.getBoundingClientRect();
    return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
  }, pieceId);
  if (!ghost) { await page.mouse.up(); return false; }

  let landed = false;
  search:
  for (const radius of [0, 30, 60, 90, 120, 160, 200, 250]) {
    const steps = radius === 0 ? 1 : Math.max(8, Math.round(radius / 12));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      await page.mouse.move(ghost.x + Math.cos(a) * radius, ghost.y + Math.sin(a) * radius);
      if (await page.evaluate((id) => window.__mew.RT[id].dragHot, pieceId)) { landed = true; break search; }
    }
  }
  await page.mouse.up();
  await advance(page, 2.5);
  await page.waitForTimeout(300);
  return landed;
}

/**
 * Trace circles on a screw handle, as the screwdriver asks you to.
 * msPerStep 0 dispatches with no pause, which is far faster than any hand and is
 * how the stripping guard gets tested; a real pace is 40-60ms between moves.
 */
async function swirlScrew(page, { turns, msPerStep, handleIndex = 0 }) {
  return page.evaluate(async ({ turns, msPerStep, handleIndex }) => {
    const m = window.__mew;
    m.BS.tool = 'screw';
    const el = [...document.querySelectorAll('#handles .screw')][handleIndex];
    if (!el) return { error: 'no screw handle at index ' + handleIndex };

    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = 42;
    const perCircle = 24, total = Math.round(perCircle * turns);
    const stripsBefore = m.BS.strips || 0;
    const at = (a) => ({ x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R });
    const fire = (type, x, y) => el.dispatchEvent(new PointerEvent(type, {
      pointerId: 7, bubbles: true, cancelable: true, clientX: x, clientY: y,
      pointerType: 'mouse', isPrimary: true,
    }));

    const first = at(0);
    fire('pointerdown', first.x, first.y);
    for (let i = 1; i <= total; i++) {
      const q = at((i / perCircle) * Math.PI * 2);
      fire('pointermove', q.x, q.y);
      if (msPerStep > 0) await new Promise(res => setTimeout(res, msPerStep));
    }
    const last = at((total / perCircle) * Math.PI * 2);
    fire('pointerup', last.x, last.y);

    const screw = Object.values(m.RT).flatMap(rt => rt.screws || []).find(q => q.el === el)
      || Object.values(m.RT).flatMap(rt => rt.screws || []).find(q => q.done);
    return {
      difficulty: m.BS.diff,
      seated: !!(screw && screw.done),
      progress: screw ? +(screw.prog || 0).toFixed(2) : null,
      stripped: (m.BS.strips || 0) > stripsBefore,
      handlesLeft: document.querySelectorAll('#handles .screw').length,
    };
  }, { turns, msPerStep, handleIndex });
}

/** Reload the page as if the player closed the app and came back. */
async function reopenKit(page) {
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__mew, null, { timeout: 60_000 });
  await page.waitForFunction(() => window.__mew.renderer && document.fonts.status === 'loaded',
    null, { timeout: 60_000 });
  await page.evaluate(() => { window.__mew.noRender = true; });
}

/** Every part id currently drawing something, as the player would see it. */
async function visiblePartIds(page) {
  return page.evaluate(() => {
    const m = window.__mew;
    return Object.values(m.RT).filter(rt => {
      let any = false;
      rt.g.traverse(o => {
        if (!o.isMesh || any) return;
        let v = o.visible;
        o.traverseAncestors(a => { if (a.visible === false) v = false; });
        if (v) any = true;
      });
      return any;
    }).map(rt => rt.def.id).sort();
  });
}

/**
 * Cost of one scene pass. Measures the scene render itself rather than the
 * post-processing quad, which is what renderer.info reports after the composer.
 */
async function sceneCost(page) {
  return page.evaluate(() => {
    const m = window.__mew, r = m.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(null);
    r.info.reset();
    r.render(m.scene, m.camera);
    const out = { drawCalls: r.info.render.calls, triangles: r.info.render.triangles };
    r.setRenderTarget(prev);
    let visible = 0;
    m.scene.traverse(o => {
      if (!o.isMesh) return;
      let v = o.visible;
      o.traverseAncestors(p => { if (p.visible === false) v = false; });
      if (v) visible++;
    });
    out.visibleMeshes = visible;
    return out;
  });
}

/**
 * Park the press-and-hold timer for tests that are about the camera.
 * Under software rendering a frame can take longer than ctrl.lpMs, so the hold
 * fires before the first pointermove is even delivered and the tool wheel opens
 * mid-drag. That race is an artefact of this harness, not of the game — the
 * wheel has its own test, which uses the real timing.
 */
async function suspendToolWheel(page) {
  await page.evaluate(() => { window.__mew.ctrl.lpMs = 1e7; });
}

/** Run the game's own clock for a while without waiting in real time. */
async function advance(page, seconds = 1.5) {
  await page.evaluate((s) => {
    const steps = Math.round(s * 60);
    for (let i = 0; i < steps; i++) window.__mew.tick(1 / 60);
  }, seconds);
}

module.exports = {
  KIT_URL, PHONE_LANDSCAPE, openKit, openBoxAndLayOut,
  pieceScreenPos, nextPieceId, emptyStagePoint, suspendToolWheel, advance,
  buildWholeKit, sceneCost, enterShowcase, visiblePartIds, reopenKit,
  dragPieceHome, swirlScrew,
};
