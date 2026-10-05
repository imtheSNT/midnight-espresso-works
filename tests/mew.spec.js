// @ts-check
const { test, expect } = require('@playwright/test');
const {
  PHONE_LANDSCAPE, openKit, openBoxAndLayOut, pieceScreenPos, nextPieceId,
  emptyStagePoint, suspendToolWheel, advance, buildWholeKit, sceneCost,
  enterShowcase, visiblePartIds, reopenKit,
} = require('./helpers');

/* ------------------------------------------------------------------ *
 * Boot — the kit must stand on its own, with nothing fetched off-page.
 * ------------------------------------------------------------------ */
test.describe('boot', () => {
  test('runs with no network at all', async ({ page }) => {
    const { errors, blocked } = await openKit(page, { render: true });

    expect(blocked, 'the kit asked for something off-page').toEqual([]);
    expect(errors, 'console errors on a clean boot').toEqual([]);

    const state = await page.evaluate(() => ({
      three: typeof THREE !== 'undefined' ? THREE.REVISION : null,
      renderer: !!window.__mew.renderer,
      pieces: Object.keys(window.__mew.RT).length,
      steps: window.__mew.STEPS.length,
      canvas: (() => { const c = document.querySelector('canvas'); return !!c && c.width > 0; })(),
    }));

    expect(state.three).toBe('128');
    expect(state.renderer).toBe(true);
    expect(state.canvas).toBe(true);
    expect(state.pieces).toBeGreaterThan(300);
    expect(state.steps).toBeGreaterThan(0);
  });

  test('carries its own type', async ({ page }) => {
    await openKit(page);
    const fonts = await page.evaluate(async () => {
      const got = async (spec) => (await document.fonts.load(spec)).length > 0;
      return {
        display: await got('44px "Gloock"'),
        ui: await got('600 20px "Barlow Semi Condensed"'),
        nunito: await got('700 15px "MEW Nunito"'),
        cinzel: await got('700 19px "MEW Cinzel"'),
      };
    });
    expect(fonts).toEqual({ display: true, ui: true, nunito: true, cinzel: true });
  });
});

/* ------------------------------------------------------------------ *
 * Pieces on the table — the bug Marcus hit: the base went invisible
 * at the start, and again whenever a drop missed.
 * ------------------------------------------------------------------ */
