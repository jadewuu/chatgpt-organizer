const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const vm = require("node:vm");
const { createPaths } = require("../src/core/paths");
const { ChatGPTAdapter } = require("../src/providers/chatgpt/adapter");
const { createBrowser } = require("../src/providers/chatgpt/browser");
const { selectors } = require("../src/providers/chatgpt/selectors");
const { main } = require("../src/cli");
const fixtures = require("./fixtures/conversations.json");

function setup(t, { loggedIn = true, status = 200, accountId = "fixture-account" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "organizer-adapter-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const paths = createPaths(root);
  const page = new EventEmitter();
  let url = "https://chatgpt.com/";
  page.url = () => url;
  page.waitForTimeout = async () => {};
  page.locator = () => ({ count: async () => loggedIn ? 1 : 0, first() { return this; }, boundingBox: async () => ({ x: 0, y: 0, width: 200, height: 600 }), innerText: async () => "" });
  page.mouse = { move: async () => {}, wheel: async () => {} };
  const location = { get href() { return url; }, set href(value) { url = value; }, get origin() { return new URL(url).origin; } };
  const nav = { scrollTop: 0, scrollHeight: 600, clientHeight: 600 };
  const document = {
    title: "Synthetic detail - ChatGPT",
    querySelector: (selector) => selector === selectors.historyNavigation && loggedIn ? nav : null,
    querySelectorAll: (selector) => {
      if (selector === "button" && !loggedIn) return [{ getClientRects: () => [1], getAttribute: () => null, textContent: "Log in" }];
      if (selector === selectors.messageRoles) return [{ getAttribute: () => "user", querySelector: () => null, innerText: "Synthetic message" }];
      return [];
    },
  };
  page.evaluate = async (fn, arg) => {
    const result = vm.runInNewContext(`(${fn.toString()})(arg)`, { arg, document, location });
    return result === undefined ? undefined : JSON.parse(JSON.stringify(result));
  };
  let closed = 0;
  const browser = {
    launch: async () => page,
    goto: async () => {
      page.emit("response", { url: () => "https://chatgpt.com/api/auth/session", status: () => 200,
        json: async () => ({ user: { id: accountId, email: "fixture@example.invalid" }, accessToken: "synthetic-token" }) });
      page.emit("response", { url: () => "https://chatgpt.com/backend-api/conversations?offset=0", status: () => status,
        json: async () => ({ items: [...fixtures, { ...fixtures[0], title: "Synthetic latest", update_time: 1700000400 }] }) });
    },
    close: async () => { closed++; },
  };
  const adapter = new ChatGPTAdapter({ paths, browser });
  t.after(() => adapter.close());
  return { paths, page, adapter, closed: () => closed, setLoggedIn: (value) => { loggedIn = value; } };
}

test("discovery captures native responses, merges IDs, and limits private normalized output", async (t) => {
  const { adapter, paths } = setup(t);
  const records = await adapter.discoverConversations({ max: 1 });
  assert.equal(records.length, 1);
  assert.equal(records[0].title, "Synthetic latest");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(paths.raw, "conversations.json"))), records);
  assert.equal(fs.existsSync(path.join(paths.root, "data")), false);
});

test("fingerprint persists only a stable 16-hex digest and rejects account changes", async (t) => {
  const { adapter, paths, page } = setup(t);
  await adapter.login({ timeoutMs: 0 });
  const fingerprint = await adapter.getAccountFingerprint();
  assert.match(fingerprint, /^[a-f0-9]{16}$/);
  const saved = fs.readFileSync(path.join(paths.state, "account.json"), "utf8");
  assert.deepEqual(JSON.parse(saved), { accountFingerprint: fingerprint });
  assert.doesNotMatch(saved, /fixture-account|fixture@example|synthetic-token/);
  page.emit("response", { url: () => "https://chatgpt.com/api/auth/session", status: () => 200,
    json: async () => ({ user: { id: "fixture-other-account" } }) });
  await assert.rejects(adapter.getAccountFingerprint(), /account mismatch/i);
});

