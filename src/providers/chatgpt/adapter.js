const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { createPaths } = require("../../core/paths");
const { writePrivateFile } = require("../../core/private-file");
const { createBrowser, assertPrivatePath } = require("./browser");
const { selectors, patterns } = require("./selectors");
const { normalizeApiConversation, mergeConversations, isCompleteConversationRecord, detailMessages } = require("./normalize");

function isListUrl(value) {
  const url = new URL(value);
  return url.origin === "https://chatgpt.com" && url.pathname === "/backend-api/conversations";
}

function conversationResponseId(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.origin !== "https://chatgpt.com") return null;
  const match = url.pathname.match(/^\/backend-api\/conversation\/([A-Za-z0-9_-]+)$/);
  return match ? match[1] : null;
}

function writeResult(status, evidence) {
  return { status, evidence };
}

function validateConversationId(id) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid conversation ID");
  return id;
}

function validateProjectName(name) {
  if (typeof name !== "string" || !name.trim() || name !== name.normalize("NFC").trim() || /[\r\n\0]/.test(name)) {
    throw new Error("Invalid Project name");
  }
  return name;
}

function mapWriteError(error) {
  const message = String(error?.message || error);
  if (/rate limit|too many requests|请求过多|请求过于频繁/i.test(message)) {
    return writeResult("rate_limited", "Rate limit detected");
  }
  if (/login|access|account|workspace|restriction|verification|challenge/i.test(message)) {
    return writeResult("access_restricted", "Account access is not safely verifiable");
  }
  if (/selector|missing|ambiguous|project region|unsupported project/i.test(message)) {
    return writeResult("selector_missing", "Required control is missing or ambiguous");
  }
  return writeResult("uncertain", "Browser state could not be verified");
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
    this.writeFingerprint = null;
    this.writeWorkspaceDigest = null;
    this.workspaceFingerprint = null;
    this.targetConversationLoad = null;
    this.loadedConversationEvidence = null;
    this.conversationLoadRevision = 0;
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
    this.requestListener = (request) => {
      if (isListUrl(request.url())) this.listRequests.add(request);
      const conversationId = conversationResponseId(request.url());
      if (conversationId && this.targetConversationLoad?.id === conversationId) {
        this.targetConversationLoad.requests.add(request);
      }
    };
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
    const conversationId = conversationResponseId(response.url());
    if (conversationId && response.status() === 200 && this.targetConversationLoad?.id === conversationId) {
      let request;
      try { request = response.request(); } catch { request = null; }
      const load = this.targetConversationLoad;
      if (request && load.requests.has(request)) {
        if (load.requireContent) {
          try { load.messages = detailMessages(await response.json(), conversationId); } catch { load.messages = null; }
        }
        load.observed = true;
      }
    }
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

  async #observeWorkspaceFingerprint() {
    const observe = async () => {
      await this.checkResponses();
      const snapshot = await this.page.evaluate(({ command, selector }) => {
        const visible = (node) => node.getClientRects().length > 0
          && !["hidden", "collapse"].includes(getComputedStyle(node).visibility)
          && getComputedStyle(node).opacity !== "0";
        const markers = [...document.querySelectorAll(selector)].filter(visible)
          .map((node) => (node.innerText || node.textContent || "").normalize("NFC").trim()).filter(Boolean);
        // No authenticated native workspace-ID contract has been accepted yet.
        // Fail closed until that contract is established; a display label is not an ID.
        return { command, url: location.href, markers, nativeIdentity: null };
      }, { command: "workspaceContext", selector: selectors.workspaceContext });
      let url;
      try { url = new URL(snapshot?.url); } catch { throw new Error("Workspace context URL is unavailable"); }
      if (url.origin !== "https://chatgpt.com" || snapshot.markers?.length !== 1) {
        throw new Error("Workspace context is missing or ambiguous");
      }
      if (typeof snapshot.nativeIdentity !== "string" || !snapshot.nativeIdentity.trim()) {
        throw new Error("Stable unique workspace identity unavailable; authenticated native contract validation is pending");
      }
      return createHash("sha256").update(JSON.stringify([this.fingerprint, snapshot.nativeIdentity, snapshot.markers[0]])).digest("hex");
    };
    const first = await observe();
    await this.page.waitForTimeout(500);
    const second = await observe();
    if (first !== second) throw new Error("Workspace context changed between observations");
    return second;
  }

  async getAccountFingerprint({ workspaceFingerprint } = {}) {
    await this.open();
    await this.checkResponses();
    for (let i = 0; !this.fingerprint && i < 30; i++) {
      await this.page.waitForTimeout(500);
      await this.checkResponses();
    }
    if (!this.fingerprint) throw new Error("Stable account context unavailable; login verification stopped");
    const liveWorkspaceFingerprint = await this.#observeWorkspaceFingerprint();
    if (workspaceFingerprint && workspaceFingerprint !== liveWorkspaceFingerprint) throw new Error("Workspace mismatch; stopped");
    if (this.workspaceFingerprint && this.workspaceFingerprint !== liveWorkspaceFingerprint) throw new Error("Workspace context changed; stopped");
    this.workspaceFingerprint = liveWorkspaceFingerprint;
    this.writeWorkspaceDigest = liveWorkspaceFingerprint;
    const target = path.join(this.paths.state, "account.json");
    const previous = this.readJson(target);
    if (previous && (previous.accountFingerprint !== this.fingerprint
      || previous.workspaceFingerprint && previous.workspaceFingerprint !== liveWorkspaceFingerprint)) {
      throw new Error("Account or workspace mismatch; stopped");
    }
    this.writeJson(target, { accountFingerprint: this.fingerprint, workspaceFingerprint: liveWorkspaceFingerprint });
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
          emptyState: [...region.querySelectorAll(selectors.projectStatus)].filter(visible).some((node) => new RegExp(noProjects, "i").test((node.innerText || "").trim())),
          entries: [...region.querySelectorAll(selectors.projectLinks)].filter(visible).map((node) => ({ name: node.innerText, url: node.href })),
        };
      }, { selectors, noProjects: patterns.noProjects.source, moreProjects: patterns.moreProjects.source });
      await this.checkResponses();
      if (!(await this.loginState()).loggedIn) throw new Error("Login required in the dedicated profile; stopped");
      if (!snapshot || snapshot.uncertain || new URL(snapshot.url).origin !== "https://chatgpt.com") {
        throw new Error("Project region is missing, ambiguous, collapsed, or uncertain; inventory unchanged");
      }
      if ((!snapshot.entries.length && !snapshot.emptyState) || (snapshot.entries.length && snapshot.emptyState)) {
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

  async detectSafetyStop() {
    try {
      await this.open();
      while (this.pending.size) await Promise.all([...this.pending]);
      if (this.failure) return mapWriteError(this.failure);
      if (this.authRequired) return writeResult("access_restricted", "Login is required");
      const snapshot = await this.page.evaluate(({ command, selectors, login }) => {
        const visible = (node) => node.getClientRects().length > 0
          && !["hidden", "collapse"].includes(getComputedStyle(node).visibility)
          && getComputedStyle(node).opacity !== "0";
        const text = [...document.querySelectorAll(selectors.safetyText)]
          .filter(visible).map((node) => node.innerText || node.textContent || "").join(" ");
        const workspaceMarkers = [...document.querySelectorAll(selectors.workspaceContext)]
          .filter(visible).map((node) => (node.innerText || node.textContent || "").normalize("NFC").trim()).filter(Boolean);
        const loginPattern = new RegExp(login, "i");
        const loginRequired = [...document.querySelectorAll("button, a")].filter(visible)
          .some((node) => loginPattern.test(`${node.getAttribute("aria-label") || ""} ${node.innerText || node.textContent || ""}`));
        return { command, url: location.href, text, workspaceMarkers, loginRequired };
      }, { command: "safety", selectors, login: patterns.login.source });
      let url;
      try { url = new URL(snapshot?.url); } catch { return writeResult("uncertain", "Page URL is unavailable"); }
      if (url.origin !== "https://chatgpt.com") return writeResult("access_restricted", "Unexpected page origin");
      if (patterns.loggedOutPath.test(url.pathname) || patterns.challengePath.test(url.pathname)) {
        return writeResult("access_restricted", "Login or verification page detected");
      }
      if (snapshot.loginRequired) return writeResult("access_restricted", "Login is required");
      if (patterns.rateLimit.test(snapshot.text || "")) return writeResult("rate_limited", "Rate limit detected");
      if (patterns.accessRestriction.test(snapshot.text || "")) return writeResult("access_restricted", "Access restriction detected");
      const markers = (snapshot.workspaceMarkers || []).map((value) => value.normalize("NFC").trim()).filter(Boolean);
      if (markers.length !== 1) return writeResult("uncertain", "Workspace context is missing or ambiguous");
      const digest = await this.#observeWorkspaceFingerprint();
      if ((this.workspaceFingerprint && this.workspaceFingerprint !== digest)
        || (this.writeWorkspaceDigest && this.writeWorkspaceDigest !== digest)) {
        return writeResult("access_restricted", "Workspace context changed");
      }
      this.writeWorkspaceDigest = digest;
      return writeResult("verified", "Safety context verified");
    } catch (error) {
      return mapWriteError(error);
    }
  }

  async #prepareWrite() {
    const before = await this.detectSafetyStop();
    if (before.status !== "verified") return before;
    try {
      const fingerprint = await this.getAccountFingerprint({ workspaceFingerprint: this.writeWorkspaceDigest });
      if (this.writeFingerprint && this.writeFingerprint !== fingerprint) {
        return writeResult("access_restricted", "Account context changed");
      }
      this.writeFingerprint = fingerprint;
    } catch (error) {
      return mapWriteError(error);
    }
    return this.detectSafetyStop();
  }

  async #clickUnique({ control, selector, pattern, exactText }) {
    const safety = await this.detectSafetyStop();
    if (safety.status !== "verified") return safety;
    let observation;
    try {
      observation = await this.page.evaluate(({ command, control, selector, pattern, exactText, destructive }) => {
        const visible = (node) => node.getClientRects().length > 0
          && !["hidden", "collapse"].includes(getComputedStyle(node).visibility)
          && getComputedStyle(node).opacity !== "0";
        const normalize = (node) => (node.innerText || node.textContent || node.getAttribute("aria-label") || "").normalize("NFC").trim();
        const allowed = new RegExp(pattern, "i");
        const forbidden = new RegExp(destructive, "i");
        const matches = [...document.querySelectorAll(selector)].filter(visible).filter((node) => {
          const text = normalize(node);
          return exactText === undefined ? allowed.test(text) : text === exactText;
        });
        const destructiveMatch = matches.some((node) => forbidden.test(normalize(node)) || node.getAttribute("data-destructive") === "true");
        if (matches.length === 1 && !destructiveMatch) matches[0].click();
        return { command, control, count: matches.length, destructive: destructiveMatch };
      }, {
        command: "click",
        control,
        selector,
        pattern: pattern.source,
        exactText,
        destructive: patterns.destructiveControl.source,
      });
    } catch (error) {
      return mapWriteError(error);
    }
    if (observation?.count !== 1 || observation.destructive) {
      return writeResult("selector_missing", "Required control is missing or ambiguous");
    }
    const after = await this.detectSafetyStop();
    return after.status === "verified" ? writeResult("verified", "Control activated") : after;
  }

  async #setProjectName(name) {
    const safety = await this.detectSafetyStop();
    if (safety.status !== "verified") return safety;
    let result;
    try {
      result = await this.page.evaluate(({ command, selector, value }) => {
        const visible = (node) => node.getClientRects().length > 0
          && !["hidden", "collapse"].includes(getComputedStyle(node).visibility)
          && getComputedStyle(node).opacity !== "0";
        const inputs = [...document.querySelectorAll(selector)].filter(visible);
        if (inputs.length !== 1) return { command, count: inputs.length };
        const input = inputs[0];
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        if (setter) setter.call(input, value); else input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return { command, count: 1 };
      }, { command: "setProjectName", selector: selectors.projectName, value: name });
    } catch (error) {
      return mapWriteError(error);
    }
    if (result?.count !== 1) return writeResult("selector_missing", "Project-name field is missing or ambiguous");
    const after = await this.detectSafetyStop();
    return after.status === "verified" ? writeResult("verified", "Project name entered") : after;
  }

  async #navigateConversationForWrite(id) {
    const safety = await this.detectSafetyStop();
    if (safety.status !== "verified") return safety;
    const target = `https://chatgpt.com/c/${id}`;
    const load = { id, revision: ++this.conversationLoadRevision, observed: false, requests: new Set() };
    this.loadedConversationEvidence = null;
    this.targetConversationLoad = load;
    try { await this.page.evaluate((url) => { location.href = url; }, target); }
    catch (error) { if (!/execution context was destroyed|navigation/i.test(error.message)) return mapWriteError(error); }
    for (let attempt = 0; attempt < 30 && !load.observed; attempt++) {
      await this.page.waitForTimeout(100);
      while (this.pending.size) await Promise.all([...this.pending]);
    }
    if (this.targetConversationLoad !== load || !load.observed) {
      return writeResult("uncertain", "Fresh target conversation response was not observed");
    }
    const after = await this.detectSafetyStop();
    if (after.status !== "verified") return after;
    const observe = async () => {
      try {
        return await this.page.evaluate(({ command, selector }) => {
          const visible = (node) => node.getClientRects().length > 0
            && !["hidden", "collapse"].includes(getComputedStyle(node).visibility)
            && getComputedStyle(node).opacity !== "0";
          const markers = [...document.querySelectorAll(selector)].filter(visible)
            .filter((node) => (node.innerText || node.textContent || "").normalize("NFC").trim());
          return { command, url: location.href, rendered: markers.length > 0, markerCount: markers.length };
        }, { command: "targetConversation", selector: selectors.renderedConversation });
      } catch (error) { return { error: mapWriteError(error) }; }
    };
    const first = await observe();
    await this.page.waitForTimeout(500);
    const second = await observe();
    if (first.error) return first.error;
    if (second.error) return second.error;
    const valid = (snapshot) => {
      let current;
      try { current = new URL(snapshot?.url); } catch { return false; }
      return current.origin === "https://chatgpt.com" && current.pathname === `/c/${id}`
        && snapshot.rendered === true && Number.isInteger(snapshot.markerCount) && snapshot.markerCount > 0;
    };
    if (!valid(first) || !valid(second) || JSON.stringify(first) !== JSON.stringify(second)) {
      return writeResult("uncertain", "Requested conversation render is missing or unstable");
    }
    this.loadedConversationEvidence = { id, revision: load.revision };
    return writeResult("verified", "Conversation loaded by full ID");
  }

  async #observeConversationLocation(id, expected) {
    if (this.loadedConversationEvidence?.id !== id
      || this.loadedConversationEvidence.revision !== this.targetConversationLoad?.revision) {
      return writeResult("uncertain", "Fresh target conversation evidence is unavailable");
    }
    const safety = await this.detectSafetyStop();
    if (safety.status !== "verified") return safety;
    let snapshot;
    try {
      snapshot = await this.page.evaluate(({ command, selectors, archived }) => {
        const visible = (node) => node.getClientRects().length > 0
          && !["hidden", "collapse"].includes(getComputedStyle(node).visibility)
          && getComputedStyle(node).opacity !== "0";
        const names = [...document.querySelectorAll(selectors.conversationProject)].filter(visible)
          .map((node) => (node.innerText || node.textContent || "").normalize("NFC").trim()).filter(Boolean);
        const archivedPattern = new RegExp(archived, "i");
        const archivedState = [...document.querySelectorAll(selectors.archivedState)].filter(visible)
          .some((node) => archivedPattern.test((node.innerText || node.textContent || node.getAttribute("aria-label") || "").trim()));
        return { command, url: location.href, projectNames: names, archived: archivedState };
      }, { command: "conversationState", selectors, archived: patterns.archivedState.source });
    } catch (error) {
      return mapWriteError(error);
    }
    let url;
    try { url = new URL(snapshot?.url); } catch { return writeResult("uncertain", "Conversation state URL is unavailable"); }
    if (url.origin !== "https://chatgpt.com" || url.pathname !== `/c/${id}`) {
      return writeResult("uncertain", "Conversation location cannot be confirmed");
    }
    if (expected.kind === "archived") {
      return snapshot.archived
        ? writeResult("verified", "Archived state observed")
        : writeResult("uncertain", "Archived state was not observed");
    }
    const exact = (snapshot.projectNames || []).filter((name) => name === expected.name);
    return exact.length === 1 && snapshot.archived !== true
      ? writeResult("verified", "Exact destination Project observed")
      : writeResult("uncertain", "Exact destination Project was not observed");
  }

  async createProject(name) {
    validateProjectName(name);
    const prepared = await this.#prepareWrite();
    if (prepared.status !== "verified") return prepared;
    let projects;
    try { projects = await this.listProjects(); } catch (error) { return mapWriteError(error); }
    if (projects.filter((project) => project.name === name).length === 1) {
      return writeResult("verified", "Project already exists");
    }
    let step = await this.#clickUnique({ control: "create", selector: selectors.createProjectControl, pattern: patterns.createProject });
    if (step.status !== "verified") return step;
    step = await this.#setProjectName(name);
    if (step.status !== "verified") return step;
    step = await this.#clickUnique({ control: "createSubmit", selector: selectors.projectDialogSubmit, pattern: patterns.projectSubmit });
    if (step.status !== "verified") return step;
    await this.page.waitForTimeout(500);
    try { projects = await this.listProjects(); } catch (error) { return mapWriteError(error); }
    return projects.filter((project) => project.name === name).length === 1
      ? writeResult("verified", "Created Project observed")
      : writeResult("uncertain", "Created Project was not observed");
  }

  async moveConversation(id, project) {
    validateConversationId(id);
    validateProjectName(project);
    const prepared = await this.#prepareWrite();
    if (prepared.status !== "verified") return prepared;
    let step = await this.#navigateConversationForWrite(id);
    if (step.status !== "verified") return step;
    const current = await this.#observeConversationLocation(id, { kind: "project", name: project });
    if (current.status === "verified") return writeResult("verified", "Conversation already has the exact destination Project");
    if (current.status !== "uncertain") return current;
    step = await this.#clickUnique({ control: "header", selector: selectors.headerOptions, pattern: /.*/ });
    if (step.status !== "verified") return step;
    step = await this.#clickUnique({ control: "move", selector: selectors.openMenuItems, pattern: patterns.moveControl });
    if (step.status !== "verified") return step;
    step = await this.#clickUnique({ control: "destination", selector: selectors.projectChoices, pattern: /.*/, exactText: project });
    if (step.status !== "verified") return step;
    await this.page.waitForTimeout(500);
    return this.#observeConversationLocation(id, { kind: "project", name: project });
  }

  async archiveConversation(id) {
    validateConversationId(id);
    const prepared = await this.#prepareWrite();
    if (prepared.status !== "verified") return prepared;
    let step = await this.#navigateConversationForWrite(id);
    if (step.status !== "verified") return step;
    const current = await this.#observeConversationLocation(id, { kind: "archived" });
    if (current.status === "verified") return writeResult("verified", "Conversation is already archived");
    if (current.status !== "uncertain") return current;
    step = await this.#clickUnique({ control: "header", selector: selectors.headerOptions, pattern: /.*/ });
    if (step.status !== "verified") return step;
    step = await this.#clickUnique({ control: "archive", selector: selectors.openMenuItems, pattern: patterns.archiveControl });
    if (step.status !== "verified") return step;
    await this.page.waitForTimeout(500);
    return this.#observeConversationLocation(id, { kind: "archived" });
  }

  async verifyConversationLocation(id, expected) {
    validateConversationId(id);
    if (!expected || typeof expected !== "object" || !["archived", "project"].includes(expected.kind)) {
      throw new Error("A typed expected location is required");
    }
    if (expected.kind === "project") validateProjectName(expected.name);
    const prepared = await this.#prepareWrite();
    if (prepared.status !== "verified") return prepared;
    const navigation = await this.#navigateConversationForWrite(id);
    if (navigation.status !== "verified") return navigation;
    return this.#observeConversationLocation(id, expected);
  }

  async readConversation(id) {
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid conversation ID");
    await this.open();
    await this.getAccountFingerprint();
    const target = path.join(this.paths.raw, "conversations", `${id}.json`);
    const existing = this.readConversationCheckpoint(id);
    if (isCompleteConversationRecord(existing, id)) return existing;
    const url = `https://chatgpt.com/c/${id}`;
    const load = { id, revision: ++this.conversationLoadRevision, observed: false, requests: new Set(), requireContent: true };
    this.targetConversationLoad = load;
    this.loadedConversationEvidence = null;
    try { await this.page.evaluate((url) => { location.href = url; }, url); }
    catch (error) { if (!/execution context was destroyed|navigation/i.test(error.message)) throw error; }
    let previous = null;
    let record = null;
    for (let i = 0; i < 40; i++) {
      await this.page.waitForTimeout(500);
      await this.checkResponses();
      if (this.targetConversationLoad !== load) throw new Error("Conversation load changed; checkpoint unchanged");
      if (!load.observed || !load.messages) continue;
      if (!(await this.loginState()).loggedIn) throw new Error("Login required in the dedicated profile; stopped");
      let data;
      try {
        data = await this.page.evaluate(({ selectors }) => ({
          url: location.href,
          title: document.title.replace(/\s*[-|]\s*ChatGPT.*$/i, "").trim(),
          busy: !!document.querySelector('[aria-busy="true"], [data-is-streaming="true"]'),
          messages: [...document.querySelectorAll(selectors.messageRoles)].map((node) => {
            const content = node.querySelector(selectors.markdown) || node;
            return { role: node.getAttribute("data-message-author-role"), text: (content.innerText || content.textContent || "").trim() };
          }),
        }), { selectors });
      } catch { previous = null; continue; }
      await this.checkResponses();
      const candidate = { provider: "chatgpt", conversationId: id, title: data.title, url: data.url,
        messages: data.messages, extractionEvidence: { fullIdResponse: true, stableRender: true, complete: true } };
      const complete = !data.busy && isCompleteConversationRecord(candidate, id)
        && this.page.url() === url && JSON.stringify(data.messages) === JSON.stringify(load.messages);
      if (complete && previous === JSON.stringify(data)) { record = candidate; break; }
      previous = complete ? JSON.stringify(data) : null;
    }
    if (!record) throw new Error("Incomplete conversation snapshot: fresh full-ID response and stable complete render required; checkpoint unchanged");
    record.extractedAt = new Date().toISOString();
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
    const directory = [this.paths.raw, this.paths.state].find((base) => target.startsWith(`${base}${path.sep}`));
    if (!directory) throw new Error("Unsupported private artifact directory");
    writePrivateFile(this.paths, directory, target, `${JSON.stringify(value, null, 2)}\n`);
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
      this.page = null; this.fingerprint = null; this.workspaceFingerprint = null; this.failure = null; this.authRequired = false; this.items = [];
      this.targetConversationLoad = null; this.loadedConversationEvidence = null;
      this.discoveryFailure = null; this.validListResponses = 0; this.listRequests.clear(); this.lastFingerprint = null;
    }
  }
}

module.exports = { ChatGPTAdapter };
