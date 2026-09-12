const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { createPaths } = require("../../core/paths");
const { createBrowser, assertPrivatePath } = require("./browser");
const { selectors, patterns } = require("./selectors");
const { normalizeApiConversation, mergeConversations } = require("./normalize");

class ChatGPTAdapter {
  constructor({ paths = createPaths(), browser, chromeExecutable, headless = false } = {}) {
    this.paths = paths;
    for (const name of ["raw", "state"]) assertPrivatePath(paths, paths[name]);
    this.browser = browser || createBrowser(paths, { chromeExecutable });
    this.headless = headless;
    this.page = null;
    this.pending = new Set();
    this.items = [];
    this.fingerprint = null;
    this.failure = null;
    this.authRequired = false;
  }

  async open() {
    if (this.page) return this.page;
    this.page = await this.browser.launch({ headless: this.headless });
    this.responseListener = (response) => {
      const pending = this.captureResponse(response).catch(() => {}).finally(() => this.pending.delete(pending));
      this.pending.add(pending);
    };
    this.page.on("response", this.responseListener);
    await this.browser.goto("https://chatgpt.com/");
    return this.page;
  }

  async captureResponse(response) {
    const url = new URL(response.url());
    if (url.origin !== "https://chatgpt.com") return;
    const session = url.pathname === "/api/auth/session";
    const list = url.pathname === "/backend-api/conversations";
    if (!session && !url.pathname.startsWith("/backend-api/")) return;
    if (response.status() === 429) this.failure = new Error("Rate limit detected; stopped");
    if (response.status() === 403) this.failure = new Error("Access restriction detected; stopped");
    if (response.status() === 401) this.authRequired = true;
    if (response.status() !== 200 || (!session && !list)) return;
    const data = await response.json();
    if (session && typeof data?.user?.id === "string" && data.user.id.length > 0) {
      const digest = createHash("sha256").update(data.user.id).digest("hex").slice(0, 16);
      if (this.fingerprint && this.fingerprint !== digest) this.failure = new Error("Account mismatch; stopped");
      this.fingerprint = digest;
      this.authRequired = false;
    }
    if (list && Array.isArray(data.items)) {
      this.items = mergeConversations([...this.items, ...data.items.map(normalizeApiConversation)]);
    }
  }

  async checkResponses({ allowLoginRequired = false } = {}) {
    await Promise.all([...this.pending]);
    if (this.failure) throw this.failure;
    if (this.authRequired && !allowLoginRequired) throw new Error("Login required in the dedicated profile");
  }

  async loginState() {
    await this.checkResponses({ allowLoginRequired: true });
    const state = await this.page.evaluate(({ selectors, login, rateLimit, accessRestriction }) => {
      const visible = (node) => node.getClientRects().length > 0;
      const buttons = [...document.querySelectorAll("button")].filter(visible);
      const loginRequired = buttons.some((node) => new RegExp(login, "i").test(`${node.getAttribute("aria-label") || ""} ${node.textContent || ""}`));
      const alerts = [...document.querySelectorAll(selectors.alerts)].filter(visible).map((node) => node.textContent).join(" ");
      const restricted = new RegExp(rateLimit, "i").test(alerts) || new RegExp(accessRestriction, "i").test(`${document.title} ${alerts}`);
      const loggedIn = location.origin === "https://chatgpt.com" && !loginRequired && !restricted
        && !!(document.querySelector(selectors.historyNavigation) || document.querySelector(selectors.composer));
      return { loggedIn, loginRequired, restricted };
    }, { selectors, login: patterns.login.source, rateLimit: patterns.rateLimit.source, accessRestriction: patterns.accessRestriction.source });
    if (state.restricted) throw new Error("Access restriction or rate limit detected; stopped");
    if (this.authRequired) return { ...state, loggedIn: false, loginRequired: true };
    return state;
  }

  async login({ timeoutMs = 10 * 60 * 1000 } = {}) {
    await this.open();
    const deadline = Date.now() + timeoutMs;
    do {
      const state = await this.loginState();
      if (state.loggedIn) {
        await this.page.waitForTimeout(3000);
        if ((await this.loginState()).loggedIn) return { accountFingerprint: await this.getAccountFingerprint() };
      }
      if (Date.now() >= deadline) break;
      await this.page.waitForTimeout(2000);
    } while (Date.now() < deadline);
    throw new Error("Login required: run pnpm organizer login and sign in manually in the dedicated profile");
  }

  async getAccountFingerprint() {
    await this.open();
    await this.checkResponses();
    for (let i = 0; !this.fingerprint && i < 30; i++) {
      await this.page.waitForTimeout(500);
      await this.checkResponses();
    }
    if (!this.fingerprint) throw new Error("Stable account context unavailable; login verification stopped");
    const target = path.join(this.paths.state, "account.json");
    const previous = this.readJson(target);
    if (previous && previous.accountFingerprint !== this.fingerprint) throw new Error("Account mismatch; stopped");
    this.writeJson(target, { accountFingerprint: this.fingerprint });
    return this.fingerprint;
  }

