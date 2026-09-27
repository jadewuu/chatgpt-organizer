const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const vm = require("node:vm");
const { createPaths } = require("../src/core/paths");
const { createRunState, saveRunState, loadRunState } = require("../src/core/state");
const { ChatGPTAdapter } = require("../src/providers/chatgpt/adapter");
const { createBrowser } = require("../src/providers/chatgpt/browser");
const { selectors } = require("../src/providers/chatgpt/selectors");
const { main } = require("../src/cli");
const { main: readWrapper } = require("../scripts/04-read");
const fixtures = require("./fixtures/conversations.json");

function setup(t, { loggedIn = true, status = 200, accountId = "fixture-account", emitSession = true, emitList = true,
  emitMe = true,
  workspaceMarkers = ["Synthetic workspace"], nativeIdentity = "synthetic-workspace-id", emitDetail = true,
  detailJson = null, currentHomepage = false, gotoError = null,
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
  const workspaceNodes = () => workspaceMarkers.map((value) => ({
    ...visibleNode, innerText: value, textContent: value, visibility: "visible",
  }));
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
    querySelector: (selector) => {
      if (!loggedIn) return null;
      if (!currentHomepage) return selector === selectors.historyNavigation ? nav : null;
      const candidates = selector.split(",").map((value) => value.trim());
      if (candidates.includes('nav[aria-label="聊天记录"]')) return nav;
      if (candidates.includes('form [contenteditable="true"][role="textbox"]')) return visibleNode;
      return null;
    },
    querySelectorAll: (selector) => {
      if (selector === "button" && !loggedIn) return [{ getClientRects: () => [1], getAttribute: () => null, textContent: "Log in" }];
      if (selector === selectors.messageRoles) return messages;
      if (selector === selectors.projectsRegion) return Array(projectUI.regions).fill(projectRegion);
      if (selector === selectors.workspaceContext) return workspaceNodes();
      return [];
    },
  };
  page.evaluate = async (fn, arg) => {
    const result = await vm.runInNewContext(`(${fn.toString()})(arg)`, { arg, document, location,
      fetch: async () => ({ status: 200 }),
      getComputedStyle: (node) => ({ visibility: node.visibility || "visible", opacity: "1" }) });
    if (typeof arg === "string" && arg.startsWith("https://chatgpt.com/c/") && emitDetail) {
      const id = arg.split("/").at(-1);
      const request = { url: () => `https://chatgpt.com/backend-api/conversation/${id}` };
      page.emit("request", request);
      page.emit("response", { url: request.url, request: () => request, status: () => 200,
        json: async () => detailJson ? detailJson(id) : ({ conversation_id: id, current_node: "m1", mapping: {
          m1: { parent: null, message: { author: { role: "user" }, status: "finished_successfully",
            content: { content_type: "text", parts: ["Synthetic message"] } } },
        } }) });
    }
    return result === undefined ? undefined : JSON.parse(JSON.stringify(result));
  };
  let closed = 0;
  const workspaceRequest = { headerValue: async (name) => name === "chatgpt-account-id" ? nativeIdentity : null };
  const browser = {
    launch: async () => page,
    goto: async () => {
      if (emitSession) page.emit("response", { url: () => "https://chatgpt.com/api/auth/session", status: () => 200,
        json: async () => ({ user: { id: accountId, email: "fixture@example.invalid" }, accessToken: "synthetic-token" }) });
      if (emitMe) page.emit("response", { url: () => "https://chatgpt.com/backend-api/me", status: () => 200,
        request: () => workspaceRequest, json: async () => ({ id: accountId }) });
      if (nativeIdentity !== null) page.emit("response", { url: () => "https://chatgpt.com/backend-api/wham/accounts/check", status: () => 200,
        request: () => workspaceRequest, json: async () => ({ default_account_id: nativeIdentity,
          accounts: [{ id: nativeIdentity, can_access_with_session: true }] }) });
      if (emitList) page.emit("response", { url: () => "https://chatgpt.com/backend-api/conversations?offset=0", status: () => status,
        request: () => workspaceRequest, json: listJson });
      if (gotoError) throw gotoError;
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
  assert.deepEqual(JSON.parse(saved), {
    accountFingerprint: fingerprint,
    workspaceFingerprint: require("node:crypto").createHash("sha256").update(JSON.stringify([fingerprint, "synthetic-workspace-id"])).digest("hex"),
  });
  assert.doesNotMatch(saved, /fixture-account|fixture@example|synthetic-token|Synthetic workspace/);
  page.emit("response", { url: () => "https://chatgpt.com/backend-api/me", status: () => 200,
    request: () => ({ headerValue: async () => "synthetic-workspace-id" }),
    json: async () => ({ id: "fixture-other-account" }) });
  await assert.rejects(adapter.getAccountFingerprint(), /account mismatch/i);
});

test("read uses full ID, persists content and resumes without navigating", async (t) => {
  const { adapter, paths, page } = setup(t);
  const record = await adapter.readConversation("fixture-chat-2-full-id");
  assert.equal(page.url(), "https://chatgpt.com/c/fixture-chat-2-full-id");
  assert.equal(record.conversationId, "fixture-chat-2-full-id");
  assert.deepEqual(record.messages, [{ role: "user", text: "Synthetic message" }]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(paths.raw, "conversations", "fixture-chat-2-full-id.json"))), record);
  const evaluate = page.evaluate;
  page.evaluate = async (fn, arg) => {
    if (typeof arg === "string") throw new Error("Resume must not navigate");
    return evaluate(fn, arg);
  };
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

test("adapter accepts an aborted initial navigation only after Chrome reaches ChatGPT", async (t) => {
  const { adapter, page } = setup(t, { gotoError: new Error("page.goto: net::ERR_ABORTED at https://chatgpt.com/") });
  assert.equal(await adapter.open(), page);

  const outside = setup(t, { gotoError: new Error("page.goto: net::ERR_ABORTED at https://chatgpt.com/") });
  outside.page.url = () => "about:blank";
  await assert.rejects(outside.adapter.open(), /ERR_ABORTED/);
});

test("authentication loss during reading stops before persisting message content", async (t) => {
  const { adapter, page, paths, setLoggedIn } = setup(t);
  await adapter.open();
  page.waitForTimeout = async () => { setLoggedIn(false); };
  await assert.rejects(adapter.readConversation("fixture-chat-1"), /login/i);
  assert.equal(fs.existsSync(path.join(paths.raw, "conversations", "fixture-chat-1.json")), false);
});

test("manual login can recover from an initial unauthenticated native response", async (t) => {
  const { adapter, page, setLoggedIn } = setup(t, { loggedIn: false, status: 401, emitMe: false });
  page.waitForTimeout = async () => {
    setLoggedIn(true);
    page.emit("response", { url: () => "https://chatgpt.com/backend-api/me", status: () => 200,
      request: () => ({ headerValue: async () => "synthetic-workspace-id" }),
      json: async () => ({ id: "fixture-account" }) });
  };
  assert.match((await adapter.login()).accountFingerprint, /^[a-f0-9]{16}$/);
});

test("manual login tolerates a page evaluation interrupted by authentication navigation", async (t) => {
  for (const interruptedCall of [1, 2]) {
    const { adapter, page } = setup(t);
    const evaluate = page.evaluate;
    let calls = 0;
    page.evaluate = async (...args) => {
      if (++calls === interruptedCall) {
        throw new Error("Execution context was destroyed, most likely because of a navigation");
      }
      return evaluate(...args);
    };

    assert.match((await adapter.login()).accountFingerprint, /^[a-f0-9]{16}$/);
  }
});

test("login state recognizes the current authenticated homepage structure", async (t) => {
  const { adapter } = setup(t, { currentHomepage: true });
  await adapter.open();

  assert.deepEqual(await adapter.loginState(), { loggedIn: true, loginRequired: false, restricted: false });
});

test("account verification waits for native me context and fails closed when absent", async (t) => {
  const { adapter, page } = setup(t, { emitSession: false, emitMe: false });
  page.waitForTimeout = async () => {
    page.emit("response", { url: () => "https://chatgpt.com/backend-api/me", status: () => 200,
      request: () => ({ headerValue: async () => "synthetic-workspace-id" }),
      json: async () => ({ id: "fixture-account" }) });
  };
  assert.match(await adapter.getAccountFingerprint(), /^[a-f0-9]{16}$/);
  const absent = setup(t, { emitSession: false, emitMe: false });
  await assert.rejects(absent.adapter.getAccountFingerprint(), /account context unavailable/i);
  assert.equal(fs.existsSync(path.join(absent.paths.state, "account.json")), false);
});

test("account verification uses native me and an accessible workspace header without a display marker", async (t) => {
  const { adapter, page, paths } = setup(t, { emitSession: false, emitMe: false, workspaceMarkers: [], nativeIdentity: null });
  await adapter.open();
  const workspaceId = "fixture-native-workspace";
  const request = { headerValue: async (name) => name === "chatgpt-account-id" ? workspaceId : null };
  page.emit("response", { url: () => "https://chatgpt.com/backend-api/me", status: () => 200,
    request: () => request, json: async () => ({ id: "fixture-account" }) });
  page.emit("response", { url: () => "https://chatgpt.com/backend-api/wham/accounts/check", status: () => 200,
    request: () => request, json: async () => ({ default_account_id: workspaceId,
      accounts: [{ id: workspaceId, can_access_with_session: true }] }) });

  const accountFingerprint = await adapter.getAccountFingerprint();
  assert.match(accountFingerprint, /^[a-f0-9]{16}$/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(paths.state, "account.json"))), {
    accountFingerprint,
    workspaceFingerprint: require("node:crypto").createHash("sha256")
      .update(JSON.stringify([accountFingerprint, workspaceId])).digest("hex"),
  });
});

