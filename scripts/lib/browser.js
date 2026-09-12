// browser.js — Playwright 浏览器控制层
//
// ════════════════════════════════════════════════════════════════════════
// SAFETY CONSTRAINT (Phase 1 — READ ONLY)
// ════════════════════════════════════════════════════════════════════════
// This module launches a dedicated project profile (see CHROME_USER_DATA_DIR).
// Phase 1 permits ONLY: navigation (goto) and reading (textContent / innerHTML
// / attribute queries via locators).
//
// FORBIDDEN in Phase 1:
//   - Any click on Move / Archive / Delete / Rename controls
//   - Typing into the ChatGPT composer / sending any message
//   - Entering account/security/subscription settings
//   - Logout
//
// The exported helpers below expose ONLY read primitives. There is intentionally
// NO generic `click()` export — callers must opt into specific safe actions by
// writing them here and documenting why they are safe.
// ════════════════════════════════════════════════════════════════════════

const { chromium } = require("playwright");
const path = require("path");

// Dedicated working profile — a fresh, persistent profile owned by this project.
// WHY NOT the user's real Chrome: Chrome disables remote debugging on the DEFAULT
// data directory ("DevTools remote debugging requires a non-default data directory"),
// so Playwright cannot attach to ~/Library/Application Support/Google/Chrome.
//
// Login flow: run `node scripts/02-login.js` once. It opens this profile headful;
// the user signs into ChatGPT manually (≈1 min). The session cookies persist in
// this profile across all later runs (verified).
//
// NEVER point this at the real Chrome profile again.
const CHROME_USER_DATA_DIR = path.join(__dirname, "..", "..", "profile");
const CHROME_EXECUTABLE = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Profile name within the user-data-dir. "Default" is the main profile.
const PROFILE = "Default";

let _context = null;
let _page = null;

/**
 * Launch a persistent browser context bound to the user's Chrome profile.
 * Headful so the user can see everything the agent does.
 */
async function launch({ headless = false } = {}) {
  if (_context) return _page;

  _context = await chromium.launchPersistentContext(
    CHROME_USER_DATA_DIR,
    {
      executablePath: CHROME_EXECUTABLE,
      headless,
      viewport: null, // use real window size
      args: [
        `--profile-directory=${PROFILE}`,
        "--disable-blink-features=AutomationControlled",
      ],
    }
  );

  _page = _context.pages()[0] || (await _context.newPage());
  return _page;
}

/** Navigate to a URL (read-only action). */
async function goto(url, opts) {
  const page = await getPage();
  await page.goto(url, { waitUntil: "domcontentloaded", ...opts });
  return page;
}

/** Get the current page. */
async function getPage() {
  if (!_page) throw new Error("Browser not launched. Call launch() first.");
  return _page;
}

/** Close the browser. */
async function close() {
  if (_context) {
    await _context.close();
    _context = null;
    _page = null;
  }
}

module.exports = { launch, goto, getPage, close, CHROME_USER_DATA_DIR, PROFILE };