  async discoverConversations({ max = Infinity } = {}) {
    if (!(max === Infinity || Number.isInteger(max) && max > 0)) throw new Error("max must be a positive integer");
    await this.open();
    let ready = false;
    for (let i = 0; i < 30; i++) {
      await this.page.waitForTimeout(500);
      const state = await this.loginState();
      if (state.loginRequired) throw new Error("Login required in the dedicated profile; run pnpm organizer login");
      if (state.loggedIn && await this.page.locator(selectors.historyNavigation).count() > 0) { ready = true; break; }
    }
    if (!ready) throw new Error("History navigation unavailable; check login and page structure");
    await this.getAccountFingerprint();
    const nav = this.page.locator(selectors.historyNavigation).first();
    let lastCount = -1;
    let stale = 0;
    const checkpoint = async () => {
      await this.checkResponses();
      const records = this.items.slice(0, max);
      this.writeJson(path.join(this.paths.raw, "conversations.json"), records);
      return records;
    };
    for (let i = 0; i < 300; i++) {
      if (!(await this.loginState()).loggedIn) throw new Error("Login required in the dedicated profile; stopped");
      await checkpoint();
      if (this.items.length >= max) break;
      const box = await nav.boundingBox();
      if (!box) throw new Error("History navigation unavailable; stopped");
      await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      const metrics = await this.page.evaluate((selector) => {
        const nav = document.querySelector(selector);
        return nav ? { scrollTop: nav.scrollTop, scrollH: nav.scrollHeight, clientH: nav.clientHeight } : null;
      }, selectors.historyNavigation);
      if (!metrics) throw new Error("History navigation unavailable; stopped");
      if (this.items.length !== lastCount) { stale = 0; lastCount = this.items.length; }
      if (metrics.scrollH - metrics.clientH - metrics.scrollTop < 5) {
        stale++;
        if (stale >= 6) {
          const before = this.items.length;
          await this.page.mouse.wheel(0, -150);
          await this.page.waitForTimeout(600);
          await this.page.mouse.wheel(0, 150);
          await this.page.waitForTimeout(1200);
          await this.checkResponses();
          const after = await this.page.evaluate((selector) => document.querySelector(selector)?.scrollHeight, selectors.historyNavigation);
          if (after === metrics.scrollH && before === this.items.length) break;
          stale = 0;
        }
      } else stale = 0;
      await this.page.mouse.wheel(0, 500);
      await this.page.waitForTimeout(700);
      if (i === 299) throw new Error("Discovery scroll limit reached; partial checkpoint saved");
    }
    return checkpoint();
  }

  async readConversation(id) {
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid conversation ID");
    await this.open();
    await this.getAccountFingerprint();
    const target = path.join(this.paths.raw, "conversations", `${id}.json`);
    const existing = this.readJson(target);
    if (existing?.provider === "chatgpt" && existing.conversationId === id && Array.isArray(existing.messages)) return existing;
    const url = `https://chatgpt.com/c/${id}`;
    try { await this.page.evaluate((url) => { location.href = url; }, url); }
    catch (error) { if (!/execution context was destroyed|navigation/i.test(error.message)) throw error; }
    let ready = false;
    for (let i = 0; i < 40; i++) {
      await this.page.waitForTimeout(500);
      await this.checkResponses();
      let state;
      try {
        state = await this.page.evaluate(({ selector }) => ({ count: document.querySelectorAll(selector).length, url: location.href }),
          { selector: selectors.messageRoles });
      } catch { continue; }
      if (state.count > 0 && new URL(state.url).origin === "https://chatgpt.com" && new URL(state.url).pathname === `/c/${id}`) { ready = true; break; }
    }
    if (!ready) throw new Error("Conversation did not load at the requested full ID; stopped");
    await this.page.waitForTimeout(1200);
    if (!(await this.loginState()).loggedIn) throw new Error("Login required in the dedicated profile; stopped");
    const data = await this.page.evaluate(({ selectors }) => ({
      title: document.title.replace(/\s*[-|]\s*ChatGPT.*$/i, "").trim(),
      messages: [...document.querySelectorAll(selectors.messageRoles)].map((node) => {
        const content = node.querySelector(selectors.markdown) || node;
        return { role: node.getAttribute("data-message-author-role"), text: (content.innerText || content.textContent || "").trim().slice(0, 20000) };
      }),
    }), { selectors });
    await this.checkResponses();
    if (new URL(this.page.url()).pathname !== `/c/${id}`) throw new Error("Conversation navigation changed; stopped");
    const record = { provider: "chatgpt", conversationId: id, title: data.title, url, extractedAt: new Date().toISOString(), messages: data.messages };
    this.writeJson(target, record);
    return record;
  }

  readJson(target) {
    assertPrivatePath(this.paths, target);
    try { return JSON.parse(fs.readFileSync(target, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }

  writeJson(target, value) {
    assertPrivatePath(this.paths, target);
    assertPrivatePath(this.paths, `${target}.tmp`);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(`${target}.tmp`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(`${target}.tmp`, 0o600);
    fs.renameSync(`${target}.tmp`, target);
  }

  async close() {
    if (this.page && this.responseListener) this.page.off("response", this.responseListener);
    try { await this.browser.close(); await Promise.all([...this.pending]); }
    finally { this.page = null; this.fingerprint = null; this.failure = null; this.authRequired = false; this.items = []; }
  }
}

module.exports = { ChatGPTAdapter };