test.describe('pieces on the table', () => {
  test('the first piece is on the table and visible', async ({ page }) => {
    await openKit(page);
    await openBoxAndLayOut(page);

    const first = await nextPieceId(page);
    expect(first, 'the manual should want a first piece').toBeTruthy();

    const seen = await page.evaluate((id) => {
      const m = window.__mew;
      const clone = m.TABLE.clones[id];
      if (!clone) return { present: false };
      let visible = clone.visible;
      clone.traverseAncestors(o => { if (o.visible === false) visible = false; });
      return { present: true, visible, shown: m.TABLE.shown.includes(id) };
    }, first);

    expect(seen.present, 'the first piece has no copy on the table').toBe(true);
    expect(seen.shown, 'the first piece is not in the shown list').toBe(true);
    expect(seen.visible, 'the first piece is on the table but invisible').toBe(true);
  });

  test('every piece on the table sits on a contact shadow', async ({ page }) => {
    await openKit(page);
    await openBoxAndLayOut(page);

    const missing = await page.evaluate(() => {
      const m = window.__mew;
      return m.TABLE.shown.filter(id => {
        const c = m.TABLE.clones[id];
        return c && c.visible && !c.userData.shadow;
      });
    });
    expect(missing, 'pale pieces without a shadow read as paper on a pale desk').toEqual([]);
  });

  test('a missed drop brings the piece back, still visible', async ({ page }) => {
    await openKit(page);
    await openBoxAndLayOut(page);

    const id = await nextPieceId(page);
    const at = await pieceScreenPos(page, id);
    expect(at && at.onScreen, 'the next piece should be on screen to grab').toBeTruthy();

    // grab it off the table — the drag only begins once the pointer actually moves
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 26, at.y - 22, { steps: 4 });
    await advance(page, 0.2);

    const grabbed = await page.evaluate((pid) => window.__mew.RT[pid].state, id);
    expect(grabbed, 'the piece did not come off the table').toBe('drag');

    // drop it somewhere it clearly does not belong
    const box = page.viewportSize();
    await page.mouse.move(box.width - 18, box.height - 18, { steps: 6 });
    await advance(page, 0.2);
    await page.mouse.up();

    // let the glide-back finish
    await advance(page, 2.0);

    const after = await page.evaluate((pid) => {
      const m = window.__mew;
      const rt = m.RT[pid];
      const clone = m.TABLE.clones[pid];
      let visible = !!clone && clone.visible;
      if (clone) clone.traverseAncestors(o => { if (o.visible === false) visible = false; });
      return { state: rt.state, placed: m.BS.done.has(pid), hasClone: !!clone, visible };
    }, id);

    expect(after.placed, 'a bad drop should not count as placed').toBe(false);
    expect(after.state, 'the piece should be back in the tray state').toBe('tray');
    expect(after.hasClone, 'the piece lost its copy on the table').toBe(true);
    expect(after.visible, 'the piece vanished after a missed drop').toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Phone held sideways — the booklet text was ~7px tall here.
 * ------------------------------------------------------------------ */
test.describe('phone held sideways', () => {
  // the kit only switches to this layout for a touch screen: (pointer: coarse)
  test.use({ viewport: PHONE_LANDSCAPE, hasTouch: true });

  test('the instructions panel opens with readable text', async ({ page }) => {
    await openKit(page);
    await openBoxAndLayOut(page);

    const isPhoneLandscape = await page.evaluate(() => document.body.classList.contains('phone-l'));
    expect(isPhoneLandscape, 'the kit should treat this viewport as a phone held sideways').toBe(true);

    await page.evaluate(() => window.__mew.pbookShow(true));
    await advance(page, 0.5);

    const panel = page.locator('#pbook');
    await expect(panel).toBeVisible();

    const text = await page.evaluate(() => {
      const px = (sel) => {
        const el = document.querySelector(sel);
        return el ? parseFloat(getComputedStyle(el).fontSize) : null;
      };
      const pb = document.getElementById('pbook');
      return {
        title: px('#pbook .pb-t'),
        step: px('#pbook .pb-steps li'),
        part: px('#pbook .pb-parts li'),
        steps: document.querySelectorAll('#pbook .pb-steps li').length,
        parts: document.querySelectorAll('#pbook .pb-parts li').length,
        overflows: pb ? pb.scrollWidth > pb.clientWidth + 1 : null,
      };
    });

    expect(text.steps, 'no numbered instructions in the panel').toBeGreaterThan(0);
    expect(text.parts, 'no parts checklist in the panel').toBeGreaterThan(0);
    // the 3D booklet rendered about 7px here; anything under 12 is unreadable on a phone
    expect(text.title).toBeGreaterThanOrEqual(14);
    expect(text.step).toBeGreaterThanOrEqual(12);
    expect(text.part).toBeGreaterThanOrEqual(12);
    expect(text.overflows, 'the panel scrolls sideways').toBe(false);
  });

  test('the model stays visible beside the panel', async ({ page }) => {
    await openKit(page);
    await openBoxAndLayOut(page);
    await page.evaluate(() => window.__mew.pbookShow(true));
    await advance(page, 0.5);

    const clear = await page.evaluate(() => {
      const pb = document.getElementById('pbook').getBoundingClientRect();
      const c = document.querySelector('canvas').getBoundingClientRect();
      return { panelLeft: pb.left, canvasLeft: c.left, gap: pb.left - c.left };
    });
    expect(clear.gap, 'the panel covers the whole stage').toBeGreaterThan(80);
  });

  test('the wiring board fits without scrolling', async ({ page }) => {
    await openKit(page);
    await openBoxAndLayOut(page);

    const opened = await page.evaluate(() => {
      const modal = document.getElementById('wire-modal');
      if (!modal) return false;
      modal.hidden = false;
      document.body.classList.add('phone-l');
      return true;
    });
    test.skip(!opened, 'no wiring board in this build');

    await advance(page, 0.3);

    const fit = await page.evaluate(() => {
      const card = document.querySelector('#wire-modal .modal-card');
      if (!card) return null;
      const r = card.getBoundingClientRect();
      return {
        withinHeight: r.height <= window.innerHeight + 1,
        withinWidth: r.width <= window.innerWidth + 1,
        scrollsY: card.scrollHeight > card.clientHeight + 1,
      };
    });
    expect(fit).not.toBeNull();
    expect(fit.withinHeight, 'the wiring card is taller than the screen').toBe(true);
    expect(fit.withinWidth, 'the wiring card is wider than the screen').toBe(true);
    expect(fit.scrollsY, 'the wiring board needs scrolling on a phone').toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Camera — the thing that stopped Marcus's aunt cold on an iPad.
 * ------------------------------------------------------------------ */
test.describe('camera', () => {
  test('a finger drag turns the model', async ({ page }) => {
    await openKit(page);
    await openBoxAndLayOut(page);

    await suspendToolWheel(page);
    const before = await page.evaluate(() => window.__mew.view.theta);
    const from = await emptyStagePoint(page);
    expect(from, 'no clear patch of desk to drag from').toBeTruthy();

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    // one immediate step first: a press that sits still for ctrl.lpMs opens the tool wheel
    await page.mouse.move(from.x - 40, from.y);
    await page.mouse.move(from.x - 180, from.y, { steps: 6 });

    const mode = await page.evaluate(() => window.__mew.ctrl.mode);
    expect(mode, 'the drag grabbed something instead of turning the view').toBe('orbit');

    await page.mouse.up();
    await advance(page, 0.3);

    const after = await page.evaluate(() => window.__mew.view.theta);
    expect(Math.abs(after - before), 'dragging sideways did not turn the model')
      .toBeGreaterThan(0.05);
  });

  test('the view never flips under or over the model', async ({ page }) => {
    await openKit(page);
    await openBoxAndLayOut(page);
    await suspendToolWheel(page);
    const from = await emptyStagePoint(page);
    expect(from, 'no clear patch of desk to drag from').toBeTruthy();

    for (const dy of [-1200, 1200]) {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x, from.y + Math.sign(dy) * 40);
      await page.mouse.move(from.x, from.y + dy, { steps: 8 });
      await page.mouse.up();
      await advance(page, 1.0);

      const phi = await page.evaluate(() => window.__mew.view.phi);
      expect(phi, 'the camera left its limits (dy=' + dy + ')').toBeGreaterThanOrEqual(0.12);
      expect(phi, 'the camera left its limits (dy=' + dy + ')').toBeLessThanOrEqual(1.5);
    }
  });

  test('zoom stays within its limits', async ({ page }) => {
    await openKit(page);
    await openBoxAndLayOut(page);
    const box = page.viewportSize();

    await page.mouse.move(box.width / 2, box.height * 0.3);
    for (let i = 0; i < 20; i++) await page.mouse.wheel(0, 480);
    await advance(page, 0.3);
    const far = await page.evaluate(() => window.__mew.view.zoom);

    for (let i = 0; i < 40; i++) await page.mouse.wheel(0, -480);
    await advance(page, 0.3);
    const near = await page.evaluate(() => window.__mew.view.zoom);

    expect(far).toBeGreaterThanOrEqual(0.25);
    expect(near).toBeLessThanOrEqual(3.2);
  });
});

/* ------------------------------------------------------------------ *
 * Tool wheel — press and hold, centred on the touch, not a side menu.
 * ------------------------------------------------------------------ */
test.describe('tool wheel', () => {
  test('press and hold opens it where the finger is', async ({ page }) => {
    await openKit(page);
    await openBoxAndLayOut(page);

    const box = page.viewportSize();
    // a patch of empty desk, away from the pieces
    const x = Math.round(box.width * 0.82), y = Math.round(box.height * 0.28);

    const holdMs = await page.evaluate(() => window.__mew.ctrl.lpMs);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(holdMs + 220);

    const wheel = await page.evaluate(() => {
      const w = window.__mew.Wheel;
      return { open: !!w.open, cx: w.cx, cy: w.cy };
    });
    await page.mouse.up();

    expect(wheel.open, 'press and hold did not open the tool wheel').toBe(true);

    const stage = await page.evaluate(() => {
      const r = document.querySelector('canvas').getBoundingClientRect();
      return { left: r.left, top: r.top };
    });
    expect(Math.abs(wheel.cx - (x - stage.left)), 'the wheel is not centred on the touch')
      .toBeLessThan(28);
    expect(Math.abs(wheel.cy - (y - stage.top)), 'the wheel is not centred on the touch')
      .toBeLessThan(28);
  });
});

/* ------------------------------------------------------------------ *
 * Rendering budget — the finished kit is what players look at longest,
 * and it's where added decor will show up first. Measured on a phone.
 * ------------------------------------------------------------------ *
 * Today, fully built: 786 draw calls over 669 visible meshes, 209k
 * triangles. Triangles are not the worry; draw calls are. The ceilings
 * below sit just above today's numbers, so ordinary work passes and a
 * change that doubles the cost fails loudly instead of quietly shipping.
 * If you add a lot of decor and this fails, that's the test doing its
 * job — batch or instance the new geometry, or raise the ceiling on
 * purpose with a note saying why.
 */
test.describe('rendering budget', () => {
  test.use({ viewport: PHONE_LANDSCAPE, hasTouch: true });

  test('the finished kit stays within its draw-call budget', async ({ page }) => {
    await openKit(page);
    await openBoxAndLayOut(page);
    await buildWholeKit(page);

    const cost = await sceneCost(page);
    console.log('  fully built on a phone:', JSON.stringify(cost));

    expect(cost.drawCalls, 'draw calls for the finished kit').toBeLessThanOrEqual(950);
    expect(cost.triangles, 'triangles for the finished kit').toBeLessThanOrEqual(400_000);
    // a sanity floor: if this collapses, the kit stopped drawing rather than got faster
    expect(cost.drawCalls, 'the scene barely drew anything — did the build fail?')
      .toBeGreaterThan(100);
  });

  test('an unbuilt kit is cheap to draw', async ({ page }) => {
    await openKit(page);
    await openBoxAndLayOut(page);

    const cost = await sceneCost(page);
    console.log('  pieces on the table:', JSON.stringify(cost));
    // nothing is assembled yet, so the frame should be far lighter than the finished kit
    expect(cost.drawCalls, 'the opening frame got expensive').toBeLessThanOrEqual(250);
  });
});

/* ------------------------------------------------------------------ *
 * Inside the café — the room view is where the interior finally reads
 * at a size a player can see, so it needs to survive refactors.
 * Entering hides the front of the building; leaving must put every
 * one of those pieces back. That is the same class of bug as the
 * vanishing base, so it gets the same treatment.
 * ------------------------------------------------------------------ */
test.describe('inside the café', () => {
  test('stays shut until the kit is finished', async ({ page }) => {
    await openKit(page);
    await openBoxAndLayOut(page);

    const beforeFinish = await page.evaluate(() => {
      window.__mew.enterRoom();
      return window.__mew.ROOM.on;
    });
    expect(beforeFinish, 'the café opened before the kit was built').toBe(false);
  });

  test('opens once the kit is finished, on every seat', async ({ page }) => {
    await openKit(page);
    await openBoxAndLayOut(page);
    await buildWholeKit(page);
    await enterShowcase(page);

    const entered = await page.evaluate(() => {
      const m = window.__mew;
      m.enterRoom();
      for (let i = 0; i < 180; i++) m.tick(1 / 60);
      return { on: m.ROOM.on, view: m.ROOM.view, seats: Object.keys(m.ROOM_VIEWS) };
    });
    expect(entered.on, 'the café would not open on a finished kit').toBe(true);
    expect(entered.seats.length, 'expected several seats to choose from').toBeGreaterThanOrEqual(4);

    for (const seat of entered.seats) {
      const moved = await page.evaluate((k) => {
        const m = window.__mew;
        const from = { ...m.view, target: m.view.target.clone() };
        m.roomView(k);
        for (let i = 0; i < 200; i++) m.tick(1 / 60);
        return {
          seat: m.ROOM.view,
          shifted: m.view.target.distanceTo(from.target) > 0.01
            || Math.abs(m.view.theta - from.theta) > 0.01
            || Math.abs(m.view.phi - from.phi) > 0.01,
        };
      }, seat);
      expect(moved.seat, `roomView('${seat}') did not take`).toBe(seat);
    }
  });

  test('opens up the front of the building, then puts it back', async ({ page }) => {
    await openKit(page);
    await openBoxAndLayOut(page);
    await buildWholeKit(page);
    await enterShowcase(page);

    const before = await visiblePartIds(page);
    const lensBefore = await page.evaluate(() => window.__mew.camera.fov);

    await page.evaluate(() => {
      const m = window.__mew;
      m.enterRoom();
      for (let i = 0; i < 180; i++) m.tick(1 / 60);
    });

    const inside = await visiblePartIds(page);
    const lensInside = await page.evaluate(() => window.__mew.camera.fov);

    const hidden = before.filter(id => !inside.includes(id));
    expect(hidden.length, 'nothing was opened up to see inside').toBeGreaterThan(0);
    expect(lensInside, 'the lens should widen inside the room')
      .toBeGreaterThan(lensBefore);

    await page.evaluate(() => {
      const m = window.__mew;
      m.exitRoom(true);
      for (let i = 0; i < 180; i++) m.tick(1 / 60);
    });

    const after = await visiblePartIds(page);
    const lensAfter = await page.evaluate(() => window.__mew.camera.fov);
    const lost = before.filter(id => !after.includes(id));

    expect(lost, 'pieces stayed hidden after leaving the café').toEqual([]);
    expect(lensAfter, 'the lens was not restored on the way out').toBeCloseTo(lensBefore, 1);
  });
});

/* ------------------------------------------------------------------ *
 * The long game — a build is ten to fourteen hours, so the two things
 * that must never break are finishing it and not losing it.
 * ------------------------------------------------------------------ */
test.describe('the long game', () => {
  test('the whole kit builds, every step, to the end', async ({ page }) => {
    const { errors } = await openKit(page);
    await openBoxAndLayOut(page);

    const total = await page.evaluate(() => Object.keys(window.__mew.RT).length);
    await buildWholeKit(page);

    const end = await page.evaluate(() => {
      const m = window.__mew;
      const unplaced = Object.values(m.RT)
        .filter(rt => !m.BS.done.has(rt.def.id))
        .map(rt => rt.def.name || rt.def.id);
      return {
        placed: m.BS.done.size,
        step: m.BS.step,
        lastStep: m.STEPS.length - 1,
        wired: m.BS.wired,
        unplaced: unplaced.slice(0, 8),
        unplacedCount: unplaced.length,
      };
    });

    expect(end.unplaced, 'pieces the manual never offered').toEqual([]);
    expect(end.placed, 'not every piece was placed').toBe(total);
    expect(end.step, 'the build did not reach the final step').toBe(end.lastStep);
    expect(end.wired, 'the wiring never completed').toBe(true);
    expect(errors, 'console errors during a full build').toEqual([]);
  });

  test('progress survives closing the app', async ({ page }) => {
    await openKit(page);
    await openBoxAndLayOut(page);

    const before = await page.evaluate(() => {
      const m = window.__mew;
      const tick = (n) => { for (let i = 0; i < n; i++) m.tick(1 / 60); };
      for (let s = 0; s < 3; s++) {
        let id;
        while ((id = m.strictNext())) { m.finishInstant(id); tick(3); }
        if (m.STEPS[m.BS.step].wire && !m.BS.wired) m.Wire.finish(true);
        m.Build.nextStep(); tick(3);
      }
      const half = Math.floor(m.STEPS[m.BS.step].parts.length / 2);
      for (let i = 0; i < half; i++) {
        const id = m.strictNext();
        if (!id) break;
        m.finishInstant(id); tick(3);
      }
      m.Build.save();
      return { step: m.BS.step, done: [...m.BS.done].sort(), glued: [...m.BS.glued].sort(),
               wired: m.BS.wired, unboxed: !!m.BS.unboxed };
    });
    expect(before.done.length, 'nothing was built before reloading').toBeGreaterThan(20);

    await reopenKit(page);
    await advance(page, 1.0);

    const after = await page.evaluate(() => {
      const m = window.__mew;
      return { step: m.BS.step, done: [...m.BS.done].sort(), glued: [...m.BS.glued].sort(),
               wired: m.BS.wired, unboxed: !!m.BS.unboxed,
               // anything recorded as placed must actually be standing in the model
               notStanding: [...m.BS.done].filter(id => m.RT[id] && m.RT[id].state !== 'done') };
    });

    expect(after.step, 'came back on the wrong step').toBe(before.step);
    expect(after.done, 'placed pieces were lost').toEqual(before.done);
    expect(after.glued, 'glue was lost').toEqual(before.glued);
    expect(after.wired, 'wiring was lost').toBe(before.wired);
    expect(after.unboxed, 'the box was shut again').toBe(before.unboxed);
    expect(after.notStanding, 'pieces counted as placed but not standing in the model').toEqual([]);
  });

  test('the finale plays and can always be skipped', async ({ page }) => {
    // the film is driven by the clock and the DOM, so it runs without drawing a frame
    test.setTimeout(150_000);
    await openKit(page);
    await openBoxAndLayOut(page);
    await buildWholeKit(page);

    await page.evaluate(() => { window.__mew.UI.enterShowcase({ reveal: true }); });
    await page.waitForTimeout(3000);

    const playing = await page.evaluate(() => {
      const el = document.getElementById('cine-skip');
      const r = el && el.getBoundingClientRect();
      const hit = r && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        running: !!window.__mew.CINE.busy,
        filmClass: /cine-(reveal|film)/.test(document.body.className),
        skipShown: el ? getComputedStyle(el).visibility === 'visible' : false,
        // the canvas sits under this button; if it ever swallows the click the player is stuck
        skipReachable: !!(hit && (hit === el || el.contains(hit))),
      };
    });

    expect(playing.running, 'the finale never started').toBe(true);
    expect(playing.filmClass, 'the film styling never applied').toBe(true);
    expect(playing.skipShown, 'no way out of the film was shown').toBe(true);
    expect(playing.skipReachable, 'the skip button is behind the canvas').toBe(true);

    // click the control itself: Playwright's actionability check races the film's
    // own phase changes, and reachability is already asserted above by hit test
    await page.evaluate(() => { document.getElementById('cine-skip').click(); });
    await page.waitForTimeout(3000);

    const after = await page.evaluate(() => ({
      running: !!window.__mew.CINE.busy,
      show: window.__mew.BS.show,
    }));
    expect(after.running, 'skipping did not end the film').toBe(false);
    expect(after.show, 'skipping should still leave the kit finished').toBe(true);
  });
});