test("legacy session data cannot establish the native account identity", async (t) => {
  const { adapter } = setup(t, { emitMe: false });
  await assert.rejects(adapter.getAccountFingerprint(), /account context|native.*identity|login/i);
});

test("a failed workspace account refresh invalidates earlier identity evidence", async (t) => {
  const { adapter, page } = setup(t);
  await adapter.getAccountFingerprint();
  page.emit("response", {
    url: () => "https://chatgpt.com/backend-api/wham/accounts/check",
    status: () => 503,
    request: () => ({ headerValue: async () => "synthetic-workspace-id" }),
  });
  await assert.rejects(adapter.getAccountFingerprint(), /workspace|account context|unavailable/i);
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
  const evaluate = page.evaluate;
  page.evaluate = async (fn, arg) => {
    const value = await evaluate(fn, arg);
    if (value?.messages) setMessages([]);
    return value;
  };
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

test("an empty native me response invalidates fingerprint verification and cached reads until a later valid login", async (t) => {
  for (const invalidMe of [{}, { id: null }, { id: "  " }]) {
    const { adapter, page } = setup(t);
    const record = await adapter.readConversation("fixture-chat-1");
    page.emit("response", { url: () => "https://chatgpt.com/backend-api/me", status: () => 200,
      request: () => ({ headerValue: async () => "synthetic-workspace-id" }), json: async () => invalidMe });
    await assert.rejects(adapter.getAccountFingerprint(), /login|account context/i);
    await assert.rejects(adapter.readConversation("fixture-chat-1"), /login|account context/i);
    await assert.rejects(adapter.discoverConversations({ max: 1 }), /login|account context/i);
    await assert.rejects(adapter.login({ timeoutMs: 0 }), /login/i);
    page.waitForTimeout = async () => {
      page.emit("response", { url: () => "https://chatgpt.com/backend-api/me", status: () => 200,
        request: () => ({ headerValue: async () => "synthetic-workspace-id" }), json: async () => ({ id: "fixture-account" }) });
    };
    await adapter.login();
    assert.deepEqual(await adapter.readConversation("fixture-chat-1"), record);
  }
});

test("legacy --all wrapper verifies the current account even when every checkpoint is complete", async (t) => {
  const { adapter, paths, page } = setup(t);
  await adapter.readConversation("fixture-chat-1");
  fs.writeFileSync(path.join(paths.raw, "conversations.json"), JSON.stringify([{ provider: "chatgpt", conversationId: "fixture-chat-1" }]));
  page.emit("response", { url: () => "https://chatgpt.com/backend-api/me", status: () => 200,
    request: () => ({ headerValue: async () => "synthetic-workspace-id" }), json: async () => ({}) });
  await assert.rejects(readWrapper(["--all"], { paths, adapter }), /login|account context/i);
});

test("a delayed old native me response cannot restore identity after a newer empty response", async (t) => {
  const { adapter, page } = setup(t);
  await adapter.getAccountFingerprint();
  let resolveOld;
  page.emit("response", { url: () => "https://chatgpt.com/backend-api/me", status: () => 200,
    request: () => ({ headerValue: async () => "synthetic-workspace-id" }),
    json: () => new Promise((resolve) => { resolveOld = resolve; }) });
  page.emit("response", { url: () => "https://chatgpt.com/backend-api/me", status: () => 200,
    request: () => ({ headerValue: async () => "synthetic-workspace-id" }), json: async () => ({}) });
  while (!resolveOld) await new Promise((resolve) => setImmediate(resolve));
  resolveOld({ id: "fixture-account" });
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

test("lists Projects from the complete native sidebar response when the DOM region is absent", async (t) => {
  const { adapter, page, projectUI } = setup(t);
  projectUI.regions = 0;
  await adapter.open();
  page.emit("response", {
    url: () => "https://chatgpt.com/backend-api/gizmos/snorlax/sidebar",
    status: () => 200,
    json: async () => ({ cursor: null, items: [
      { gizmo: { gizmo: { id: "g-p-fixture-native", is_archived: false,
        current_user_permission: { can_read: true }, display: { name: "  Native  Project  " } } } },
    ] }),
  });

  assert.deepEqual(await adapter.listProjects(), [
    { name: "Native  Project", url: "https://chatgpt.com/g/g-p-fixture-native/project" },
  ]);
});

test("rejects unknown native Project sidebar item shapes instead of omitting them", async (t) => {
  for (const item of [
    {},
    { gizmo: { gizmo: { id: "g-p-fixture-native", is_archived: false,
      display: { name: "Native Project" } } } },
  ]) {
    const { adapter, page, projectUI } = setup(t);
    projectUI.regions = 0;
    await adapter.open();
    page.emit("response", {
      url: () => "https://chatgpt.com/backend-api/gizmos/snorlax/sidebar",
      status: () => 200,
      json: async () => ({ cursor: null, items: [item] }),
    });

    await assert.rejects(adapter.listProjects(), /malformed|unsupported/i);
  }
});

test("reloads the page to capture the native Project sidebar when initial loading did not emit it", async (t) => {
  const { adapter, page, projectUI } = setup(t);
  projectUI.regions = 0;
  const evaluate = page.evaluate;
  page.evaluate = async (fn, arg) => {
    if (arg?.command === "refreshProjects") throw new Error("Direct Project fetch must not be used");
    return evaluate(fn, arg);
  };
  let reloaded = false;
  let emitted = false;
  let waits = 0;
  page.reload = async () => { reloaded = true; };
  page.waitForTimeout = async () => {
    if (reloaded && !emitted && ++waits >= 5) {
      emitted = true;
      page.emit("response", {
        url: () => "https://chatgpt.com/backend-api/gizmos/snorlax/sidebar",
        status: () => 200,
        json: async () => ({ cursor: null, items: [] }),
      });
    }
  };

  assert.deepEqual(await adapter.listProjects(), []);
});

test("closing and reopening cannot reuse native identity or Project evidence", async (t) => {
  const { adapter, page, projectUI } = setup(t);
  projectUI.regions = 0;
  await adapter.open();
  page.emit("response", {
    url: () => "https://chatgpt.com/backend-api/gizmos/snorlax/sidebar",
    status: () => 200,
    json: async () => ({ cursor: null, items: [{ gizmo: { gizmo: {
      id: "g-p-fixture-native", is_archived: false,
      current_user_permission: { can_read: true }, display: { name: "Native Project" },
    } } }] }),
  });
  assert.equal((await adapter.listProjects()).length, 1);

  await adapter.close();
  await assert.rejects(adapter.listProjects(), /Project region|missing|uncertain/i);
});

test("Project listing excludes CSS-hidden entries", async (t) => {
  const { adapter, projectUI } = setup(t);
  projectUI.entries = [
    { name: "Visible synthetic project", url: "https://chatgpt.com/g/g-p-fixture-visible/project" },
    { name: "Hidden synthetic project", url: "https://chatgpt.com/g/g-p-fixture-hidden/project", visibility: "hidden" },
  ];
  assert.deepEqual(await adapter.listProjects(), [{ name: "Visible synthetic project", url: "https://chatgpt.com/g/g-p-fixture-visible/project" }]);
});

test("accepts an empty Projects inventory only with a stable explicit bilingual empty state", async (t) => {
  for (const status of ["No projects yet", "暂无项目"]) {
    const { adapter, projectUI } = setup(t);
    projectUI.entries = [];
    projectUI.status = status;
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
  ["expanded but unrendered empty region", { entries: [], expanded: "true" }],
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
  const evaluate = page.evaluate;
  let projectObservations = 0;
  page.evaluate = async (fn, arg) => {
    const result = await evaluate(fn, arg);
    if (arg?.selectors && arg?.noProjects && ++projectObservations === 1) {
      projectUI.entries[0].name = "Changed synthetic name";
    }
    return result;
  };
  await assert.rejects(adapter.listProjects(), /project.*changed|unstable/i);
});

test("Project listing stops on authentication loss during observation", async (t) => {
  const { adapter, page } = setup(t);
  page.waitForTimeout = async () => {
    page.emit("response", { url: () => "https://chatgpt.com/backend-api/me", status: () => 200,
      request: () => ({ headerValue: async () => "synthetic-workspace-id" }), json: async () => ({}) });
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

test("successful discover persists a new verified run state and advances only through DISCOVER", async (t) => {
  const { adapter, paths } = setup(t);
  const output = { write() {} };
  assert.equal(await main(["discover", "--max", "1"], { adapter, paths, stdout: output, stderr: output }), 0);
  const state = loadRunState(paths);
  assert.match(state.runId, /^[0-9a-f-]{36}$/i);
  assert.match(state.accountFingerprint, /^[a-f0-9]{16}$/);
  assert.match(state.workspaceFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(state.workspaceFingerprint, JSON.parse(fs.readFileSync(path.join(paths.state, "account.json"))).workspaceFingerprint);
  assert.equal(state.phase, "DISCOVER");
});

test("discovery binds verified native workspace identity without a display marker", async (t) => {
  const { adapter, paths } = setup(t, { workspaceMarkers: [] });
  const output = { write() {} };
  assert.equal(await main(["discover", "--max", "1"], { adapter, paths, stdout: output, stderr: output }), 0);
  assert.match(loadRunState(paths).workspaceFingerprint, /^[a-f0-9]{64}$/);
});

test("successful discover resumes AUTHENTICATE without rewinding a later phase", async (t) => {
  const { adapter, paths } = setup(t);
  const output = { write() {} };
  const fingerprint = require("node:crypto").createHash("sha256").update("fixture-account").digest("hex").slice(0, 16);
  const state = createRunState("existing-run", fingerprint);
  state.phase = "AUTHENTICATE";
  saveRunState(paths, state);
  assert.equal(await main(["discover", "--max", "1"], { adapter, paths, stdout: output, stderr: output }), 0);
  assert.equal(loadRunState(paths).runId, "existing-run");
  assert.equal(loadRunState(paths).phase, "DISCOVER");
});

test("discover preserves the exact prior Projects inventory when an expanded region has no empty-state marker", async (t) => {
  const { adapter, paths, projectUI } = setup(t);
  projectUI.entries = [];
  projectUI.expanded = "true";
  projectUI.status = "";
  const target = path.join(paths.raw, "projects.json");
  const prior = '[\n  {"name":"Synthetic prior","url":"https://chatgpt.com/g/g-p-fixture-prior/project"}\n]\n';
  fs.mkdirSync(paths.raw, { recursive: true });
  fs.writeFileSync(target, prior);
  const output = { write() {} };
  assert.equal(await main(["discover", "--max", "1"], { adapter, paths, stdout: output, stderr: output }), 1);
  assert.equal(fs.readFileSync(target, "utf8"), prior);
  assert.equal(fs.existsSync(`${target}.tmp`), false);
});

function writeSetup(t, changes = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "organizer-write-adapter-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const paths = createPaths(root);
  const page = new EventEmitter();
  const state = {
    url: "https://chatgpt.com/",
    safety: { url: "https://chatgpt.com/", text: "", workspaceMarkers: ["Personal"] },
    projects: [{ name: "Work", url: "https://chatgpt.com/g/g-p-work/project" }],
    currentProject: null,
    archived: false,
    renderedConversation: true,
    emitConversationResponse: true,
    controls: { create: 1, createSubmit: 1, header: 1, move: 1, archive: 1, destination: 1 },
    controlText: { create: "新项目", createSubmit: "创建项目", header: "打开对话选项", move: "移至项目", archive: "归档" },
    requiredSelectorFragment: { create: 'button[aria-label="新项目"]', createSubmit: '[role="dialog"] button' },
    clicks: [],
    submittedProject: null,
    confirmCreate: true,
    confirmMove: true,
    confirmArchive: true,
    refreshIdentity: true,
    identityRefreshes: 0,
    accountId: "fixture-write-account",
    workspaceId: "synthetic-write-workspace-id",
    ...changes,
  };
  page.url = () => state.url;
  page.waitForTimeout = async () => {};
  page.on = page.on.bind(page);
  page.off = page.off.bind(page);
  page.evaluate = async (_fn, arg) => {
    if (typeof arg === "string" && arg.startsWith("https://chatgpt.com/c/")) {
      state.url = arg;
      state.safety.url = arg;
      if (state.emitConversationResponse) {
        const id = arg.slice("https://chatgpt.com/c/".length);
        const request = { url: () => `https://chatgpt.com/backend-api/conversation/${id}` };
        page.emit("request", request);
        page.emit("response", {
          url: () => `https://chatgpt.com/backend-api/conversation/${id}`,
          status: () => 200,
          request: () => request,
          json: async () => ({ id }),
        });
      }
      if (state.emitStaleConversationResponse) {
        const id = arg.slice("https://chatgpt.com/c/".length);
        page.emit("response", {
          url: () => `https://chatgpt.com/backend-api/conversation/${id}`,
          status: () => 200,
          request: () => ({ url: () => `https://chatgpt.com/backend-api/conversation/${id}` }),
        });
      }
      return;
    }
    if (arg?.command === "safety") return { ...state.safety, url: state.url };
    if (arg?.command === "workspaceContext") return { url: state.url, markers: state.safety.workspaceMarkers, nativeIdentity: "synthetic-write-workspace-id" };
    if (arg?.command === "targetConversation") {
      const rendered = Array.isArray(state.targetObservations)
        ? state.targetObservations.shift()
        : state.renderedConversation;
      return { url: state.url, rendered: Boolean(rendered), markerCount: rendered ? 1 : 0 };
    }
    if (arg?.command === "conversationState") {
      const broadProject = arg.selectors.conversationProject.includes("main a[") ? state.broadProject : null;
      const broadArchived = arg.selectors.archivedState.includes('[role="status"]') ? state.genericArchivedStatus : false;
      return {
        url: state.url,
        projectNames: state.currentProject ? [state.currentProject] : broadProject ? [broadProject] : [],
        archived: state.archived || Boolean(broadArchived),
      };
    }
    if (arg?.command === "setProjectName") {
      state.submittedProject = arg.value;
      return { count: 1 };
    }
    if (arg?.command === "click") {
      if (state.requiredSelectorFragment[arg.control]
        && !arg.selector.includes(state.requiredSelectorFragment[arg.control])) {
        return { count: 0, destructive: false };
      }
      const count = arg.exactText === undefined
        ? (new RegExp(arg.pattern, "i").test(state.controlText[arg.control]) ? state.controls[arg.control] : 0)
        : state.controls.destination;
      if (count !== 1) return { count, destructive: false };
      if (state.destructiveMatch === true && arg.control === "archive") return { count, destructive: true };
      state.clicks.push(arg.exactText === undefined ? arg.control : `destination:${arg.exactText}`);
      if (state.stopAfterClick === arg.control) state.safety.text = "Verify you are human";
      if (state.changeMarkerAfterClick === arg.control) state.safety.workspaceMarkers = ["Other workspace"];
      if (arg.control === "createSubmit" && state.confirmCreate) {
        state.projects.push({ name: state.submittedProject, url: "https://chatgpt.com/g/g-p-created/project" });
      }
      if (arg.control === "destination" && state.confirmMove) state.currentProject = arg.exactText;
      if (arg.control === "archive" && state.confirmArchive) state.archived = true;
      return { count: 1, destructive: false };
    }
    if (arg?.selectors && arg?.noProjects && arg?.moreProjects) {
      return {
        url: state.url,
        uncertain: false,
        emptyState: state.projects.length === 0,
        entries: state.projects,
      };
    }
    if (arg?.selectors && arg?.login) return { loggedIn: true, loginRequired: false, restricted: false };
    throw new Error(`Unexpected fake-page evaluation: ${JSON.stringify(arg)}`);
  };
  const emitIdentity = () => {
    const workspaceRequest = { headerValue: async (name) => name === "chatgpt-account-id" ? state.workspaceId : null };
    page.emit("response", {
      url: () => "https://chatgpt.com/backend-api/me",
      status: () => 200,
      request: () => workspaceRequest,
      json: async () => ({ id: state.accountId }),
    });
    page.emit("response", {
      url: () => "https://chatgpt.com/backend-api/wham/accounts/check",
      status: () => 200,
      request: () => workspaceRequest,
      json: async () => ({ default_account_id: state.workspaceId,
        accounts: [{ id: state.workspaceId, can_access_with_session: true }] }),
    });
  };
  page.reload = async () => {
    state.identityRefreshes++;
    if (state.refreshIdentity) emitIdentity();
    if (state.nativeProjectsOnRefresh) page.emit("response", {
      url: () => "https://chatgpt.com/backend-api/gizmos/snorlax/sidebar",
      status: () => 200,
      json: async () => ({ cursor: null, items: state.projects.map((project) => ({ gizmo: { gizmo: {
        id: new URL(project.url).pathname.split("/")[2], is_archived: false,
        current_user_permission: { can_read: true }, display: { name: project.name },
      } } })) }),
    });
  };
  const browser = {
    launch: async () => page,
    goto: async () => {
      page.emit("response", {
        url: () => "https://chatgpt.com/api/auth/session",
        status: () => 200,
        json: async () => ({ user: { id: state.accountId } }),
      });
      emitIdentity();
    },
    close: async () => {},
  };
  const adapter = new ChatGPTAdapter({ paths, browser });
  t.after(() => adapter.close());
  return { adapter, state };
}

test("write adapter requires exact, unique Project and menu matches", async (t) => {
  const duplicate = writeSetup(t, { controls: { create: 1, createSubmit: 1, header: 1, move: 1, archive: 1, destination: 2 } });
  assert.equal((await duplicate.adapter.moveConversation("fixture-chat", "Work")).status, "selector_missing");
  assert.deepEqual(duplicate.state.clicks, ["header", "move"]);

  const missing = writeSetup(t, { controls: { create: 1, createSubmit: 1, header: 1, move: 0, archive: 1, destination: 1 } });
  assert.equal((await missing.adapter.moveConversation("fixture-chat", "Work")).status, "selector_missing");
  assert.deepEqual(missing.state.clicks, ["header"]);
});

test("safety stops are typed and happen before any write click", async (t) => {
  for (const [text, expected] of [
    ["Too many requests", "rate_limited"],
    ["Verify you are human", "access_restricted"],
  ]) {
    const { adapter, state } = writeSetup(t, { safety: { url: "https://chatgpt.com/", text, workspaceMarkers: ["Personal"] } });
    assert.equal((await adapter.createProject("Research")).status, expected);
    assert.deepEqual(state.clicks, []);
  }

  const loggedOut = writeSetup(t, { safety: {
    url: "https://chatgpt.com/", text: "", workspaceMarkers: [], loginRequired: true,
  } });
  assert.equal((await loggedOut.adapter.createProject("Research")).status, "access_restricted");
  assert.deepEqual(loggedOut.state.clicks, []);

  const postClick = writeSetup(t, { projects: [], stopAfterClick: "create" });
  assert.equal((await postClick.adapter.createProject("Research")).status, "access_restricted");
  assert.deepEqual(postClick.state.clicks, ["create"]);
});

test("cached identity cannot authorize a write without a fresh native refresh", async (t) => {
  const { adapter, state } = writeSetup(t, { projects: [], refreshIdentity: false });
  assert.equal((await adapter.createProject("Research")).status, "access_restricted");
  assert.equal(state.identityRefreshes, 1);
  assert.deepEqual(state.clicks, []);
});

test("a workspace marker change during a write stops before the next click", async (t) => {
  const { adapter, state } = writeSetup(t, { projects: [], changeMarkerAfterClick: "create" });
  assert.equal((await adapter.createProject("Research")).status, "access_restricted");
  assert.deepEqual(state.clicks, ["create"]);
});

test("Project creation is exact, idempotent, and verified from the sidebar", async (t) => {
  const existing = writeSetup(t);
  assert.deepEqual(await existing.adapter.createProject("Work"), { status: "verified", evidence: "Project already exists" });
  assert.deepEqual(existing.state.clicks, []);

  const created = writeSetup(t, { projects: [] });
  assert.equal((await created.adapter.createProject("Research")).status, "verified");
  assert.deepEqual(created.state.clicks, ["create", "createSubmit"]);
  assert.equal(created.state.submittedProject, "Research");

  const uncertain = writeSetup(t, { projects: [], confirmCreate: false });
  assert.equal((await uncertain.adapter.createProject("Research")).status, "uncertain");
});

test("Project creation refreshes a previously captured native snapshot before verification", async (t) => {
  const { adapter, state } = writeSetup(t, { projects: [], nativeProjectsOnRefresh: true });
  assert.equal((await adapter.createProject("Research")).status, "verified");
  assert.ok(state.identityRefreshes >= 2);
  assert.deepEqual(state.clicks, ["create", "createSubmit"]);
});

test("move and archive return verified only after observable final-state confirmation", async (t) => {
  const moved = writeSetup(t);
  assert.equal((await moved.adapter.moveConversation("fixture-chat", "Work")).status, "verified");
  assert.equal((await moved.adapter.verifyConversationLocation("fixture-chat", { kind: "project", name: "Work" })).status, "verified");

  const alreadyMoved = writeSetup(t, { currentProject: "Work" });
  assert.equal((await alreadyMoved.adapter.moveConversation("fixture-chat", "Work")).status, "verified");
  assert.deepEqual(alreadyMoved.state.clicks, []);

  const moveUncertain = writeSetup(t, { confirmMove: false });
  assert.equal((await moveUncertain.adapter.moveConversation("fixture-chat", "Work")).status, "uncertain");

  const archived = writeSetup(t);
  assert.equal((await archived.adapter.archiveConversation("fixture-chat")).status, "verified");
  assert.equal((await archived.adapter.verifyConversationLocation("fixture-chat", { kind: "archived" })).status, "verified");

  const alreadyArchived = writeSetup(t, { archived: true });
  assert.equal((await alreadyArchived.adapter.archiveConversation("fixture-chat")).status, "verified");
  assert.deepEqual(alreadyArchived.state.clicks, []);

  const archiveUncertain = writeSetup(t, { confirmArchive: false });
  assert.equal((await archiveUncertain.adapter.archiveConversation("fixture-chat")).status, "uncertain");
});

test("conversation writes require fresh target response and two stable rendered observations", async (t) => {
  const stale = writeSetup(t, { currentProject: "Work", emitConversationResponse: false });
  assert.equal((await stale.adapter.moveConversation("fixture-chat", "Work")).status, "uncertain");
  assert.deepEqual(stale.state.clicks, []);

  const delayedPriorRequest = writeSetup(t, { currentProject: "Work", emitConversationResponse: false, emitStaleConversationResponse: true });
  assert.equal((await delayedPriorRequest.adapter.moveConversation("fixture-chat", "Work")).status, "uncertain");
  assert.deepEqual(delayedPriorRequest.state.clicks, []);

  const missingMarker = writeSetup(t, { renderedConversation: false });
  assert.equal((await missingMarker.adapter.archiveConversation("fixture-chat")).status, "uncertain");
  assert.deepEqual(missingMarker.state.clicks, []);

  const unstable = writeSetup(t, { targetObservations: [true, false] });
  assert.equal((await unstable.adapter.moveConversation("fixture-chat", "Work")).status, "uncertain");
  assert.deepEqual(unstable.state.clicks, []);
});

test("message Project links and generic status text cannot verify ownership or archive state", async (t) => {
  const broadProject = writeSetup(t, { broadProject: "Work", confirmMove: false });
  assert.equal((await broadProject.adapter.moveConversation("fixture-chat", "Work")).status, "uncertain");

  const broadArchive = writeSetup(t, { genericArchivedStatus: true, confirmArchive: false });
  assert.equal((await broadArchive.adapter.archiveConversation("fixture-chat")).status, "uncertain");
});

test("write safety rejects missing or multiple markers without treating a label change as an identity change", async (t) => {
  for (const markers of [[], ["One", "Two"]]) {
    const fixture = writeSetup(t, { safety: { url: "https://chatgpt.com/", text: "", workspaceMarkers: markers } });
    assert.equal((await fixture.adapter.createProject("Research")).status, "uncertain");
    assert.deepEqual(fixture.state.clicks, []);
  }

  const changed = writeSetup(t);
  await changed.adapter.getAccountFingerprint();
  changed.state.safety.workspaceMarkers = ["Changed synthetic workspace"];
  assert.equal((await changed.adapter.createProject("Research")).status, "verified");
  assert.deepEqual(changed.state.clicks, ["create", "createSubmit"]);
});

test("write adapter rejects invalid identifiers and destructive matched controls", async (t) => {
  const { adapter } = writeSetup(t);
  await assert.rejects(adapter.moveConversation("../outside", "Work"), /conversation ID/i);
  await assert.rejects(adapter.createProject("  "), /Project name/i);
  const destructive = writeSetup(t, { destructiveMatch: true });
  assert.equal((await destructive.adapter.archiveConversation("fixture-chat")).status, "selector_missing");
  assert.deepEqual(destructive.state.clicks, ["header"]);
  assert.equal(typeof adapter.removeConversation, "undefined");
});

test("a Project named archived cannot collide with archive state", async (t) => {
  const moved = writeSetup(t, { currentProject: "archived" });
  assert.equal((await moved.adapter.verifyConversationLocation("fixture-chat", { kind: "project", name: "archived" })).status, "verified");
  assert.equal((await moved.adapter.verifyConversationLocation("fixture-chat", { kind: "archived" })).status, "uncertain");
  const archived = writeSetup(t, { archived: true, confirmMove: false });
  assert.equal((await archived.adapter.moveConversation("fixture-chat", "archived")).status, "uncertain");
  assert.deepEqual(archived.state.clicks, ["header", "move", "destination:archived"]);
});

test("read rejects stale nodes without a fresh successful full-ID detail response", async (t) => {
  for (const status of [null, 503]) {
    const { adapter, paths, page } = setup(t, { emitDetail: false });
    const evaluate = page.evaluate;
    page.evaluate = async (fn, arg) => {
      const result = await evaluate(fn, arg);
      if (typeof arg === "string" && status !== null) {
        const request = { url: () => "https://chatgpt.com/backend-api/conversation/fixture-stale" };
        page.emit("request", request);
        page.emit("response", { url: request.url, request: () => request, status: () => status });
      }
      return result;
    };
    await assert.rejects(adapter.readConversation("fixture-stale"), /fresh|response|load|snapshot/i);
    assert.equal(fs.existsSync(path.join(paths.raw, "conversations", "fixture-stale.json")), false);
  }
});

test("account state writer cannot follow a planted temporary symlink", (t) => {
  const { adapter, paths } = setup(t);
  fs.mkdirSync(paths.state, { recursive: true });
  const victim = path.join(paths.root, "victim");
  fs.writeFileSync(victim, "unchanged");
  fs.symlinkSync(victim, path.join(paths.state, "account.json.tmp"));
  adapter.writeJson(path.join(paths.state, "account.json"), { synthetic: true });
  assert.equal(fs.readFileSync(victim, "utf8"), "unchanged");
});

test("workspace display labels alone cannot establish unique identity", async (t) => {
  const { adapter } = setup(t, { nativeIdentity: null });
  await assert.rejects(adapter.getAccountFingerprint(), /unique|identity|unavailable/i);
});

test("distinct native workspace IDs with the same label produce different bindings", async (t) => {
  const first = setup(t, { nativeIdentity: "synthetic-id-a" }).adapter;
  const second = setup(t, { nativeIdentity: "synthetic-id-b" }).adapter;
  await first.getAccountFingerprint();
  await second.getAccountFingerprint();
  assert.notEqual(first.workspaceFingerprint, second.workspaceFingerprint);
});

test("read waits for delayed complete rendering and does not save a stable partial render", async (t) => {
  for (const eventuallyComplete of [false, true]) {
    const { adapter, paths, page } = setup(t);
    const evaluate = page.evaluate;
    let snapshots = 0;
    page.evaluate = async (fn, arg) => {
      const value = await evaluate(fn, arg);
      if (value?.messages && (!eventuallyComplete || snapshots++ < 3)) value.messages = [{ role: "user", text: "Synthetic" }];
      return value;
    };
    if (eventuallyComplete) {
      const record = await adapter.readConversation("fixture-render");
      assert.equal(record.messages[0].text, "Synthetic message");
      assert.ok(snapshots >= 5);
    } else {
      await assert.rejects(adapter.readConversation("fixture-render"), /incomplete|render|snapshot/i);
      assert.equal(fs.existsSync(path.join(paths.raw, "conversations", "fixture-render.json")), false);
    }
  }
});

test("unfinished native message rejects stable partial DOM and never creates a reusable checkpoint", async (t) => {
  const id = "fixture-native-in-progress";
  const expectedMessages = [{ role: "user", text: "Synthetic question" }, { role: "assistant", text: "Partial answer" }];
  const { adapter, paths, page, setMessages } = setup(t, { detailJson: (conversationId) => ({
    conversation_id: conversationId, current_node: "assistant", mapping: {
      user: { parent: null, message: { author: { role: "user" }, status: "finished_successfully",
        content: { content_type: "text", parts: ["Synthetic question"] } } },
      assistant: { parent: "user", message: { author: { role: "assistant" }, status: "in_progress", end_turn: false,
        content: { content_type: "text", parts: ["Partial answer"] } } },
    },
  }) });
  setMessages(expectedMessages.map(({ role, text }) => ({ getAttribute: () => role, querySelector: () => null, innerText: text })));
  const evaluate = page.evaluate;
  const snapshots = [];
  let navigations = 0;
  page.evaluate = async (fn, arg) => {
    if (typeof arg === "string") navigations++;
    const result = await evaluate(fn, arg);
    if (result?.messages) snapshots.push(result);
    return result;
  };
  for (let i = 0; i < 2; i++) {
    await page.evaluate(({ selectors }) => ({
      busy: !!document.querySelector('[aria-busy="true"], [data-is-streaming="true"]'),
      messages: [...document.querySelectorAll(selectors.messageRoles)].map((node) => ({
        role: node.getAttribute("data-message-author-role"), text: node.innerText.trim(),
      })),
    }), { selectors });
  }
  const target = path.join(paths.raw, "conversations", `${id}.json`);
  await assert.rejects(adapter.readConversation(id), /incomplete|snapshot/i);
  assert.ok(snapshots.length >= 2);
  assert.ok(snapshots.every((snapshot) => snapshot.busy === false &&
    JSON.stringify(snapshot.messages) === JSON.stringify(expectedMessages)));
  assert.equal(fs.existsSync(target), false);
  await assert.rejects(adapter.readConversation(id), /incomplete|snapshot/i);
  assert.equal(navigations, 2);
  assert.equal(fs.existsSync(target), false);
});

test("completed native branch extracts user and assistant and reuses its checkpoint", async (t) => {
  const id = "fixture-native-complete";
  const expectedMessages = [{ role: "user", text: "Synthetic question" }, { role: "assistant", text: "Complete answer" }];
  const { adapter, paths, page, setMessages } = setup(t, { detailJson: (conversationId) => ({
    conversation_id: conversationId, current_node: "assistant", mapping: {
      user: { parent: null, message: { author: { role: "user" }, status: "finished_successfully",
        content: { content_type: "text", parts: ["Synthetic question"] } } },
      assistant: { parent: "user", message: { author: { role: "assistant" }, status: "finished_successfully", end_turn: true,
        content: { content_type: "text", parts: ["Complete answer"] } } },
    },
  }) });
  setMessages(expectedMessages.map(({ role, text }) => ({ getAttribute: () => role, querySelector: () => null, innerText: text })));
  const record = await adapter.readConversation(id);
  assert.deepEqual(record.messages, expectedMessages);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(paths.raw, "conversations", `${id}.json`))), record);
  const evaluate = page.evaluate;
  page.evaluate = async (fn, arg) => {
    if (typeof arg === "string") throw new Error("Completed checkpoint must be reused");
    return evaluate(fn, arg);
  };
  assert.deepEqual(await adapter.readConversation(id), record);
});

test("fresh discovery and read wrapper produce actual first-pass messages before classification", async (t) => {
  const { adapter, paths } = setup(t);
  const output = { write() {} };
  assert.equal(await main(["discover", "--max", "1"], { adapter, paths, stdout: output, stderr: output }), 0);
  assert.equal(fs.existsSync(path.join(paths.raw, "conversations")), false);
  assert.equal(await main(["plan"], { paths, rootDir: paths.root, stdout: output, stderr: output }), 0);
  assert.equal(await main(["plan"], { paths, rootDir: paths.root, stdout: output, stderr: output }), 1);
  await readWrapper(["--all"], { adapter, paths });
  assert.equal(await main(["plan"], { paths, rootDir: paths.root, stdout: output, stderr: output }), 0);
  const input = JSON.parse(fs.readFileSync(path.join(paths.plans, "classification-input.jsonl"), "utf8"));
  assert.equal(input.firstUserMessage, "Synthetic message");
  assert.equal(input.lastUserMessage, "Synthetic message");
  assert.equal(loadRunState(paths).phase, "CLASSIFY");
});
