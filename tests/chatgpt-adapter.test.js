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
const { main: readWrapper } = require("../scripts/04-read");
const fixtures = require("./fixtures/conversations.json");

function setup(t, { loggedIn = true, status = 200, accountId = "fixture-account", emitSession = true, emitList = true,
  listJson = async () => ({ items: [...fixtures, { ...fixtures[0], title: "Synthetic latest", update_time: 1700000400 }] }) } = {}) {
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
  let messages = [{ getAttribute: () => "user", querySelector: () => null, innerText: "Synthetic message" }];
  const projectUI = { regions: 1, expanded: "true", busy: false, uncertain: false, status: "", more: false, entries: [
    { name: "  Re\u0301search  ", url: "https://chatgpt.com/g/g-p-fixture-research/project" },
    { name: "Work  Notes", url: "https://chatgpt.com/g/g-p-fixture-work/project" },
  ] };
  const visibleNode = { getClientRects: () => [1] };
  const projectRegion = {
    ...visibleNode,
    getAttribute: (name) => name === "aria-expanded" ? projectUI.expanded : name === "aria-busy" ? String(projectUI.busy) : null,
    querySelectorAll: (selector) => {
      if (selector === selectors.projectLinks) return projectUI.entries.map((entry) => ({ ...visibleNode, href: entry.url, innerText: entry.name, visibility: entry.visibility || "visible" }));
      if (selector === selectors.projectUncertainState) return projectUI.uncertain ? [visibleNode] : [];
      if (selector === selectors.projectStatus) return projectUI.status ? [{ ...visibleNode, innerText: projectUI.status }] : [];
      if (selector === selectors.projectControls) return projectUI.more ? [{ ...visibleNode, innerText: "Show more" }] : [];
      return [];
    },
  };
  const document = {
    title: "Synthetic detail - ChatGPT",
    querySelector: (selector) => selector === selectors.historyNavigation && loggedIn ? nav : null,
    querySelectorAll: (selector) => {
      if (selector === "button" && !loggedIn) return [{ getClientRects: () => [1], getAttribute: () => null, textContent: "Log in" }];
      if (selector === selectors.messageRoles) return messages;
      if (selector === selectors.projectsRegion) return Array(projectUI.regions).fill(projectRegion);
      return [];
    },
  };
  page.evaluate = async (fn, arg) => {
    const result = vm.runInNewContext(`(${fn.toString()})(arg)`, { arg, document, location,
      getComputedStyle: (node) => ({ visibility: node.visibility || "visible", opacity: "1" }) });
    return result === undefined ? undefined : JSON.parse(JSON.stringify(result));
  };
  let closed = 0;
  const browser = {
    launch: async () => page,
    goto: async () => {
      if (emitSession) page.emit("response", { url: () => "https://chatgpt.com/api/auth/session", status: () => 200,
        json: async () => ({ user: { id: accountId, email: "fixture@example.invalid" }, accessToken: "synthetic-token" }) });
      if (emitList) page.emit("response", { url: () => "https://chatgpt.com/backend-api/conversations?offset=0", status: () => status, json: listJson });
    },
    close: async () => { closed++; },
  };
  const adapter = new ChatGPTAdapter({ paths, browser });
  t.after(() => adapter.close());
  return { paths, page, adapter, projectUI, closed: () => closed, setLoggedIn: (value) => { loggedIn = value; }, setMessages: (value) => { messages = value; } };
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
  const { adapter, page } = setup(t, { emitSession: false });
  page.waitForTimeout = async () => {
    page.emit("response", { url: () => "https://chatgpt.com/api/auth/session", status: () => 200,
      json: async () => ({ user: { id: "fixture-account" } }) });
  };
  assert.match(await adapter.getAccountFingerprint(), /^[a-f0-9]{16}$/);
  const absent = setup(t, { emitSession: false });
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

for (const [name, options] of [
  ["malformed JSON", { listJson: async () => { throw new SyntaxError("Synthetic malformed JSON"); } }],
  ["unsupported list schema", { listJson: async () => ({ conversations: fixtures }) }],
  ["invalid list item", { listJson: async () => ({ items: [{ title: "Missing synthetic ID" }] }) }],
  ["invalid list metadata", { listJson: async () => ({ items: [{ id: "fixture-chat-1", title: { unexpected: "Synthetic metadata" } }] }) }],
  ["missing native list response", { emitList: false }],
  ["unexpected HTTP status", { status: 503 }],
]) {
  test(`discovery rejects ${name} and preserves the prior inventory`, async (t) => {
    for (const priorExists of [false, true]) {
      const { adapter, paths } = setup(t, options);
      const target = path.join(paths.raw, "conversations.json");
      const prior = '[{"provider":"chatgpt","conversationId":"fixture-prior"}]\n';
      if (priorExists) { fs.mkdirSync(paths.raw, { recursive: true }); fs.writeFileSync(target, prior); }
      await assert.rejects(adapter.discoverConversations(), /discovery|list response/i);
      assert.equal(fs.existsSync(target), priorExists);
      if (priorExists) assert.equal(fs.readFileSync(target, "utf8"), prior);
    }
  });
}

test("failed later pagination preserves the prior inventory instead of a partial first page", async (t) => {
  const { adapter, paths, page } = setup(t);
  const target = path.join(paths.raw, "conversations.json");
  const prior = '[{"provider":"chatgpt","conversationId":"fixture-prior"}]\n';
  fs.mkdirSync(paths.raw, { recursive: true });
  fs.writeFileSync(target, prior);
  page.mouse.wheel = async () => {
    page.emit("response", { url: () => "https://chatgpt.com/backend-api/conversations?offset=2", status: () => 500, json: async () => ({}) });
  };
  await assert.rejects(adapter.discoverConversations(), /discovery|list response/i);
  assert.equal(fs.readFileSync(target, "utf8"), prior);
});

for (const failed of [false, true]) {
  test(`${failed ? "failed" : "unfinished"} pagination request cannot become a successful inventory`, async (t) => {
    const { adapter, page, paths } = setup(t);
    const request = { url: () => "https://chatgpt.com/backend-api/conversations?offset=2" };
    page.mouse.wheel = async () => {
      page.emit("request", request);
      if (failed) page.emit("requestfailed", request);
    };
    await assert.rejects(adapter.discoverConversations(), /discovery|list request/i);
    assert.equal(fs.existsSync(path.join(paths.raw, "conversations.json")), false);
  });
}

test("final extraction rejects disappeared message nodes without replacing a checkpoint", async (t) => {
  const { adapter, paths, page, setMessages } = setup(t);
  const target = path.join(paths.raw, "conversations", "fixture-chat-1.json");
  page.waitForTimeout = async (ms) => { if (ms === 1200) setMessages([]); };
  await assert.rejects(adapter.readConversation("fixture-chat-1"), /incomplete|message|snapshot/i);
  assert.equal(fs.existsSync(target), false);
});

test("final extraction rejects a snapshot at another origin or conversation path", async (t) => {
  for (const url of ["https://example.invalid/c/fixture-chat-1", "https://chatgpt.com/c/fixture-other"]) {
    const { adapter, paths, page } = setup(t);
    const evaluate = page.evaluate;
    page.evaluate = async (fn, arg) => {
      const result = await evaluate(fn, arg);
      if (result?.messages) result.url = url;
      return result;
    };
    await assert.rejects(adapter.readConversation("fixture-chat-1"), /incomplete|snapshot|navigation/i);
    assert.equal(fs.existsSync(path.join(paths.raw, "conversations", "fixture-chat-1.json")), false);
  }
});

test("malformed and empty conversation checkpoints are re-read rather than resumed", async (t) => {
  for (const contents of ['{"broken":', JSON.stringify({ provider: "chatgpt", conversationId: "fixture-chat-1", url: "https://chatgpt.com/c/fixture-chat-1", messages: [] })]) {
    const { adapter, paths, page } = setup(t);
    const target = path.join(paths.raw, "conversations", "fixture-chat-1.json");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
    const record = await adapter.readConversation("fixture-chat-1");
    assert.equal(page.url(), "https://chatgpt.com/c/fixture-chat-1");
    assert.deepEqual(record.messages, [{ role: "user", text: "Synthetic message" }]);
    assert.deepEqual(JSON.parse(fs.readFileSync(target)), record);
  }
});

test("legacy --all wrapper re-reads incomplete checkpoints with the adapter's completeness rules", async (t) => {
  const { adapter, paths } = setup(t);
  const directory = path.join(paths.raw, "conversations");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(paths.raw, "conversations.json"), JSON.stringify(fixtures.map((item) => ({ provider: "chatgpt", conversationId: item.id }))));
  fs.writeFileSync(path.join(directory, "fixture-chat-1.json"), '{"broken":');
  fs.writeFileSync(path.join(directory, "fixture-chat-2-full-id.json"), JSON.stringify({ provider: "chatgpt", conversationId: "fixture-chat-2-full-id", url: "https://chatgpt.com/c/fixture-chat-2-full-id", messages: [] }));
  await readWrapper(["--all", "--delay", "0"], { paths, adapter });
  for (const id of ["fixture-chat-1", "fixture-chat-2-full-id"]) {
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, `${id}.json`))).messages, [{ role: "user", text: "Synthetic message" }]);
  }
});

