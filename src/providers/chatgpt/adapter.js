const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { createPaths } = require("../../core/paths");
const { createBrowser, assertPrivatePath } = require("./browser");
const { selectors, patterns } = require("./selectors");
const { normalizeApiConversation, mergeConversations, isCompleteConversationRecord } = require("./normalize");

function isListUrl(value) {
  const url = new URL(value);
  return url.origin === "https://chatgpt.com" && url.pathname === "/backend-api/conversations";
}

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
    this.sessionRevision = 0;
    this.lastFingerprint = null;
    this.discoveryFailure = null;
    this.validListResponses = 0;
    this.listRequests = new Set();
  }

  async open() {
    if (this.page) return this.page;
    this.page = await this.browser.launch({ headless: this.headless });
    this.responseListener = (response) => {
      const pending = this.captureResponse(response).catch(() => {
        this.failure = new Error("Unable to validate native response; stopped");
      }).finally(() => this.pending.delete(pending));
      this.pending.add(pending);
    };
    this.page.on("response", this.responseListener);
    this.requestListener = (request) => { if (isListUrl(request.url())) this.listRequests.add(request); };
    this.requestFinishedListener = (request) => this.listRequests.delete(request);
    this.requestFailedListener = (request) => {
      if (isListUrl(request.url())) this.discoveryFailure = new Error("Discovery list request failed; inventory unchanged");
      this.listRequests.delete(request);
    };
    this.page.on("request", this.requestListener);
    this.page.on("requestfinished", this.requestFinishedListener);
    this.page.on("requestfailed", this.requestFailedListener);
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
    if (list) {
      if (response.status() !== 200) {
        this.discoveryFailure = new Error("Discovery list response has an unexpected HTTP status; inventory unchanged");
        return;
      }
      try {
        const data = await response.json();
        if (!data || !Array.isArray(data.items)) throw new Error("Unsupported list schema");
        const items = data.items.map(normalizeApiConversation);
        if (items.some((item) => !item)) throw new Error("Invalid list item");
        this.items = mergeConversations([...this.items, ...items]);
        this.validListResponses++;
      } catch {
        this.discoveryFailure = new Error("Discovery list response is malformed or unsupported; inventory unchanged");
      }
      return;
    }
    if (session) {
      const revision = ++this.sessionRevision;
      this.fingerprint = null;
      this.authRequired = true;
      if (response.status() !== 200) return;
      let data;
      try { data = await response.json(); } catch { return; }
      if (revision !== this.sessionRevision) return;
      if (typeof data?.user?.id !== "string" || !data.user.id.trim()) return;
      const digest = createHash("sha256").update(data.user.id).digest("hex").slice(0, 16);
      if (this.lastFingerprint && this.lastFingerprint !== digest) this.failure = new Error("Account mismatch; stopped");
      this.lastFingerprint = digest;
      this.fingerprint = digest;
      this.authRequired = false;
    }
  }

  async checkResponses({ allowLoginRequired = false } = {}) {
    while (this.pending.size) await Promise.all([...this.pending]);
    if (this.failure) throw this.failure;
    if (this.authRequired && !allowLoginRequired) throw new Error("Login required in the dedicated profile");
  }

  async checkDiscoveryResponses() {
    await this.checkResponses();
    if (this.discoveryFailure) throw this.discoveryFailure;
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
    for (let i = 0; i < 300; i++) {
      if (!(await this.loginState()).loggedIn) throw new Error("Login required in the dedicated profile; stopped");
      await this.checkDiscoveryResponses();
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
          await this.checkDiscoveryResponses();
          const after = await this.page.evaluate((selector) => document.querySelector(selector)?.scrollHeight, selectors.historyNavigation);
          if (after === metrics.scrollH && before === this.items.length) break;
          stale = 0;
        }
      } else stale = 0;
      await this.page.mouse.wheel(0, 500);
      await this.page.waitForTimeout(700);
      if (i === 299) throw new Error("Discovery scroll limit reached; inventory unchanged");
    }
    for (let i = 0; this.listRequests.size && i < 30; i++) {
      await this.page.waitForTimeout(500);
      await this.checkDiscoveryResponses();
    }
    if (this.listRequests.size) throw new Error("Discovery list request did not finish; inventory unchanged");
    await this.checkDiscoveryResponses();
    if (!this.validListResponses) throw new Error("Discovery received no validated native list response; inventory unchanged");
    if (!(await this.loginState()).loggedIn) throw new Error("Login required in the dedicated profile; stopped");
    await this.checkDiscoveryResponses();
    const records = this.items.slice(0, max);
    this.writeJson(path.join(this.paths.raw, "conversations.json"), records);
    return records;
  }

  async listProjects() {
    await this.open();
    const observe = async () => {
      await this.getAccountFingerprint();
      if (!(await this.loginState()).loggedIn) throw new Error("Login required in the dedicated profile; stopped");
      const snapshot = await this.page.evaluate(({ selectors, noProjects, moreProjects }) => {
        const visible = (node) => node.getClientRects().length > 0
          && !["hidden", "collapse"].includes(getComputedStyle(node).visibility) && getComputedStyle(node).opacity !== "0";
        const regions = [...document.querySelectorAll(selectors.projectsRegion)].filter(visible);
        if (regions.length !== 1) return null;
        const region = regions[0];
        const uncertain = region.getAttribute("aria-expanded") === "false" || region.getAttribute("aria-busy") === "true"
          || [...region.querySelectorAll(selectors.projectUncertainState)].some(visible)
          || [...region.querySelectorAll(selectors.projectControls)].filter(visible).some((node) => new RegExp(moreProjects, "i").test((node.innerText || "").trim()));
        return {
          url: location.href,
          uncertain,
          expanded: region.getAttribute("aria-expanded") === "true",
          emptyState: [...region.querySelectorAll(selectors.projectStatus)].filter(visible).some((node) => new RegExp(noProjects, "i").test((node.innerText || "").trim())),
          entries: [...region.querySelectorAll(selectors.projectLinks)].filter(visible).map((node) => ({ name: node.innerText, url: node.href })),
        };
      }, { selectors, noProjects: patterns.noProjects.source, moreProjects: patterns.moreProjects.source });
      await this.checkResponses();
      if (!(await this.loginState()).loggedIn) throw new Error("Login required in the dedicated profile; stopped");
      if (!snapshot || snapshot.uncertain || new URL(snapshot.url).origin !== "https://chatgpt.com") {
        throw new Error("Project region is missing, ambiguous, collapsed, or uncertain; inventory unchanged");
      }
      if ((!snapshot.entries.length && !snapshot.expanded && !snapshot.emptyState) || (snapshot.entries.length && snapshot.emptyState)) {
        throw new Error("Project empty state is uncertain; inventory unchanged");
      }
      const names = new Map();
      const urls = new Map();
      for (const entry of snapshot.entries) {
        const name = typeof entry.name === "string" ? entry.name.normalize("NFC").trim() : "";
        let url;
        try { url = new URL(entry.url); } catch { throw new Error("Unsupported Project URL; inventory unchanged"); }
        if (!name || url.origin !== "https://chatgpt.com" || !patterns.projectPath.test(url.pathname)) {
          throw new Error("Project name or URL is empty or unsupported; inventory unchanged");
        }
        const canonicalUrl = `${url.origin}${url.pathname}`;
        if ((names.has(name) && names.get(name) !== canonicalUrl) || (urls.has(canonicalUrl) && urls.get(canonicalUrl) !== name)) {
          throw new Error("Ambiguous Project names or URLs; inventory unchanged");
        }
        names.set(name, canonicalUrl);
        urls.set(canonicalUrl, name);
      }
      return [...names].map(([name, url]) => ({ name, url }));
    };
    const first = await observe();
    await this.page.waitForTimeout(500);
    const second = await observe();
    if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error("Project inventory changed between observations; stopped");
    await this.checkResponses();
    return second;
  }

  async readConversation(id) {
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid conversation ID");
    await this.open();
    await this.getAccountFingerprint();
    const target = path.join(this.paths.raw, "conversations", `${id}.json`);
    const existing = this.readConversationCheckpoint(id);
    if (isCompleteConversationRecord(existing, id)) return existing;
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
      url: location.href,
      title: document.title.replace(/\s*[-|]\s*ChatGPT.*$/i, "").trim(),
      messages: [...document.querySelectorAll(selectors.messageRoles)].map((node) => {
        const content = node.querySelector(selectors.markdown) || node;
        return { role: node.getAttribute("data-message-author-role"), text: (content.innerText || content.textContent || "").trim().slice(0, 20000) };
      }),
    }), { selectors });
    await this.checkResponses();
    const record = { provider: "chatgpt", conversationId: id, title: data.title, url: data.url, extractedAt: new Date().toISOString(), messages: data.messages };
    if (!isCompleteConversationRecord(record, id) || !isCompleteConversationRecord({ ...record, url: this.page.url() }, id)) {
      throw new Error("Incomplete conversation snapshot or changed navigation; checkpoint unchanged");
    }
    this.writeJson(target, record);
    return record;
  }

  readConversationCheckpoint(id) {
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid conversation ID");
    try { return this.readJson(path.join(this.paths.raw, "conversations", `${id}.json`)); }
    catch (error) { if (error instanceof SyntaxError) return null; throw error; }
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
    if (this.page) {
      this.page.off("request", this.requestListener);
      this.page.off("requestfinished", this.requestFinishedListener);
      this.page.off("requestfailed", this.requestFailedListener);
    }
    try { await this.browser.close(); await Promise.all([...this.pending]); }
    finally {
      this.page = null; this.fingerprint = null; this.failure = null; this.authRequired = false; this.items = [];
      this.discoveryFailure = null; this.validListResponses = 0; this.listRequests.clear(); this.lastFingerprint = null;
    }
  }
}

module.exports = { ChatGPTAdapter };
