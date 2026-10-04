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
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    headless: true,
    viewport: { width: 1280, height: 800 },
    launchOptions: { args: process.env.MEW_GPU === '1' ? [] : SOFTWARE_GL },
    trace: 'retain-on-failure',
  },
});