test("an empty session invalidates fingerprint verification and cached reads until a later valid login", async (t) => {
  for (const invalidSession of [{}, { user: {} }, { user: { id: "  " } }]) {
    const { adapter, page } = setup(t);
    const record = await adapter.readConversation("fixture-chat-1");
    page.emit("response", { url: () => "https://chatgpt.com/api/auth/session", status: () => 200, json: async () => invalidSession });
    await assert.rejects(adapter.getAccountFingerprint(), /login|account context/i);
    await assert.rejects(adapter.readConversation("fixture-chat-1"), /login|account context/i);
    await assert.rejects(adapter.discoverConversations({ max: 1 }), /login|account context/i);
    await assert.rejects(adapter.login({ timeoutMs: 0 }), /login/i);
    page.waitForTimeout = async () => {
      page.emit("response", { url: () => "https://chatgpt.com/api/auth/session", status: () => 200, json: async () => ({ user: { id: "fixture-account" } }) });
    };
    await adapter.login();
    assert.deepEqual(await adapter.readConversation("fixture-chat-1"), record);
  }
});

test("legacy --all wrapper verifies the current account even when every checkpoint is complete", async (t) => {
  const { adapter, paths, page } = setup(t);
  await adapter.readConversation("fixture-chat-1");
  fs.writeFileSync(path.join(paths.raw, "conversations.json"), JSON.stringify([{ provider: "chatgpt", conversationId: "fixture-chat-1" }]));
  page.emit("response", { url: () => "https://chatgpt.com/api/auth/session", status: () => 200, json: async () => ({}) });
  await assert.rejects(readWrapper(["--all"], { paths, adapter }), /login|account context/i);
});

