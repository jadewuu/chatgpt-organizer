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
  validateMigrationPlan({
    provider: "chatgpt",
    generatedAt: "2026-09-12T00:00:00.000Z",
    taxonomyHash: "sha256-fixture-taxonomy",
    projects: [{
      name: "Work",
      exists: false,
      createRequired: true,
      proposedConversationCount: 1,
    }],
    items: [{
      ...classification,
      title: "Synthetic chat",
      url: "https://chatgpt.com/c/fixture-chat-1",
      currentProject: null,
      status: "proposed",
    }],
    planHash: "sha256-fixture-plan",
  });
  assert.throws(() => validateMigrationPlan({
    provider: "chatgpt",
    generatedAt: "2026-09-12T00:00:00.000Z",
    taxonomyHash: "sha256-fixture-taxonomy",
    projects: [],
    items: [{
      ...classification,
      title: "Synthetic chat",
      url: "https://chatgpt.com/c/fixture-chat-1",
      currentProject: null,
      status: "proposed",
      approved: true,
    }],
    planHash: "sha256-fixture-plan",
  }), /additional properties/);
});
