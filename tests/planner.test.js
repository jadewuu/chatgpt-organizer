const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const YAML = require("yaml");

const {
  buildClassificationInput,
  buildMigrationPlan,
  hashPlan,
} = require("../src/core/planner");
const { createPaths } = require("../src/core/paths");
const { createRunState, saveRunState } = require("../src/core/state");
const { run } = require("../src/commands/plan");

const config = {
  provider: "chatgpt",
  classification: { moveThreshold: 0.95, fullContentBelow: 0.9, maxExcerptCodePoints: 4 },
  taxonomy: { projects: [{ name: "Work", description: "Work", include: [], exclude: [] }] },
};
const conversations = [{
  provider: "chatgpt",
  conversationId: "fixture-chat-1",
  title: "Synthetic chat",
  createdAt: 1,
  updatedAt: 2,
  currentProject: null,
  url: "https://chatgpt.com/c/fixture-chat-1",
}];
const extracted = [{
  provider: "chatgpt",
  conversationId: "fixture-chat-1",
  messages: [
    { role: "user", text: "😀 first user" },
    { role: "assistant", text: "answer" },
    { role: "user", text: "last user" },
  ],
}];

test("classification input uses first and last user messages and gates extra excerpts", () => {
  const firstPass = buildClassificationInput(conversations, extracted, config);
  assert.deepEqual(firstPass[0], {
    conversationId: "fixture-chat-1",
    title: "Synthetic chat",
    createdAt: 1,
    updatedAt: 2,
    firstUserMessage: "😀 fi",
    lastUserMessage: "last",
  });

  const gated = buildClassificationInput(conversations, extracted, config, {
    allowFullContent: true,
    priorClassifications: [{ conversationId: "fixture-chat-1", confidence: 0.89 }],
  });
  assert.deepEqual(gated[0].excerpts, [{ role: "assistant", text: "answ" }]);
  assert.equal(Object.hasOwn(gated[0], "messages"), false);
});

test("extra excerpts stay hidden for high-confidence prior classifications", () => {
  const input = buildClassificationInput(conversations, extracted, config, {
    allowFullContent: true,
    priorClassifications: [{ conversationId: "fixture-chat-1", confidence: 0.9 }],
  });
  assert.equal(Object.hasOwn(input[0], "excerpts"), false);
});

test("confidence below threshold stays unresolved and is not archived", () => {
  const plan = buildMigrationPlan(conversations, [{
    conversationId: "fixture-chat-1", project: "Work", confidence: 0.94,
    reason: "Possible work topic", suggestedAction: "move",
  }], config, [], { now: () => new Date("2026-09-12T00:00:00.000Z") });
  assert.equal(plan.items[0].status, "unresolved");
  assert.equal(plan.items[0].action, "keep");
});

test("threshold equality is eligible for a move", () => {
  const plan = buildMigrationPlan(conversations, [{
    conversationId: "fixture-chat-1", project: "Work", confidence: 0.95,
    reason: "Certain work topic", suggestedAction: "move",
  }], config, [], { now: "2026-09-12T00:00:00.000Z" });
  assert.equal(plan.items[0].status, "proposed");
  assert.equal(plan.items[0].action, "move");
});

test("archive requires an independent archive reason", () => {
  assert.throws(() => buildMigrationPlan(conversations, [{
    conversationId: "fixture-chat-1", project: null, confidence: 0.99,
    reason: "No matching project", suggestedAction: "archive",
  }], config), /archive reason/);
});

test("rejects missing, duplicate, and unknown classification IDs", () => {
  const item = { conversationId: "fixture-chat-1", project: "Work", confidence: 0.99, reason: "r", suggestedAction: "move" };
  assert.throws(() => buildMigrationPlan(conversations, [], config), /missing classification/i);
  assert.throws(() => buildMigrationPlan(conversations, [item, item], config), /duplicate/i);
  assert.throws(() => buildMigrationPlan(conversations, [item, { ...item, conversationId: "unknown" }], config), /unknown/i);
});

test("detects existing Projects by exact name", () => {
  const plan = buildMigrationPlan(conversations, [{
    conversationId: "fixture-chat-1", project: "Work", confidence: 0.99,
    reason: "r", suggestedAction: "move",
  }], config, [{ name: "Work" }, { name: "Workspace" }]);
  assert.deepEqual(plan.projects, [{ name: "Work", exists: true, createRequired: false, proposedConversationCount: 1 }]);
});

test("hashPlan is canonical and excludes only the root planHash", () => {
  const plan = { provider: "chatgpt", generatedAt: "x", taxonomyHash: "t", projects: [], items: [], nested: { z: 1, a: 2 } };
  const withHash = { ...plan, planHash: "stale" };
  assert.equal(hashPlan(plan), hashPlan(withHash));
  assert.notEqual(hashPlan({ ...plan, projects: ["x"] }), hashPlan(plan));
});

test("plan command seeds taxonomy, then writes bounded artifacts and reaches PLAN_REVIEW only", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-organizer-plan-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const paths = createPaths(root);
  fs.mkdirSync(paths.raw, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(paths.raw, "conversations.json"), `${JSON.stringify(conversations)}\n`);
  fs.mkdirSync(path.join(paths.raw, "conversations"), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(paths.raw, "conversations", "fixture-chat-1.json"), `${JSON.stringify(extracted[0])}\n`);
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  fs.writeFileSync(path.join(root, "config", "organizer.example.yaml"), YAML.stringify(config));
  const output = { chunks: [], write(value) { this.chunks.push(value); } };

  const seeded = await run([], { rootDir: root, paths, stdout: output });
  assert.equal(seeded, 0);
  assert.match(output.chunks.at(-1), /customize|approve/i);
  assert.equal(fs.existsSync(path.join(paths.plans, "taxonomy.yaml")), true);

  const state = createRunState("run", "account");
  state.phase = "TAXONOMY_REVIEW";
  saveRunState(paths, state);
  const inputResult = await run([], { rootDir: root, paths, stdout: output });
  assert.equal(inputResult, 0);
  assert.match(output.chunks.at(-1), /classifications/i);
  assert.equal(fs.existsSync(path.join(paths.plans, "classification-input.jsonl")), true);

  fs.writeFileSync(path.join(paths.plans, "classifications.json"), JSON.stringify([{
    conversationId: "fixture-chat-1", project: "Work", confidence: 0.99, reason: "r", suggestedAction: "move",
  }]));
  state.phase = "CLASSIFY";
  saveRunState(paths, state);
  const planResult = await run([], { rootDir: root, paths, stdout: output, now: "2026-09-12T00:00:00.000Z" });
  assert.equal(planResult, 0);
  assert.match(output.chunks.at(-1), /PLAN_REVIEW/i);
  assert.equal(JSON.parse(fs.readFileSync(path.join(paths.plans, "migration-plan.json"))).provider, "chatgpt");
  assert.equal(JSON.parse(fs.readFileSync(path.join(paths.state, "run.json"))).phase, "PLAN_REVIEW");
  assert.equal(fs.existsSync(path.join(paths.plans, "migration-plan.json.tmp")), false);
});