test("a delayed old session cannot restore identity after a newer empty session", async (t) => {
  const { adapter, page } = setup(t);
  await adapter.getAccountFingerprint();
  let resolveOld;
  page.emit("response", { url: () => "https://chatgpt.com/api/auth/session", status: () => 200,
    json: () => new Promise((resolve) => { resolveOld = resolve; }) });
  page.emit("response", { url: () => "https://chatgpt.com/api/auth/session", status: () => 200, json: async () => ({}) });
  resolveOld({ user: { id: "fixture-account" } });
  await assert.rejects(adapter.getAccountFingerprint(), /login|account context/i);
});

test("lists visible native Projects with exact normalized names and deduplicates repeated entries", async (t) => {
  const { adapter, projectUI } = setup(t);
  projectUI.entries.push({ ...projectUI.entries[0] });
  assert.deepEqual(await adapter.listProjects(), [
    { name: "Résearch", url: "https://chatgpt.com/g/g-p-fixture-research/project" },
    { name: "Work  Notes", url: "https://chatgpt.com/g/g-p-fixture-work/project" },
  ]);
});

test("Project listing excludes CSS-hidden entries", async (t) => {
  const { adapter, projectUI } = setup(t);
  projectUI.entries = [
    { name: "Visible synthetic project", url: "https://chatgpt.com/g/g-p-fixture-visible/project" },
    { name: "Hidden synthetic project", url: "https://chatgpt.com/g/g-p-fixture-hidden/project", visibility: "hidden" },
  ];
  assert.deepEqual(await adapter.listProjects(), [{ name: "Visible synthetic project", url: "https://chatgpt.com/g/g-p-fixture-visible/project" }]);
});

