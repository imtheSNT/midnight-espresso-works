// @ts-check
const { test, expect } = require('@playwright/test');
const {
  PHONE_LANDSCAPE, openKit, openBoxAndLayOut, pieceScreenPos, nextPieceId,
  emptyStagePoint, suspendToolWheel, advance, buildWholeKit, sceneCost,
  enterShowcase, visiblePartIds, reopenKit, dragPieceHome, swirlScrew,
  toGlueStep, seamStroke, pressAndHold, penPointer,
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

  /* The box card used to carry a hand-typed piece count. It said 311 while the
     kit held 322 — the number had been left behind by eleven pieces added
     after someone last edited that string. It is computed from STEPS now, and
     this test is what stops it being hand-typed again. */
  test('the box advertises the kit it actually contains', async ({ page }) => {
    await openKit(page);
    const { advertised, actual } = await page.evaluate(() => {
      /* The box intro is skipped under automation unless asked for; call it so
         the card is built by the same code a player's first launch runs. */
      window.__mew.boxIntro();
      const text = document.querySelector('.box-meta').textContent;
      const [, pieces, steps] = text.match(/(\d+)\s+pieces\s+·\s+(\d+)\s+steps/);
      const S = window.__mew.STEPS;
      return {
        advertised: { pieces: +pieces, steps: +steps },
        actual: { pieces: S.reduce((n, st) => n + st.parts.length, 0), steps: S.length },
      };
    });
    expect(advertised).toEqual(actual);
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
 * The wiring board — its lead total was typed in four places, two of
 * them the comparisons that decide when the step may be closed.
 * ------------------------------------------------------------------ */
test.describe('the wiring board', () => {
  test('counts the leads it actually has, and stays shut until they are in', async ({ page }) => {
    await openKit(page);
    await openBoxAndLayOut(page);

    const board = await page.evaluate(() => {
      const m = window.__mew;
      const tick = (n) => { for (let i = 0; i < n; i++) m.tick(1 / 60); };
      /* Build forward until the wiring step's parts are all seated — that is
         what makes the board open. Stop there, and leave it unwired. */
      for (let s = 0; s < m.STEPS.length; s++) {
        let id;
        while ((id = m.strictNext())) { m.finishInstant(id); tick(2); }
        if (m.STEPS[m.BS.step].wire) break;
        if (m.BS.step < m.STEPS.length - 1) { m.Build.nextStep(); tick(2); }
      }
      m.Wire.open();
      const shown = document.getElementById('wire-count').textContent.match(/of (\d+) leads/);
      return {
        opened: m.Wire.isOpen,
        shownTotal: shown ? +shown[1] : null,
        realTotal: Object.keys(m.WL.pins).length,
        connected: m.Wire.conns.size,
        doneDisabled: document.getElementById('wire-done').disabled,
      };
    });

    expect(board.opened, 'the wiring board never opened').toBe(true);
    expect(board.connected, 'expected a fresh board with nothing wired').toBe(0);
    expect(board.shownTotal, 'the board advertises a lead count it does not have').toBe(board.realTotal);
    expect(board.doneDisabled, 'a fresh board can be closed with no leads connected').toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Camera — the thing that stopped Marcus's aunt cold on an iPad.
 * ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ *
 * Taps on the controls layered over the stage. The stage itself sets
 * touch-action:none because the canvas handles every gesture; a button
 * inheriting that is a misconfiguration, and the decor panel and booklet
 * already opt out of it. The tool rail did not.
 * ------------------------------------------------------------------ */
test.describe('controls over the stage', () => {
  test('are tappable, while the canvas still owns its gestures', async ({ page }) => {
    await openKit(page, { viewport: { width: 1024, height: 768 } });
    await openBoxAndLayOut(page);

    const ta = await page.evaluate(() => {
      const get = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).touchAction : null; };
      return { stage: get('#stage'), tool: get('#tools .tool'), decorAlreadyOptedOut: true };
    });
    expect(ta.stage, 'the canvas must keep touch-action none or a drag scrolls the page').toBe('none');
    /* This asserts the declaration, not iOS behaviour, which cannot be exercised
       here. It keeps the rail in line with the decor panel and the booklet,
       which already declare it. */
    expect(ta.tool, 'the tool rail no longer declares a tappable touch-action, unlike the other in-stage controls').toBe('manipulation');

    // and it really does still select, driven as a stylus
    const pen = await penPointer(page);
    const t = await page.evaluate(() => {
      const b = [...document.querySelectorAll('#tools .tool')].find(x => x.dataset.tool !== window.__mew.BS.tool);
      const r = b.getBoundingClientRect();
      return { tool: b.dataset.tool, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await pen.press(t.x, t.y);
    await pen.release(t.x, t.y);
    await advance(page, 0.2);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.__mew.BS.tool),
      'a pencil tap on the rail did not change the tool').toBe(t.tool);
  });
});

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

  /* Marcus's aunt, on an iPad, step 7: "the camera zooms into the side area and
     you are unable to see the parts to put down, you have to move the camera back
     each time". Picking a module piece re-framed its bench on every pick, because
     once she had moved away, every pick counted as "far" from the bench view and
     re-triggered the move. */
  test('a view the player set is not taken back by the next piece', async ({ page }) => {
    await openKit(page);
    await openBoxAndLayOut(page);

    const r = await page.evaluate(() => {
      const m = window.__mew;
      const tick = (n) => { for (let i = 0; i < n; i++) m.tick(1 / 60); };
      const brew = m.STEPS.findIndex(s => s.title && /brew/i.test(s.title));
      for (let s = 0; s < brew; s++) {
        let id;
        while ((id = m.strictNext())) { m.finishInstant(id); tick(2); }
        if (m.STEPS[m.BS.step].wire && !m.BS.wired) m.Wire.finish(true);
        m.Build.nextStep(); tick(2);
      }
      const parts = m.STEPS[m.BS.step].parts;
      const snap = () => ({ theta: m.view.theta, target: m.view.target.toArray() });
      const dist = (p, q) => Math.abs(p.theta - q.theta) + Math.hypot(...p.target.map((v, i) => v - q.target[i]));

      /* First pick: the game frames the bench. That is wanted — she is not
         complaining about the first one. */
      m.BS.pick = parts[0];
      const a0 = snap(); m.benchFocus(); tick(90);
      const a1 = snap();

      /* She then drags the view somewhere she can see the loose parts. */
      m.ctrl.userAt = performance.now();
      m.view.theta += 1.0; m.view.target.x += 4;
      const a2 = snap();

      /* Next piece. This is the one that used to snatch the view back. */
      m.BS.pick = parts[1];
      m.benchFocus(); tick(90);
      const a3 = snap();

      return { step: m.BS.step, title: m.STEPS[m.BS.step].title,
               framedFirst: dist(a0, a1), heldAfter: dist(a2, a3) };
    });

    expect(r.title, 'did not reach the brew step').toMatch(/brew/i);
    expect(r.framedFirst, 'the first pick no longer frames the bench at all').toBeGreaterThan(0.05);
    expect(r.heldAfter, 'picking the next piece took back the view the player set').toBeLessThan(0.01);
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
/* ------------------------------------------------------------------ *
 * The tool wheel on a stylus. Marcus's aunt, iPad + Apple Pencil:
 * "radial menu should be able to stay open and be tapped to select".
 * ------------------------------------------------------------------ */
test.describe('the tool wheel on a pencil', () => {
  test('opens near an edge without choosing anything, and waits to be tapped', async ({ page }) => {
    await openKit(page, { viewport: PHONE_LANDSCAPE });
    await openBoxAndLayOut(page);
    const pen = await penPointer(page);

    /* Press high on the stage, where the drawn wheel has to be pushed down to
       fit. That gap between the press and the drawn centre is what used to be
       read as a chosen tool. */
    const r = await page.evaluate(() => {
      const b = document.querySelector('canvas').getBoundingClientRect();
      return { left: b.left, top: b.top, w: b.width };
    });
    const px = r.left + r.w / 2, py = r.top + 34;

    const before = await page.evaluate(() => window.__mew.BS.tool);
    await pen.press(px, py);
    await page.waitForTimeout(640);
    /* Nudge the tip a few pixels now that the wheel is up. This is inside the
       34px dead zone around the press, so nothing should light up -- but the
       wheel is drawn well away from the finger here, and measuring against the
       drawn centre instead of the press turns this nudge into a chosen tool.
       Sent after the wheel is open, so it cannot race the long-press timer. */
    await pen.move(px + 6, py + 4);
    await page.waitForTimeout(40);

    const held = await page.evaluate(() => ({
      open: window.__mew.Wheel.open, hot: window.__mew.Wheel.hot,
      offset: Math.round(Math.hypot(window.__mew.Wheel.cx - window.__mew.Wheel.px,
                                    window.__mew.Wheel.cy - window.__mew.Wheel.py)),
    }));
    expect(held.open, 'a pencil hold did not open the wheel').toBe(true);
    expect(held.offset, 'this press was not near enough an edge to displace the wheel').toBeGreaterThan(20);
    expect(held.hot, 'the wheel pre-selected a tool the player never pointed at').toBe(null);

    await pen.release(px + 9, py + 3);
    await advance(page, 0.3);
    const after = await page.evaluate(() => ({ open: window.__mew.Wheel.open, tool: window.__mew.BS.tool }));
    expect(after.open, 'the wheel closed instead of staying open to be tapped').toBe(true);
    expect(after.tool, 'letting go picked a tool the player never chose').toBe(before);

    // and now a tap on one of its buttons does choose
    const btn = await page.evaluate(() => {
      const bs = [...document.querySelectorAll('#wheel .wheel-btn')];
      const b = bs.find(x => x.dataset.tool !== window.__mew.BS.tool);
      const q = b.getBoundingClientRect();
      return { tool: b.dataset.tool, x: q.left + q.width / 2, y: q.top + q.height / 2 };
    });
    await page.waitForTimeout(260);        // let the wheel finish opening
    await pen.press(btn.x, btn.y);
    await pen.release(btn.x, btn.y);
    await advance(page, 0.3);
    const picked = await page.evaluate(() => ({ open: window.__mew.Wheel.open, tool: window.__mew.BS.tool }));
    expect(picked.tool, 'tapping a tool on the open wheel did not select it').toBe(btn.tool);
    expect(picked.open, 'the wheel stayed open after a tool was tapped').toBe(false);
  });

  /* "radial menu still just shows screw instead of screwdriver." The wheel
     builds its buttons by copying each tool's icon out of the rail, so the two
     can only disagree if that copying breaks — which is worth pinning, since a
     silent divergence means fixing an icon in one place and not the other.
     The wheel is opened directly rather than by a gesture: the icons have
     nothing to do with how it was summoned, and driving it by pointer made this
     flake on whether the press found clear desk. */
  test('every tool on the wheel wears the same icon as the rail', async ({ page }) => {
    await openKit(page, { viewport: PHONE_LANDSCAPE });
    await openBoxAndLayOut(page);

    const icons = await page.evaluate(() => {
      window.__mew.Wheel.show(200, 150);
      const out = { open: window.__mew.Wheel.open, mismatched: [], checked: 0 };
      for (const w of document.querySelectorAll('#wheel .wheel-btn')) {
        const t = w.dataset.tool;
        const rail = document.querySelector(`#tools .tool[data-tool="${t}"] svg`);
        const ws = w.querySelector('svg');
        out.checked++;
        if (!rail || !ws || rail.innerHTML !== ws.innerHTML) out.mismatched.push(t);
      }
      window.__mew.Wheel.close();
      return out;
    });

    expect(icons.open, 'the wheel did not open').toBe(true);
    expect(icons.checked, 'the wheel had no buttons to check').toBeGreaterThan(0);
    expect(icons.mismatched, 'these tools show a different icon on the wheel than on the rail').toEqual([]);
  });

  /* The hold tolerance is asserted directly rather than by holding a stylus
     still for 430ms and seeing what happens: CDP's input latency here is larger
     than that window, so a drift-based test passes or fails by machine load.
     What matters is the rule — a stylus and a fingertip are allowed more drift
     than a mouse, which rests exactly where it was put. */
  test('a stylus is allowed more drift during the hold than a mouse', async ({ page }) => {
    await openKit(page);
    const slop = await page.evaluate(() => {
      const m = window.__mew, was = m.ctrl.type, out = {};
      for (const t of ['mouse', 'pen', 'touch']) { m.ctrl.type = t; out[t] = m.wheelSlop(); }
      m.ctrl.type = was;
      return out;
    });
    expect(slop.pen, 'a pencil gets no more drift allowance than a mouse').toBeGreaterThan(slop.mouse);
    expect(slop.touch, 'a fingertip gets no more drift allowance than a mouse').toBeGreaterThan(slop.mouse);
  });
});

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

  test('the door is in plain sight, not behind a tab', async ({ page }) => {
    await openKit(page);
    await openBoxAndLayOut(page);
    await buildWholeKit(page);
    await enterShowcase(page);
    await page.evaluate(() => { window.__mew.sheetShow(true); });
    await advance(page, 1.0);

    const door = await page.evaluate(() => {
      const el = document.querySelector('[data-act="room"]');
      if (!el) return { exists: false };
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const pane = el.closest('.tab-pane');
      return {
        exists: true,
        activeTab: (document.querySelector('.show-in') || {}).dataset
          ? document.querySelector('.show-in').dataset.tab : null,
        buriedInPane: pane ? pane.dataset.pane : null,
        width: Math.round(r.width), height: Math.round(r.height),
        shown: cs.display !== 'none' && cs.visibility === 'visible',
        reachable: !!(hit && (hit === el || el.contains(hit))),
      };
    });

    expect(door.exists, 'no way into the café at all').toBe(true);
    // it used to sit in the café pane, so it was 0x0 whenever another tab was open
    expect(door.buriedInPane, 'the café door is hidden inside a tab again').toBeNull();
    expect(door.width, 'the café door has no width').toBeGreaterThan(80);
    expect(door.height, 'the café door has no height').toBeGreaterThan(20);
    expect(door.shown, 'the café door is not displayed').toBe(true);
    expect(door.reachable, 'something is sitting on top of the café door').toBe(true);

    // and it works from whichever tab the showcase opens on
    const opened = await page.evaluate(() => {
      const m = window.__mew;
      document.querySelector('[data-act="room"]').click();
      for (let i = 0; i < 180; i++) m.tick(1 / 60);
      return m.ROOM.on;
    });
    expect(opened, 'pressing the café door did not open the room').toBe(true);
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
/* ------------------------------------------------------------------ *
 * Step 7's framing, the other half of Marcus's aunt's note: "the camera
 * zooms into the side area and you are unable to see the parts to put
 * down". The bench sits at z=2, the parts area starts at z=27, and the
 * bench shot was fitted to the sub-assembly alone.
 * ------------------------------------------------------------------ */
test.describe('working at the bench', () => {
  for (const vp of [
    { name: 'iPad', width: 1024, height: 768 },
    { name: 'phone held sideways', width: 844, height: 390 },
  ]) {
    test(`the bench shot shows the parts as well as the bench — ${vp.name}`, async ({ page }) => {
      await openKit(page, { viewport: { width: vp.width, height: vp.height } });
      await openBoxAndLayOut(page);

      const r = await page.evaluate(() => {
        const m = window.__mew;
        const tick = (n) => { for (let i = 0; i < n; i++) m.tick(1 / 60); };
        const brew = m.STEPS.findIndex(s => /brew/i.test(s.title || ''));
        for (let s = 0; s < brew; s++) {
          let id;
          while ((id = m.strictNext())) { m.finishInstant(id); tick(2); }
          if (m.STEPS[m.BS.step].wire && !m.BS.wired) m.Wire.finish(true);
          m.Build.nextStep(); tick(2);
        }
        tick(60);
        m.BS.pick = m.STEPS[m.BS.step].parts[0];
        m.benchFocus(); tick(120);

        const proj = (v) => { const q = v.clone().project(m.camera);
          return { x: Math.round((q.x * 0.5 + 0.5) * m.stageW), y: Math.round((-q.y * 0.5 + 0.5) * m.stageH) }; };
        const inView = (p) => p.x >= 0 && p.x <= m.stageW && p.y >= 0 && p.y <= m.stageH;
        const loose = m.TABLE.shown.map(id => ({ id, at: proj(m.TABLE.clones[id].position) }));
        const ghost = proj(m.RT[m.BS.pick].ghost.position);
        return { title: m.STEPS[m.BS.step].title, stage: [m.stageW, m.stageH],
                 ghost, ghostIn: inView(ghost),
                 offScreen: loose.filter(l => !inView(l.at)), looseCount: loose.length };
      });

      expect(r.title, 'did not reach the brew step').toMatch(/brew/i);
      expect(r.looseCount, 'no loose pieces were on the table to check').toBeGreaterThan(0);
      expect(r.ghostIn, `where the piece goes is off screen at ${r.ghost.x},${r.ghost.y}`).toBe(true);
      expect(r.offScreen,
        `pieces to pick up are off screen on a ${r.stage[0]}x${r.stage[1]} stage: ` +
        r.offScreen.map(l => `${l.id} at ${l.at.x},${l.at.y}`).join('; ')).toEqual([]);
    });
  }
});

/* ------------------------------------------------------------------ *
 * Squaring up to a piece. Marcus asked for better angles while you are
 * placing something. Deriving the angle is the easy half -- look down
 * the direction the piece's own vertices vary least along -- and these
 * cover the half that is not: whether the shot that comes out of it has
 * the piece in it, at a size you can judge, from a camera that is not
 * under the desk. Three earlier attempts got the angle right and the
 * shot wrong, so that is what is pinned here.
 * ------------------------------------------------------------------ */
test.describe('squaring up to a piece', () => {
  /** How far the camera is off a piece's own axis, in degrees. */
  const offSquare = (page, id) => page.evaluate((pid) => {
    const m = window.__mew, T = window.THREE;
    const rt = m.RT[pid], g = rt.ghost && rt.ghost.parent ? rt.ghost : rt.g;
    const cam = new T.Vector3().copy(m.camera.position).sub(m.view.target).normalize();
    const axis = new T.Vector3();
    const ratio = m.viewAxis(g, cam, axis);
    return { deg: Math.acos(Math.min(1, Math.abs(axis.dot(cam)))) * 180 / Math.PI,
             ratio: isFinite(ratio) ? ratio : 999, face: ratio >= m.SQ_DECISIVE };
  }, id);

  /** Point the camera edge-on to a piece, the state this feature exists to fix. */
  const standEdgeOn = (page, id) => page.evaluate((pid) => {
    const m = window.__mew, T = window.THREE;
    const rt = m.RT[pid], g = rt.ghost && rt.ghost.parent ? rt.ghost : rt.g;
    const axis = new T.Vector3();
    m.viewAxis(g, null, axis);
    /* any direction perpendicular to the axis is edge-on; take the horizontal one */
    const perp = Math.abs(axis.y) > 0.9 ? new T.Vector3(0, 0, 1)
      : new T.Vector3(-axis.z, 0, axis.x).normalize();
    m.goView({ target: m.view.target.toArray(), theta: Math.atan2(perp.x, perp.z),
               phi: Math.abs(axis.y) > 0.9 ? 1.2 : 1.45, fit: m.view.fit }, 0.01);
    for (let i = 0; i < 40; i++) m.tick(1 / 60);
  }, id);

  test('turns the view to face a piece that has a face', async ({ page }) => {
    await openKit(page);
    await openBoxAndLayOut(page);

    /* the back plinth wall: a panel, 5.8 times flatter along its normal than
       along anything else, so it plainly has a face to square up to */
    const piece = 'p02';
    expect((await offSquare(page, piece)).face, 'picked a piece with no face to square to').toBe(true);

    await standEdgeOn(page, piece);
    const before = await offSquare(page, piece);
    expect(before.deg, 'the camera was meant to start edge-on').toBeGreaterThan(70);

    await page.evaluate((id) => {
      const m = window.__mew;
      m.goView(m.squareView(m.RT[id], true), 0.4);
      for (let i = 0; i < 60; i++) m.tick(1 / 60);
    }, piece);

    const after = await offSquare(page, piece);
    expect(after.deg, `still ${after.deg.toFixed(0)} degrees off the face after squaring up`).toBeLessThan(35);
  });

  test('frames a round piece without spinning the camera', async ({ page }) => {
    await openKit(page);
    await openBoxAndLayOut(page);

    /* a foot: a turned stub with no face, so there is nothing to square to and
       turning the camera would be motion for its own sake */
    const piece = 'p01f1';
    expect((await offSquare(page, piece)).face, 'picked a piece that does have a face').toBe(false);

    const r = await page.evaluate((id) => {
      const m = window.__mew;
      const was = { theta: m.view.theta, phi: m.view.phi, fit: m.view.fit };
      const asked = m.squareView(m.RT[id], true);
      const unasked = m.squareView(m.RT[id], false);
      /* the middle of the piece's geometry, not the ghost group's origin --
         a ghost group sits at its layer's origin, which for a foot is a dozen
         units from the foot */
      const bx = new THREE.Box3(), bb = new THREE.Box3(), c = new THREE.Vector3();
      m.RT[id].ghost.updateMatrixWorld(true);
      m.RT[id].ghost.traverse(o => { if (!o.isMesh) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        bb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); bx.union(bb); });
      bx.getCenter(c);
      return { was, asked, unasked, ghost: [c.x, c.y, c.z] };
    }, piece);

    expect(r.unasked, 'a round piece pulled the camera round on its own').toBeNull();
    expect(r.asked, 'asking to square up to a round piece did nothing at all').not.toBeNull();
    expect(r.asked.theta, 'the camera swung round for a piece with no face').toBeCloseTo(r.was.theta, 5);
    expect(r.asked.phi, 'the camera tilted for a piece with no face').toBeCloseTo(r.was.phi, 5);
    expect(r.asked.fit, 'asking should still bring the piece closer').toBeLessThan(r.was.fit);
    expect(Math.hypot(r.asked.target[0] - r.ghost[0], r.asked.target[2] - r.ghost[2]),
      'the shot is not centred on the piece').toBeLessThan(2.5);
  });

  test('stays put when the piece already reads well', async ({ page }) => {
    await openKit(page);
    await openBoxAndLayOut(page);
    const piece = 'p02';

    const r = await page.evaluate((id) => {
      const m = window.__mew;
      m.goView(m.squareView(m.RT[id], true), 0.01);
      for (let i = 0; i < 40; i++) m.tick(1 / 60);
      const squareNow = m.squareView(m.RT[id], false);
      /* and now a middling angle, well short of edge-on */
      m.goView({ target: m.view.target.toArray(), theta: m.view.theta + 0.8,
                 phi: m.view.phi, fit: m.view.fit }, 0.01);
      for (let i = 0; i < 40; i++) m.tick(1 / 60);
      const middling = m.squareView(m.RT[id], false);
      return { squareNow, middling };
    }, piece);

    expect(r.squareNow, 'reframed a piece the camera was already square to').toBeNull();
    expect(r.middling, 'reframed a piece that was only 45 degrees off').toBeNull();
  });

  test('holding the recentre button squares up; a tap still recentres', async ({ page }) => {
    await openKit(page);
    await openBoxAndLayOut(page);

    const btn = page.locator('#turn [data-turn="0"]');
    const box = await btn.boundingBox();
    expect(box, 'the recentre button is not on screen').toBeTruthy();
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    const piece = await page.evaluate(() => window.__mew.squareTarget() && window.__mew.squareTarget().def.id);
    expect(piece, 'nothing for a square-up to be about').toBeTruthy();

    const before = await page.evaluate(() => ({ theta: window.__mew.view.theta, phi: window.__mew.view.phi, fit: window.__mew.view.fit }));

    /* Wait for the hold to fire rather than for a stopwatch. A fixed 600ms
       against a 320ms timer looks like plenty of margin and is not: under
       software rendering the gap between two of these calls has been seen to
       swallow the whole window, which turns the tap below into a second hold
       and the test into a coin toss. */
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.waitForFunction(() => !!window.__mew.tween, null, { timeout: 10_000 });
    await page.mouse.up();
    await advance(page, 1.5);

    const held = await page.evaluate(() => ({ theta: window.__mew.view.theta, phi: window.__mew.view.phi, fit: window.__mew.view.fit }));
    expect(held.fit, 'holding the button did not bring the piece closer').toBeLessThan(before.fit - 0.5);
    const squared = await offSquare(page, piece);
    expect(squared.deg, `${squared.deg.toFixed(0)} degrees off the piece after a hold`).toBeLessThan(35);

    // a tap still does what it always did: no pause at all, so the hold cannot fire
    await page.mouse.down();
    await page.mouse.up();
    await advance(page, 1.5);

    const tapped = await page.evaluate(() => ({ view: { theta: window.__mew.view.theta, phi: window.__mew.view.phi, fit: window.__mew.view.fit }, step: window.__mew.stepView() }));
    expect(tapped.view.fit, 'a tap no longer returns to the step view').toBeCloseTo(tapped.step.fit, 1);
  });

  test('picking up an edge-on piece turns the view; picking up a readable one does not', async ({ page }) => {
    await openKit(page);
    await openBoxAndLayOut(page);
    const piece = 'p02';

    const r = await page.evaluate((id) => {
      const m = window.__mew, T = window.THREE;
      const rt = m.RT[id], g = rt.ghost && rt.ghost.parent ? rt.ghost : rt.g;
      const axis = new T.Vector3();
      m.viewAxis(g, null, axis);
      const settle = () => { for (let i = 0; i < 60; i++) m.tick(1 / 60); };
      const stand = (dir) => { m.goView({ target: m.view.target.toArray(), theta: Math.atan2(dir.x, dir.z),
        phi: 1.3, fit: m.view.fit }, 0.01); settle(); m.ctrl.userAt = 0; };

      /* edge-on: looking along the face rather than at it */
      stand(new T.Vector3(-axis.z, 0, axis.x).normalize());
      const was = { theta: m.view.theta, phi: m.view.phi };
      m.focusPart(rt); settle();
      const turned = Math.abs(m.view.theta - was.theta) + Math.abs(m.view.phi - was.phi);

      /* square on: already a good look at it */
      m.goView(m.squareView(rt, true), 0.01); settle(); m.ctrl.userAt = 0;
      const was2 = { theta: m.view.theta, phi: m.view.phi };
      m.focusPart(rt); settle();
      const turned2 = Math.abs(m.view.theta - was2.theta) + Math.abs(m.view.phi - was2.phi);
      return { turned, turned2 };
    }, piece);

    expect(r.turned, 'picking up an edge-on piece left the camera edge-on').toBeGreaterThan(0.3);
    expect(r.turned2, 'picking up a piece already in plain view moved the camera anyway').toBeLessThan(0.02);
  });

  test('squares up to the piece in your hand, not the one the manual suggests', async ({ page }) => {
    await openKit(page);
    await openBoxAndLayOut(page);

    const r = await page.evaluate(() => {
      const m = window.__mew, T = window.THREE;
      m.Build.setMode('free');                         // so more than one piece is pickable
      const settle = () => { for (let i = 0; i < 60; i++) m.tick(1 / 60); };
      const suggested = m.suggestedPart();
      const inHand = m.RT['p02'];                      // a wall: faces along Z
      const want = m.squareView(inHand, true);

      /* stand edge-on to the wall, and leave BS.pick pointing nowhere, which is
         the state focusPart is called in as a piece leaves the table */
      m.goView({ target: m.view.target.toArray(), theta: want.theta + Math.PI / 2,
                 phi: 1.4, fit: m.view.fit }, 0.01);
      settle(); m.ctrl.userAt = 0; m.BS.pick = null;

      m.focusPart(inHand); settle();
      const cam = new T.Vector3().copy(m.camera.position).sub(m.view.target).normalize();
      const axis = new T.Vector3();
      m.viewAxis(inHand.ghost, cam, axis);
      return { deg: Math.acos(Math.min(1, Math.abs(axis.dot(cam)))) * 180 / Math.PI,
               suggested: suggested && suggested.def.id };
    });

    expect(r.suggested, 'the manual suggests the same piece, so this proves nothing')
      .not.toBe('p02');
    expect(r.deg, `${r.deg.toFixed(0)} degrees off the piece that was picked up`).toBeLessThan(35);
  });

  test('reads the same axis twice, and a world one for a kit modelled square', async ({ page }) => {
    await openKit(page);
    await openBoxAndLayOut(page);

    const r = await page.evaluate(() => {
      const m = window.__mew, T = window.THREE;
      const read = () => Object.keys(m.RT).map(id => {
        const rt = m.RT[id], g = rt.ghost && rt.ghost.parent ? rt.ghost : rt.g, n = new T.Vector3();
        return m.viewAxis(g, null, n) ? [n.x.toFixed(3), n.y.toFixed(3), n.z.toFixed(3)].join() : null;
      });
      const a = read(), b = read();
      const axisLike = a.filter(v => v && v.split(',').filter(c => Math.abs(+c) > 0.9).length === 1).length;
      return { same: a.join('|') === b.join('|'), axisLike, total: a.length, missing: a.filter(v => !v).length };
    });

    expect(r.missing, 'pieces with no axis at all').toBe(0);
    expect(r.same, 'the same piece answered differently on two reads').toBe(true);
    /* the kit is modelled square to the desk, so an answer that is mostly
       45-degree diagonals means ties are being settled by list order */
    expect(r.axisLike / r.total, `only ${r.axisLike} of ${r.total} pieces resolved to a world axis`)
      .toBeGreaterThan(0.9);
  });

  test('the step card gets out of the way of the shot', async ({ page }) => {
    await openKit(page);
    await openBoxAndLayOut(page);

    /* the coach card is positioned dead centre of the stage, which is exactly
       where a square-up puts the piece */
    await page.evaluate(() => { window.__mew.coachShow(); });
    await page.waitForTimeout(120);
    expect(await page.locator('#coach').isVisible(), 'the card never came up, so this proves nothing').toBe(true);

    await page.keyboard.press('f');
    await page.waitForTimeout(500);
    expect(await page.locator('#coach').isVisible(), 'the card is still sitting over the piece').toBe(false);
  });

  test('never ends up under the desk, overhead, or too close to see anything', async ({ page }) => {
    test.setTimeout(150_000);
    await openKit(page);
    await openBoxAndLayOut(page);

    const bad = await page.evaluate(() => {
      const m = window.__mew, out = [];
      for (let st = 0; st < m.STEPS.length; st++) {
        m.BS.step = st;
        const sf = m.stepView().fit, floor = sf * m.SQUARE_ROOM;
        for (const id of m.STEPS[st].parts) {
          const rt = m.RT[id]; if (!rt) continue;
          const v = m.squareView(rt, true);
          if (!v) { out.push({ id, why: 'asked for a square-up and got nothing' }); continue; }
          if (v.phi < m.SQUARE_PHI[0] - 1e-6 || v.phi > m.SQUARE_PHI[1] + 1e-6) out.push({ id, why: 'phi ' + v.phi.toFixed(2) });
          if (v.fit < Math.max(3.6, floor) - 1e-6) out.push({ id, why: 'fit ' + v.fit.toFixed(1) + ' inside the floor ' + floor.toFixed(1) });
          /* the whole promise is a closer look than the step's own view */
          if (v.fit > sf * 0.8) out.push({ id, why: 'fit ' + v.fit.toFixed(1) + ' barely closer than the step view ' + sf.toFixed(1) });
          if (!isFinite(v.target[0] + v.target[1] + v.target[2])) out.push({ id, why: 'target is not a point' });
        }
      }
      return out;
    });

    expect(bad, 'square-up shots outside their own bounds: ' +
      bad.slice(0, 8).map(b => b.id + ' — ' + b.why).join('; ')).toEqual([]);
  });

  /* No size floor here, and that is deliberate. A screw cannot be both large
     on screen and shown in the thing it screws into, and it is the second that
     tells you where it goes -- the smallest pieces come out at a couple of
     percent of the stage and that is the right answer. What a framing shot does
     owe you is that the piece is all there and in the middle of it. */
  test('puts the piece on screen, whole, and in the middle of the shot', async ({ page }) => {
    test.setTimeout(150_000);
    await openKit(page);
    await openBoxAndLayOut(page);

    const r = await page.evaluate(() => {
      const m = window.__mew, T = window.THREE, out = [];
      for (const id of m.STEPS[0].parts.concat(m.STEPS[1].parts)) {
        const rt = m.RT[id]; if (!rt) continue;
        const v = m.squareView(rt, true); if (!v) continue;
        m.goView(v, 0.01);
        for (let i = 0; i < 40; i++) m.tick(1 / 60);
        const g = rt.ghost && rt.ghost.parent ? rt.ghost : rt.g;
        g.updateMatrixWorld(true);
        const xs = [], ys = [];
        let on = 0, n = 0;
        g.traverse(o => {
          if (!o.isMesh || o.isInstancedMesh) return;
          const p = o.geometry.attributes.position; if (!p) return;
          const stride = Math.max(1, Math.ceil(p.count / 40));
          for (let i = 0; i < p.count; i += stride) {
            const q = new T.Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).project(m.camera);
            n++; xs.push(q.x); ys.push(q.y);
            if (Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1 && q.z < 1) on++;
          }
        });
        if (!n) continue;
        out.push({ id, on: on / n,
          cx: (Math.max(...xs) + Math.min(...xs)) / 2, cy: (Math.max(...ys) + Math.min(...ys)) / 2 });
      }
      return out;
    });

    expect(r.length, 'no pieces were measured').toBeGreaterThan(10);
    const cropped = r.filter(x => x.on < 1);
    expect(cropped, 'pieces hanging off the edge of a shot meant to frame them: ' +
      cropped.map(x => `${x.id} ${(x.on * 100).toFixed(0)}% on screen`).join('; ')).toEqual([]);
    /* in NDC, so 0.25 is an eighth of the way to the edge. The projection is
       already nudged sideways to clear the tool rail, hence not zero. */
    const adrift = r.filter(x => Math.abs(x.cx) > 0.25 || Math.abs(x.cy) > 0.25);
    expect(adrift, 'pieces sitting off to one side of their own shot: ' +
      adrift.map(x => `${x.id} at ${x.cx.toFixed(2)},${x.cy.toFixed(2)}`).join('; ')).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Window glass. Marcus's aunt asked for a way to tint it. Every pane in
 * the kit shares one material, so it is a single choice, the way a real
 * kit ships one colour of acrylic in the box.
 * ------------------------------------------------------------------ */
test.describe('tinting the window glass', () => {
  /** The live material behind the panes, read off a real pane piece. */
  const readGlass = (page) => page.evaluate(() => {
    const m = window.__mew;
    const paneIds = Object.keys(m.RT).filter(id => /pane/i.test(m.RT[id].def.name || ''));
    for (const id of paneIds) {
      let found = null;
      m.RT[id].g.traverse(o => { if (!found && o.isMesh && o.material && o.material.transparent && o.material.opacity < 0.6) found = o.material; });
      if (found) return { panes: paneIds.length, color: '#' + found.color.getHexString(), opacity: +found.opacity.toFixed(3) };
    }
    return null;
  });

  test('a tint reaches every pane, and clear comes back', async ({ page }) => {
    await openKit(page);
    await openBoxAndLayOut(page);

    const start = await readGlass(page);
    expect(start, 'found no translucent pane to read').toBeTruthy();
    expect(start.panes, 'expected the kit to have several panes sharing the glass').toBeGreaterThan(1);
    expect(await page.evaluate(() => window.__mew.BS.glass || 0), 'a fresh kit should start clear').toBe(0);

    const tinted = await page.evaluate(async () => {
      const m = window.__mew;
      m.Build.setGlass(2);
      return { glass: m.BS.glass, name: m.GLASS_TINTS[2][0] };
    });
    const after = await readGlass(page);
    expect(tinted.glass, 'the tint was not recorded').toBe(2);
    expect(after.color, 'the panes kept the clear colour after a tint was chosen').not.toBe(start.color);
    expect(after.opacity, 'a tint should carry its own body').not.toBe(start.opacity);

    await page.evaluate(() => window.__mew.Build.setGlass(0));
    const back = await readGlass(page);
    expect(back.color, 'clear did not restore the original glass').toBe(start.color);
    expect(back.opacity, 'clear did not restore the original opacity').toBe(start.opacity);
  });

  test('the chosen tint survives closing the app', async ({ page }) => {
    await openKit(page);
    await openBoxAndLayOut(page);
    await page.evaluate(() => window.__mew.Build.setGlass(3));
    const chosen = await readGlass(page);

    await reopenKit(page);
    const after = await page.evaluate(() => window.__mew.BS.glass);
    const mat = await readGlass(page);
    expect(after, 'the glass tint was forgotten when the kit was reopened').toBe(3);
    expect(mat.color, 'the tint was remembered but not applied to the panes on load').toBe(chosen.color);
  });

  test('every tint has a swatch to pick it', async ({ page }) => {
    await openKit(page);
    await openBoxAndLayOut(page);
    const n = await page.evaluate(() => {
      const m = window.__mew;
      // build the panel markup directly: it only renders once decor exists
      const html = m.UI.decorHTML(true);
      const d = document.createElement('div'); d.innerHTML = html;
      return { swatches: d.querySelectorAll('[data-glass]').length, tints: m.GLASS_TINTS.length,
               named: !!d.querySelector('[data-cname="glass"]') };
    });
    expect(n.swatches, 'the glass row does not offer one swatch per tint').toBe(n.tints);
    expect(n.named, 'the chosen tint is not named anywhere in the panel').toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Furnishing order. Marcus's aunt: "furnish part rug should go down
 * before table".
 * ------------------------------------------------------------------ */
test.describe('furnishing the café', () => {
  test('the rug goes down before anything that stands on it', async ({ page }) => {
    await openKit(page);
    await openBoxAndLayOut(page);

    const order = await page.evaluate(() => {
      const m = window.__mew;
      const step = m.STEPS.findIndex(s => /furnish/i.test(s.title || ''));
      const parts = m.STEPS[step].parts;
      const at = (id) => parts.indexOf(id);
      return {
        step,
        rug: at('c15'),
        onTheRug: {                    // everything sharing the rug's corner
          'dining chair': at('c01'),
          'dining chair, second': at('c01b'),
          'dining table': at('c05'),
          'booth bench': at('c03'),
        },
        rugName: m.RT['c15'].def.name,
      };
    });

    expect(order.rugName, 'c15 is no longer the rug — ids shifted').toBe('Rug');
    expect(order.rug, 'the rug is not in the furnish step').toBeGreaterThanOrEqual(0);
    for (const [what, i] of Object.entries(order.onTheRug)) {
      expect(i, `${what} is missing from the furnish step`).toBeGreaterThanOrEqual(0);
      expect(order.rug, `the ${what} goes down before the rug, so the rug slides under it`).toBeLessThan(i);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Marcus: "the ending video still freezes when the machine cuts on and
 * it's not smooth, but once it pans out it's very smooth." three.js
 * counts only visible lights, so switching six point lights on changed
 * the program every material needed and the renderer compiled a new set
 * inside one frame.
 * ------------------------------------------------------------------ */
test.describe('powering the machine up', () => {
  test('does not recompile the scene, so the finale does not stall', async ({ page }) => {
    test.setTimeout(300_000);
    await openKit(page, { viewport: { width: 900, height: 620 }, render: true });
    await openBoxAndLayOut(page);
    await buildWholeKit(page);
    await advance(page, 0.5);
    await page.waitForTimeout(800);

    const r = await page.evaluate(async () => {
      const m = window.__mew, ren = m.renderer;
      const frame = () => new Promise(res => requestAnimationFrame(() => {
        m.tick(1 / 60); ren.render(m.scene, m.camera); res();
      }));
      for (let i = 0; i < 6; i++) await frame();   // settle, and let boot-time compiling finish

      const before = {
        programs: ren.info.programs.length,
        litLeds: m.LIGHTS3D.leds.filter(l => l.visible).length,
        maxIntensity: Math.max(...m.LIGHTS3D.leds.map(l => l.intensity)),
      };

      m.SIM.powered = true; m.SIM.powerAt = m.SIM.time;
      for (let i = 0; i < 8; i++) await frame();
      const after = { programs: ren.info.programs.length };
      return { before, after };
    });

    /* The lights live in the scene whether lit or not: that is what keeps the
       program set stable. If they are hidden while off, this is 0 and the
       compile is merely deferred to the worst possible moment. */
    expect(r.before.litLeds, 'the LED lights leave the scene when off, so the shaders recompile when they return').toBeGreaterThan(0);
    expect(r.before.maxIntensity, 'an unpowered kit is lighting its LEDs').toBe(0);
    /* Not zero: a stray shader or two can first render at power-up without
       anyone noticing. The bug was 46 compiled inside one frame, which cost
       2065ms. A handful is noise; a jump of that size is the freeze returning.
       Run on its own this reads 0; in the full suite it has read 1. */
    expect(r.after.programs - r.before.programs,
      'powering up compiled a batch of new shaders, which is the stall Marcus saw')
      .toBeLessThanOrEqual(4);
  });
});

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

/* ------------------------------------------------------------------ *
 * The tools — what ten hours of play actually consists of. Every other
 * test here places pieces with finishInstant, which skips glue and
 * screws entirely, so none of this was covered.
 *
 * The screw is the signature mechanic: about a second and a half of
 * steady swirling seats it, and swirling much faster strips it and
 * sends it back to the start. Both halves are tested, because a strip
 * rule that never fires is the same as no strip rule.
 * ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ *
 * A hand holding a stylus rests on the glass, and iPadOS reports that
 * as an ordinary touch. Marcus's aunt, step 9: "when you attempt to grab
 * the foot plate it won't let you ... the apple pencil is grabbing onto
 * the wrong piece, even when you're grabbing the correct piece."
 * ------------------------------------------------------------------ */
test.describe('a palm on the glass', () => {
  test.use({ hasTouch: true });

  const toElevator = (page) => page.evaluate(() => {
    const m = window.__mew;
    const tick = (n) => { for (let i = 0; i < n; i++) m.tick(1 / 60); };
    for (let s = 0; s < 8; s++) {
      let id;
      while ((id = m.strictNext())) { m.finishInstant(id); tick(2); }
      if (m.STEPS[m.BS.step].wire && !m.BS.wired) m.Wire.finish(true);
      m.Build.nextStep(); tick(2);
    }
    tick(90);
    return { step: m.BS.step, title: m.STEPS[m.BS.step].title, want: m.strictNext() };
  });

  test('does not steal the piece the pencil is reaching for', async ({ page }) => {
    test.setTimeout(200_000);
    await openKit(page, { viewport: { width: 1024, height: 768 } });
    await openBoxAndLayOut(page);
    const at = await toElevator(page);
    expect(at.title, 'did not reach the bucket elevator step').toMatch(/elevator/i);
    expect(at.want, 'the foot plate is not the piece the manual wants here').toBe('e01');

    const spot = await page.evaluate(() => {
      const m = window.__mew, T = window.THREE;
      const r = document.querySelector('canvas').getBoundingClientRect();
      const c = new T.Box3().setFromObject(m.TABLE.clones[m.strictNext()]).getCenter(new T.Vector3());
      const p = c.clone().project(m.camera);
      return { x: Math.round(r.left + (p.x * 0.5 + 0.5) * r.width), y: Math.round(r.top + (-p.y * 0.5 + 0.5) * r.height),
               palmX: Math.round(r.left + r.width * 0.72), palmY: Math.round(r.top + r.height * 0.82) };
    });

    const cdp = await page.context().newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const pen = (type, x, y) => cdp.send('Input.dispatchMouseEvent', {
      type, x, y, button: type === 'mouseMoved' ? 'none' : 'left',
      buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'pen', force: 0.5 });

    // one clean grab first, which is also what tells the kit a stylus is in use
    await pen('mousePressed', spot.x, spot.y);
    await pen('mouseMoved', spot.x + 3, spot.y - 3);
    const clean = await page.evaluate(() => { const d = window.__mew.BS.drag; return d && d.id; });
    await pen('mouseReleased', spot.x + 3, spot.y - 3);
    await advance(page, 0.4);
    expect(clean, 'the pencil could not pick the foot plate up even on its own').toBe('e01');

    await page.evaluate(() => { const m = window.__mew; m.BS.pick = null; m.BS.drag = null; });
    const before = await page.evaluate(() => ({ theta: window.__mew.view.theta, target: window.__mew.view.target.toArray() }));

    // now the heel of her hand lands first, as it does when you hold a pencil
    await touch('touchStart', [{ x: spot.palmX, y: spot.palmY, id: 7, radiusX: 28, radiusY: 24 }]);
    await page.waitForTimeout(60);
    const afterPalm = await page.evaluate(() => ({
      pointers: window.__mew.ctrl.pointers.size, mode: window.__mew.ctrl.mode,
      theta: window.__mew.view.theta, target: window.__mew.view.target.toArray(),
    }));
    expect(afterPalm.pointers, 'the palm was taken as a real pointer').toBe(0);
    expect(Math.abs(afterPalm.theta - before.theta), 'the palm turned the view').toBeLessThan(0.001);

    await pen('mousePressed', spot.x, spot.y);
    await pen('mouseMoved', spot.x + 3, spot.y - 3);
    const held = await page.evaluate(() => { const m = window.__mew; const d = m.BS.drag; return { id: d && d.id, mode: m.ctrl.mode }; });
    await pen('mouseReleased', spot.x + 3, spot.y - 3);
    await touch('touchEnd', []);

    expect(held.mode, 'the palm and the pencil together put the view into a pinch').not.toBe('pinch');
    expect(held.id, 'with a palm down the pencil grabbed a different piece').toBe('e01');
  });

  test('two fingers still pinch when no stylus is involved', async ({ page }) => {
    test.setTimeout(200_000);
    await openKit(page, { viewport: { width: 1024, height: 768 } });
    await openBoxAndLayOut(page);

    const cdp = await page.context().newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const r = await page.evaluate(() => {
      const b = document.querySelector('canvas').getBoundingClientRect();
      return { cx: b.left + b.width / 2, cy: b.top + b.height / 2 };
    });

    await touch('touchStart', [{ x: r.cx - 60, y: r.cy, id: 1 }, { x: r.cx + 60, y: r.cy, id: 2 }]);
    await page.waitForTimeout(30);
    const mode = await page.evaluate(() => ({ mode: window.__mew.ctrl.mode, pointers: window.__mew.ctrl.pointers.size }));
    await touch('touchEnd', []);

    expect(mode.pointers, 'two fingers were not both seen').toBe(2);
    expect(mode.mode, 'palm rejection broke ordinary two-finger pinch').toBe('pinch');
  });
});

test.describe('the tools', () => {
  /** Finish step 0 and move to the first step whose pieces are screwed down. */
  const toScrewStep = async (page) => page.evaluate(() => {
    const m = window.__mew;
    const tick = (n) => { for (let i = 0; i < n; i++) m.tick(1 / 60); };
    let id;
    while ((id = m.strictNext())) { m.finishInstant(id); tick(3); }
    m.Build.nextStep(); tick(20);
    const next = m.strictNext();
    return { step: m.BS.step, title: m.STEPS[m.BS.step].title, piece: next,
             action: next ? m.RT[next].def.action : null };
  });

  test('a piece dropped on its outline seats, and its screws come up', async ({ page }) => {
    test.setTimeout(150_000);
    await openKit(page);
    await openBoxAndLayOut(page);

    const at = await toScrewStep(page);
    expect(at.action, `expected a screwed piece on step "${at.title}"`).toBe('screw');

    const landed = await dragPieceHome(page, at.piece);
    expect(landed, 'never found the spot the game calls hot').toBe(true);

    const seated = await page.evaluate((id) => ({
      state: window.__mew.RT[id].state,
      handles: document.querySelectorAll('#handles .screw').length,
      screws: window.__mew.RT[id].screws.length,
    }), at.piece);

    expect(seated.state, 'the piece did not seat on its outline').toBe('screws');
    expect(seated.handles, 'no screw handles came up').toBeGreaterThan(0);
    expect(seated.handles, 'a handle per screw').toBe(seated.screws);
  });

  test('steady swirling drives a screw home', async ({ page }) => {
    test.setTimeout(150_000);
    await openKit(page);
    await openBoxAndLayOut(page);
    const at = await toScrewStep(page);
    expect(await dragPieceHome(page, at.piece)).toBe(true);

    const before = await page.evaluate(() =>
      document.querySelectorAll('#handles .screw').length);

    // ~1.6 turns at a human pace: 50ms between moves
    const out = await swirlScrew(page, { turns: 1.6, msPerStep: 50 });
    expect(out.error).toBeUndefined();

    expect(out.seated, 'steady swirling did not seat the screw').toBe(true);
    expect(out.stripped, 'a steady pace should never strip').toBe(false);
    expect(out.progress, 'the screw should read fully driven').toBe(1);
    expect(out.handlesLeft, 'the handle should go once the screw is home')
      .toBe(before - 1);
  });

  /* Marcus's aunt: "the screwdriver is doing the screw for you, and sometimes
     the screwdriver model doesn't show up". Those were one bug. In guided mode
     -- the default -- a tap sets the screw driving itself, and turnScrew only
     drew the tool on the hand-driven path, so the screw turned with nothing
     visible holding it. */
  test('the screwdriver is on screen even when the game is driving it', async ({ page }) => {
    test.setTimeout(150_000);
    await openKit(page);
    await openBoxAndLayOut(page);
    const at = await toScrewStep(page);
    expect(await dragPieceHome(page, at.piece)).toBe(true);
    await page.evaluate(() => window.__mew.Build.setTool('screw', true));
    await advance(page, 0.2);

    const start = await page.evaluate(() => ({
      guided: window.__mew.BS.diff === 'guided',
      driverExists: !!window.__mew.TOOLVIS.driver,
      visible: !!(window.__mew.TOOLVIS.driver && window.__mew.TOOLVIS.driver.visible),
    }));
    expect(start.guided, 'this test is about guided mode, which is the default').toBe(true);
    expect(start.driverExists, 'no screwdriver model was built at all').toBe(true);
    expect(start.visible, 'the screwdriver is showing before anything was touched').toBe(false);

    const h = await page.evaluate(() => {
      const el = document.querySelector('#handles .screw');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    expect(h, 'no screw handle to tap').toBeTruthy();

    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.waitForTimeout(60);
    await page.mouse.up();

    let sawDriver = false;
    for (let i = 0; i < 25 && !sawDriver; i++) {
      await advance(page, 0.05);
      sawDriver = await page.evaluate(() =>
        !!(window.__mew.TOOLVIS.driver && window.__mew.TOOLVIS.driver.visible));
    }
    const end = await page.evaluate(() => {
      const rt = Object.values(window.__mew.RT).find(r => r.screws && r.screws.length);
      return { prog: rt.screws[0].prog, auto: !!rt.screws[0].auto };
    });

    expect(end.prog, 'the tap did not start the screw moving at all').toBeGreaterThan(0);
    expect(sawDriver, 'the screw turned with no screwdriver anywhere on screen').toBe(true);
  });

  /* Having tapped once, she should be able to change her mind and drive it
     herself rather than watch. */
  test('starting to swirl takes the screw back off the game', async ({ page }) => {
    test.setTimeout(150_000);
    await openKit(page);
    await openBoxAndLayOut(page);
    const at = await toScrewStep(page);
    expect(await dragPieceHome(page, at.piece)).toBe(true);
    await page.evaluate(() => window.__mew.Build.setTool('screw', true));
    await advance(page, 0.2);

    // hand it to the game the way a tap does, and let it get going
    const handed = await page.evaluate(() => {
      const rt = Object.values(window.__mew.RT).find(r => r.screws && r.screws.some(x => x.el));
      const s = rt.screws.find(x => x.el);
      s.auto = true;
      return { auto: s.auto, prog: s.prog };
    });
    expect(handed.auto, 'could not hand the screw to the game').toBe(true);
    await advance(page, 0.25);

    const out = await swirlScrew(page, { turns: 0.35, msPerStep: 55 });
    expect(out.error).toBeUndefined();

    const after = await page.evaluate(() => {
      const rt = Object.values(window.__mew.RT).find(r => r.screws && r.screws.length);
      const s = rt.screws[0];
      return { auto: !!s.auto, prog: +(s.prog || 0).toFixed(3) };
    });
    expect(after.prog, 'the swirl did not move the screw').toBeGreaterThan(0);
    expect(after.auto, 'the game kept driving the screw after she took hold of it').toBe(false);
  });

  test('swirling far too fast strips it back to the start', async ({ page }) => {
    test.setTimeout(150_000);
    await openKit(page);
    await openBoxAndLayOut(page);
    const at = await toScrewStep(page);
    expect(await dragPieceHome(page, at.piece)).toBe(true);

    // six turns with no pause at all — far beyond any hand
    const out = await swirlScrew(page, { turns: 6, msPerStep: 0 });
    expect(out.error).toBeUndefined();

    expect(out.stripped, 'a frantic swirl should have stripped the screw').toBe(true);
    expect(out.seated, 'a stripped screw must not count as driven').toBe(false);
    expect(out.progress, 'a stripped screw goes back to the start').toBe(0);
    expect(out.handlesLeft, 'the handle stays so it can be driven again')
      .toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ *
 * Glue — the other half of the tools. A seam only counts as glued when
 * every point on it you can see has been brushed, end to end, so the
 * positive case traces the whole run and the negative case proves a
 * stroke somewhere else does nothing.
 * ------------------------------------------------------------------ */
test.describe('the glue brush', () => {
  test('a stroke along the seam glues the piece', async ({ page }) => {
    test.setTimeout(150_000);
    await openKit(page);
    await openBoxAndLayOut(page);

    const piece = await toGlueStep(page);
    expect(piece, 'no piece in the manual wanted glue').toBeTruthy();

    const stroke = await seamStroke(page, piece);
    expect(stroke.visible, 'the seam has no points on screen').toBeGreaterThan(0);
    expect(stroke.points, 'nowhere on the seam could start a stroke').not.toBeNull();

    await page.mouse.move(stroke.points[0].x, stroke.points[0].y);
    await page.mouse.down();

    const engaged = await page.evaluate(() => ({
      mode: window.__mew.ctrl.mode, grabbedAPiece: !!window.__mew.BS.drag,
    }));
    expect(engaged.grabbedAPiece, 'the stroke picked up a piece instead of gluing').toBe(false);
    expect(engaged.mode, 'the glue brush did not take the stroke').toBe('brush');

    for (const q of stroke.points) await page.mouse.move(q.x, q.y);
    await page.mouse.move(stroke.points[0].x, stroke.points[0].y);   // close the run
    await page.mouse.up();

    const after = await page.evaluate((id) => {
      const m = window.__mew, rt = m.RT[id];
      return {
        glued: m.BS.glued.has(id),
        seams: rt.seams.map(sm => sm.done),
        brushed: rt.seams[0].pts.filter(q => q.on).length,
        total: rt.seams[0].pts.length,
      };
    }, piece);

    expect(after.brushed, 'the whole seam should be covered').toBe(after.total);
    expect(after.seams.every(Boolean), 'every seam should read done').toBe(true);
    expect(after.glued, 'the piece never counted as glued').toBe(true);
  });

  test('the brush beats a loose piece lying on the seam', async ({ page }) => {
    test.setTimeout(150_000);
    await openKit(page);
    await openBoxAndLayOut(page);

    const piece = await toGlueStep(page);

    /* Loose pieces sit right on top of this seam — on the veneer fascia, 81 of its
       82 on-screen points have one over them. The canvas used to hand the press to
       the piece, so with the brush in hand you picked up a part instead of gluing. */
    const covered = await page.evaluate((id) => {
      const m = window.__mew;
      m.Build.updateOverlays();
      const r = m.renderer.domElement.getBoundingClientRect();
      const picks = m.TABLE.shown
        .map(i => m.TABLE.clones[i] && m.TABLE.clones[i].userData.pick).filter(Boolean);
      const rc = new THREE.Raycaster(), v = new THREE.Vector2();
      const under = (q) => {
        v.set((q.x / r.width) * 2 - 1, -(q.y / r.height) * 2 + 1);
        rc.setFromCamera(v, m.camera);
        return rc.intersectObjects(picks, true).length > 0;
      };
      const visible = m.RT[id].seams[0].pts.filter(q => !q.behind);
      const blocked = visible.filter(under);
      return {
        visible: visible.length,
        blocked: blocked.length,
        at: blocked[0] ? { x: r.left + blocked[0].x, y: r.top + blocked[0].y } : null,
      };
    }, piece);

    test.skip(!covered.at, 'nothing is lying over this seam, so there is nothing to beat');

    await page.mouse.move(covered.at.x, covered.at.y);
    await page.mouse.down();
    const got = await page.evaluate(() => ({
      mode: window.__mew.ctrl.mode,
      grabbedAPiece: !!window.__mew.BS.drag,
    }));
    await page.mouse.up();

    expect(got.grabbedAPiece, 'the press picked up a loose piece instead of gluing').toBe(false);
    expect(got.mode, 'the glue brush should take a press aimed at its seam').toBe('brush');
  });

  test('a stroke away from the seam glues nothing', async ({ page }) => {
    test.setTimeout(150_000);
    await openKit(page);
    await openBoxAndLayOut(page);

    const piece = await toGlueStep(page);
    const before = await page.evaluate((id) => ({
      glued: window.__mew.BS.glued.has(id),
      brushed: window.__mew.RT[id].seams[0].pts.filter(q => q.on).length,
    }), piece);

    // a corner of the stage, well clear of anything that wants glue
    const box = page.viewportSize();
    await page.mouse.move(40, box.height - 60);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) await page.mouse.move(40 + i * 7, box.height - 60 - i * 2);
    await page.mouse.up();

    const after = await page.evaluate((id) => ({
      glued: window.__mew.BS.glued.has(id),
      brushed: window.__mew.RT[id].seams[0].pts.filter(q => q.on).length,
    }), piece);

    expect(after.glued, 'brushing empty desk glued the piece').toBe(before.glued);
    expect(after.brushed, 'brushing empty desk covered part of the seam').toBe(before.brushed);
  });
});

/* ------------------------------------------------------------------ *
 * The press — 98 of the 322 pieces are seated this way, which makes it
 * the most-used action in the kit and the one most worth protecting.
 * The ring fills in about 0.45s of simulated time and drains back over
 * 0.3s, so holding long enough clicks the piece down and letting go early
 * does not. Note the frame loop clamps dt to 50ms, so on a slow device the
 * press takes longer in real time than 0.45s.
 * ------------------------------------------------------------------ */
test.describe('the press', () => {
  const seatFirstPiece = async (page) => {
    const piece = await nextPieceId(page);
    expect(piece, 'the manual should want a first piece').toBeTruthy();
    const action = await page.evaluate((id) => window.__mew.RT[id].def.action, piece);
    expect(action, 'the first piece should be a pressed one').toBe('press');

    expect(await dragPieceHome(page, piece), 'the piece never landed on its outline').toBe(true);

    const raised = await page.evaluate((id) => ({
      state: window.__mew.RT[id].state,
      rings: document.querySelectorAll('#handles .hold').length,
    }), piece);
    expect(raised.state, 'the piece should be waiting to be pressed').toBe('press');
    expect(raised.rings, 'no press ring came up').toBe(1);
    return piece;
  };

  test('holding the ring clicks the piece down', async ({ page }) => {
    test.setTimeout(150_000);
    await openKit(page);
    await openBoxAndLayOut(page);
    const piece = await seatFirstPiece(page);

    const out = await pressAndHold(page, { untilFilled: true });
    expect(out.error).toBeUndefined();
    expect(out.timedOut, 'the ring never filled').toBe(false);
    expect(out.id, 'pressed the wrong piece').toBe(piece);
    expect(out.seated, 'a long hold did not seat the piece').toBe(true);
    expect(out.state, 'the piece should be done once pressed').toBe('done');
    expect(out.ringsLeft, 'the ring should go once the piece is down').toBe(0);
  });

  test('letting go early lets it spring back', async ({ page }) => {
    test.setTimeout(150_000);
    await openKit(page);
    await openBoxAndLayOut(page);
    const piece = await seatFirstPiece(page);

    // let go a third of the way up, however long that takes on this machine
    const out = await pressAndHold(page, { releaseAt: 0.25 });
    expect(out.error).toBeUndefined();
    expect(out.peak, 'the ring should have started filling').toBeGreaterThan(0.1);
    expect(out.peak, 'released too late to be a short press').toBeLessThan(0.95);
    expect(out.after, 'the ring should drain back after letting go').toBe(0);
    expect(out.seated, 'letting go early should not seat the piece').toBe(false);
    expect(out.state, 'the piece should still be waiting to be pressed').toBe('press');
    expect(out.ringsLeft, 'the ring should stay so it can be pressed again').toBe(1);
  });
});