test("read uses full ID, persists content and resumes without navigating", async (t) => {
  const { adapter, paths, page } = setup(t);
  const record = await adapter.readConversation("fixture-chat-2-full-id");
  assert.equal(page.url(), "https://chatgpt.com/c/fixture-chat-2-full-id");
  assert.equal(record.conversationId, "fixture-chat-2-full-id");
  assert.deepEqual(record.messages, [{ role: "user", text: "Synthetic message" }]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(paths.raw, "conversations", "fixture-chat-2-full-id.json"))), record);
  page.evaluate = async () => { throw new Error("Resume must not navigate"); };
  assert.deepEqual(await adapter.readConversation("fixture-chat-2-full-id"), record);
  await assert.rejects(adapter.readConversation("../outside"), /conversation ID/i);
});

test("unauthenticated discovery and rate limits stop before output", async (t) => {
  for (const options of [{ loggedIn: false }, { status: 429 }]) {
    const { adapter, paths } = setup(t, options);
    await assert.rejects(adapter.discoverConversations({ max: 5 }), /login|rate limit/i);
    assert.equal(fs.existsSync(path.join(paths.raw, "conversations.json")), false);
  }
});

test("browser refuses non-dedicated paths and profile symlinks before launch", (t) => {
  const { paths } = setup(t);
  assert.throws(() => createBrowser({ ...paths, profile: path.join(paths.root, "profile") }), /profile/i);
  fs.mkdirSync(paths.local);
  fs.symlinkSync(paths.root, paths.profile, "dir");
  assert.throws(() => createBrowser(paths), /symlink/i);
});

test("authentication loss during reading stops before persisting message content", async (t) => {
  const { adapter, page, paths, setLoggedIn } = setup(t);
  await adapter.open();
  page.waitForTimeout = async () => { setLoggedIn(false); };
  await assert.rejects(adapter.readConversation("fixture-chat-1"), /login/i);
  assert.equal(fs.existsSync(path.join(paths.raw, "conversations", "fixture-chat-1.json")), false);
});

test("manual login can recover from an initial unauthenticated native response", async (t) => {
  const { adapter, page, setLoggedIn } = setup(t, { loggedIn: false, status: 401 });
  page.waitForTimeout = async () => {
    setLoggedIn(true);
    page.emit("response", { url: () => "https://chatgpt.com/api/auth/session", status: () => 200,
      json: async () => ({ user: { id: "fixture-account" } }) });
  };
  assert.match((await adapter.login()).accountFingerprint, /^[a-f0-9]{16}$/);
});

test("account verification waits for native session context and fails closed when absent", async (t) => {
  const { adapter, page } = setup(t, { accountId: null });
  page.waitForTimeout = async () => {
    page.emit("response", { url: () => "https://chatgpt.com/api/auth/session", status: () => 200,
      json: async () => ({ user: { id: "fixture-account" } }) });
  };
  assert.match(await adapter.getAccountFingerprint(), /^[a-f0-9]{16}$/);
  const absent = setup(t, { accountId: null });
  await assert.rejects(absent.adapter.getAccountFingerprint(), /account context unavailable/i);
  assert.equal(fs.existsSync(path.join(absent.paths.state, "account.json")), false);
});

test("discovery confirms the bottom with wheel nudging and checkpoints all captured IDs", async (t) => {
  const { adapter, page } = setup(t);
  const wheels = [];
  page.mouse.wheel = async (_x, y) => { wheels.push(y); };
  const records = await adapter.discoverConversations();
  assert.equal(records.length, 2);
  assert.deepEqual(wheels.slice(-2), [-150, 150]);
});

test("CLI loads login and discover lazily, closes owned adapters, and rejects invalid max", async (t) => {
  const { adapter, closed } = setup(t);
  const output = { write() {} };
  assert.equal(await main(["login"], { adapter, stdout: output, stderr: output }), 0);
  assert.equal(await main(["discover", "--max", "1"], { adapter, stdout: output, stderr: output }), 0);
  assert.equal(await main(["discover", "--max", "-1"], { adapter, stdout: output, stderr: output }), 1);
  assert.equal(closed(), 2);
  assert.equal(await main(["read"], { stdout: output, stderr: output }), 2);
});
