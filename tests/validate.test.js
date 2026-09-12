const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  validateTaxonomy,
  validateClassifications,
  validateMigrationPlan,
} = require("../src/core/validate");

const taxonomy = {
  projects: [{
    name: "Work",
    description: "Ongoing professional work and decisions.",
    include: [],
    exclude: [],
  }],
};

const classification = {
  conversationId: "fixture-chat-1",
  project: "Work",
  confidence: 0.97,
  reason: "Synthetic reason",
  suggestedAction: "move",
};

function migrationPlan(item) {
  return {
    provider: "chatgpt",
    generatedAt: "2026-09-12T00:00:00.000Z",
    taxonomyHash: "sha256-fixture-taxonomy",
    projects: [{
      name: "Work",
      exists: false,
      createRequired: true,
      proposedConversationCount: 1,
    }],
    items: [item],
    planHash: "sha256-fixture-plan",
  };
}

function migrationItem(overrides = {}) {
  return {
    ...classification,
    title: "Synthetic chat",
    url: "https://chatgpt.com/c/fixture-chat-1",
    currentProject: null,
    action: "move",
    status: "proposed",
    ...overrides,
  };
}

test("accepts the synthetic taxonomy and classifications", () => {
  validateTaxonomy(taxonomy);
  validateClassifications(JSON.parse(fs.readFileSync(
    path.join(__dirname, "fixtures/classifications.json"),
    "utf8",
  )));
});

test("rejects confidence outside zero to one", () => {
  assert.throws(() => validateClassifications([{
    ...classification,
    confidence: 1.2,
  }]), /confidence/);
});

test("requires an archive reason for archive classifications", () => {
  assert.throws(() => validateClassifications([{
    ...classification,
    project: null,
    suggestedAction: "archive",
  }]), /archiveReason/);
  validateClassifications([{
    ...classification,
    project: null,
    suggestedAction: "archive",
    archiveReason: "Synthetic duplicate conversation.",
  }]);
});

test("rejects misspelled classification action fields", () => {
  assert.throws(() => validateClassifications([{
    ...classification,
    suggestedActon: "move",
  }]), /additional properties/);
});

test("rejects duplicate taxonomy project names", () => {
  assert.throws(() => validateTaxonomy({
    projects: [taxonomy.projects[0], { ...taxonomy.projects[0] }],
  }), /unique/);
});

test("validates plan projects and forbids item-level approval", () => {
  validateMigrationPlan(migrationPlan(migrationItem()));
  assert.throws(() => validateMigrationPlan(migrationPlan(migrationItem({ approved: true }))), /additional properties/);
});

test("validates planner and apply migration item shapes", () => {
  validateMigrationPlan(migrationPlan(migrationItem({
    project: null,
    suggestedAction: "archive",
    action: "archive",
    archiveReason: "Synthetic duplicate conversation.",
    status: "pending",
  })));
  assert.throws(() => validateMigrationPlan(migrationPlan(migrationItem({
    project: null,
    suggestedAction: "archive",
    action: "archive",
  }))), /archiveReason/);
  assert.throws(() => validateMigrationPlan(migrationPlan(migrationItem({
    project: null,
    action: "archive",
  }))), /archiveReason/);
  assert.throws(() => validateMigrationPlan(migrationPlan(migrationItem({ action: undefined }))), /action/);
});

test("accepts supported migration statuses and rejects unknown statuses", () => {
  for (const status of ["proposed", "unresolved", "pending", "running", "done", "failed", "skipped", "uncertain"]) {
    validateMigrationPlan(migrationPlan(migrationItem({ status })));
  }
  assert.throws(() => validateMigrationPlan(migrationPlan(migrationItem({ status: "approved" }))), /status/);
});

test("rejects migration plans for providers other than chatgpt", () => {
  const plan = migrationPlan(migrationItem());
  plan.provider = "claude";
  assert.throws(() => validateMigrationPlan(plan), /provider/);
});
