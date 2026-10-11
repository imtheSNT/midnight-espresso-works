// @ts-check
const { defineConfig } = require('@playwright/test');

/* The kit is one self-contained file, so the tests open it over file:// — no server to start.
   Software rendering keeps results identical on every machine and in CI; set MEW_GPU=1 to use
   the real graphics card instead, which is faster but machine-dependent. */
const SOFTWARE_GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

module.exports = defineConfig({
  testDir: './tests',
  // a 322-piece scene takes a few seconds to build under software rendering
  timeout: 90_000,
  expect: { timeout: 15_000 },
  /* true only so that --shard splits by test. With fullyParallel false a FILE
     is the unit of sharding, and this suite is one file, so three shards came
     out 69/0/0 and two CI machines ran nothing. workers: 1 is what actually
     keeps the tests serial, and it stays: software rendering saturates the
     cores, and two Chromiums doing it at once make every timing figure in the
     README a guess. Checked: the listed order is identical either way, and the
     three shards are an exact cover of the 69. */
  fullyParallel: true,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  /* blob in CI, not html: a per-shard HTML report is a third of the results and
     no use to anyone. The report job merges the three blobs into the one HTML
     report that gets attached. */
  reporter: process.env.CI ? [['list'], ['blob']] : [['list']],
  use: {
    headless: true,
    viewport: { width: 1280, height: 800 },
    launchOptions: { args: process.env.MEW_GPU === '1' ? [] : SOFTWARE_GL },
    trace: 'retain-on-failure',
  },
});