test("accepts an empty Projects inventory only with a stable expanded region or explicit empty state", async (t) => {
  for (const explicit of [false, true]) {
    const { adapter, projectUI } = setup(t);
    projectUI.entries = [];
    if (explicit) { projectUI.expanded = null; projectUI.status = "暂无项目"; }
    assert.deepEqual(await adapter.listProjects(), []);
  }
});

for (const [name, change] of [
  ["missing region", { regions: 0 }],
  ["ambiguous region", { regions: 2 }],
  ["collapsed region", { expanded: "false" }],
  ["loading region", { busy: true }],
  ["error or uncertain state", { uncertain: true }],
  ["unobserved additional entries", { more: true }],
  ["unverified empty region", { entries: [], expanded: null }],
  ["empty project name", { entries: [{ name: "  ", url: "https://chatgpt.com/g/g-p-fixture/project" }] }],
  ["unsupported project URL", { entries: [{ name: "Synthetic", url: "https://example.invalid/g/g-p-fixture/project" }] }],
]) {
  test(`Project listing rejects ${name}`, async (t) => {
    const { adapter, projectUI } = setup(t);
    Object.assign(projectUI, change);
    await assert.rejects(adapter.listProjects(), /project/i);
  });
}

test("Project listing rejects duplicate normalized names pointing to different native URLs", async (t) => {
  const { adapter, projectUI } = setup(t);
  projectUI.entries = [
    { name: " Re\u0301search ", url: "https://chatgpt.com/g/g-p-fixture-first/project" },
    { name: "Résearch", url: "https://chatgpt.com/g/g-p-fixture-second/project" },
  ];
  await assert.rejects(adapter.listProjects(), /ambiguous|duplicate/i);
});

test("Project listing rejects DOM changes between its bounded observations", async (t) => {
  const { adapter, projectUI, page } = setup(t);
  page.waitForTimeout = async () => { projectUI.entries[0].name = "Changed synthetic name"; };
  await assert.rejects(adapter.listProjects(), /project.*changed|unstable/i);
});

test("Project listing stops on authentication loss during observation", async (t) => {
  const { adapter, page } = setup(t);
  page.waitForTimeout = async () => {
    page.emit("response", { url: () => "https://chatgpt.com/api/auth/session", status: () => 200, json: async () => ({}) });
  };
  await assert.rejects(adapter.listProjects(), /login|account context/i);
});

test("discover persists validated Projects atomically and preserves a prior inventory on uncertainty", async (t) => {
  const output = { write() {} };
  const success = setup(t);
  assert.equal(await main(["discover", "--max", "1"], { ...success, stdout: output, stderr: output }), 0);
  const target = path.join(success.paths.raw, "projects.json");
  assert.deepEqual(JSON.parse(fs.readFileSync(target)), [
    { name: "Résearch", url: "https://chatgpt.com/g/g-p-fixture-research/project" },
    { name: "Work  Notes", url: "https://chatgpt.com/g/g-p-fixture-work/project" },
  ]);
  assert.equal(fs.statSync(target).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(`${target}.tmp`), false);
  const failure = setup(t);
  failure.projectUI.regions = 0;
  const priorTarget = path.join(failure.paths.raw, "projects.json");
  const prior = '[{"name":"Synthetic prior","url":"https://chatgpt.com/g/g-p-fixture-prior/project"}]\n';
  fs.mkdirSync(failure.paths.raw, { recursive: true });
  fs.writeFileSync(priorTarget, prior);
  assert.equal(await main(["discover", "--max", "1"], { ...failure, stdout: output, stderr: output }), 1);
  assert.equal(fs.readFileSync(priorTarget, "utf8"), prior);
});
