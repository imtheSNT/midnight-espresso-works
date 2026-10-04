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
  buildWholeKit, sceneCost,
};
