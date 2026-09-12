const fs = require("node:fs");
const path = require("node:path");
const { createPaths, assertInsideLocal } = require("../../core/paths");

function assertPrivatePath(paths, target) {
  if (paths.local !== path.join(paths.root, ".local")) throw new Error("Invalid .local directory");
  assertInsideLocal(paths, target);
  for (let current = path.resolve(target); current !== paths.root; current = path.dirname(current)) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Private paths must not use symlinks");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

function createBrowser(paths = createPaths(), options = {}) {
  if (paths.profile !== path.join(paths.local, "profile")) throw new Error("Browser requires the dedicated .local/profile");
  assertPrivatePath(paths, paths.profile);
  let context = null;
  let page = null;
  return {
    async launch({ headless = false } = {}) {
      if (context) return page;
      assertPrivatePath(paths, paths.profile);
      fs.mkdirSync(paths.profile, { recursive: true, mode: 0o700 });
      const { chromium } = require("playwright");
      context = await chromium.launchPersistentContext(paths.profile, {
        executablePath: options.chromeExecutable || process.env.ORGANIZER_CHROME_EXECUTABLE
          || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        headless,
        viewport: null,
        args: ["--profile-directory=Default", "--disable-blink-features=AutomationControlled"],
      });
      page = context.pages()[0] || await context.newPage();
      return page;
    },
    async goto(url, options = {}) {
      if (!page) throw new Error("Browser not launched");
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000, ...options });
      return page;
    },
    async getPage() {
      if (!page) throw new Error("Browser not launched");
      return page;
    },
    async close() {
      try { if (context) await context.close(); }
      finally { context = null; page = null; }
    },
  };
}

module.exports = { createBrowser, assertPrivatePath };
