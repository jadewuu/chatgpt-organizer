const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");
const { createPaths } = require("../core/paths");
const { loadConfig } = require("../core/config");
const { validateTaxonomy, validateClassifications } = require("../core/validate");
const { loadRunState, saveRunState, transitionState } = require("../core/state");
const { buildClassificationInput, buildMigrationPlan } = require("../core/planner");
const { writePrivateFile } = require("../core/private-file");
const { renderReviewHtml } = require("../reports/review");

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`Unable to read ${filePath}: ${error.message}`);
  }
}

function readExtracted(paths) {
  const directory = path.join(paths.raw, "conversations");
  let entries;
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => readJson(path.join(directory, entry.name)))
    .filter(Boolean);
}

function starterTaxonomy(rootDir, config) {
  if (config?.taxonomy?.projects) return config.taxonomy;
  const example = path.join(rootDir, "config", "organizer.example.yaml");
  const parsed = fs.existsSync(example) ? YAML.parse(fs.readFileSync(example, "utf8")) : null;
  if (parsed?.taxonomy?.projects) return parsed.taxonomy;
  return {
    projects: [
      { name: "Work", description: "Ongoing professional work and decisions.", include: [], exclude: [] },
      { name: "Learning", description: "Research, study, and reusable explanations.", include: [], exclude: [] },
    ],
  };
}

function taxonomyFromFile(value) {
  if (value?.taxonomy?.projects) return value.taxonomy;
  return value;
}

function loadEffectiveConfig(rootDir, deps) {
  if (deps.config) return deps.config;
  const configured = deps.configPath || path.join(rootDir, "config", "organizer.yaml");
  const example = path.join(rootDir, "config", "organizer.example.yaml");
  const target = fs.existsSync(configured) ? configured : (fs.existsSync(example) ? example : null);
  return target ? (deps.loadConfig || loadConfig)(target) : { provider: "chatgpt", classification: { moveThreshold: 0.95, fullContentBelow: 0.9 } };
}

const validPhases = new Set([
  "PREFLIGHT", "AUTHENTICATE", "DISCOVER", "TAXONOMY_REVIEW", "CLASSIFY", "PLAN_REVIEW",
  "PILOT_APPROVAL", "PILOT", "APPLY_APPROVAL", "APPLY", "VERIFY", "COMPLETE",
]);

function requireRunState(paths) {
  const state = loadRunState(paths);
  if (!state || typeof state.runId !== "string" || !state.runId
    || typeof state.accountFingerprint !== "string" || !state.accountFingerprint
    || !validPhases.has(state.phase)) {
    throw new Error("Persisted run state is required before planning");
  }
  return state;
}

function parseArguments(argv) {
  if (!Array.isArray(argv)) throw new Error("plan arguments must be an array");
  if (argv.length === 0) return false;
  if (argv.length === 1 && argv[0] === "--allow-full-content") return true;
  throw new Error("plan accepts only --allow-full-content");
}

function readClassificationInput(inputPath, conversations, { requireFirstPass = false } = {}) {
  if (!fs.existsSync(inputPath)) throw new Error("Missing first-pass classification-input.jsonl");
  let text;
  try { text = fs.readFileSync(inputPath, "utf8"); }
  catch (error) { throw new Error(`Unable to read classification input: ${error.message}`); }
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (!lines.length || lines.some((line) => !line.trim())) throw new Error("Malformed classification-input.jsonl");
  const inventoryIds = new Set();
  for (const conversation of conversations) {
    if (!conversation || typeof conversation.conversationId !== "string") throw new Error("Invalid conversation inventory");
    if (inventoryIds.has(conversation.conversationId)) throw new Error(`Duplicate conversation ID: ${conversation.conversationId}`);
    inventoryIds.add(conversation.conversationId);
  }
  const seen = new Set();
  const rows = lines.map((line) => {
    let row;
    try { row = JSON.parse(line); } catch (error) { throw new Error(`Malformed classification-input.jsonl: ${error.message}`); }
    if (!row || typeof row !== "object" || Array.isArray(row)
      || typeof row.conversationId !== "string" || !row.conversationId
      || typeof row.title !== "string"
      || !Object.hasOwn(row, "createdAt") || !Object.hasOwn(row, "updatedAt")
      || ![row.createdAt, row.updatedAt].every((value) => value === null || (typeof value === "number" && Number.isFinite(value)))
      || typeof row.firstUserMessage !== "string" || typeof row.lastUserMessage !== "string") {
      throw new Error("Malformed classification-input.jsonl");
    }
    if (seen.has(row.conversationId)) throw new Error(`Duplicate classification input ID: ${row.conversationId}`);
    if (!inventoryIds.has(row.conversationId)) throw new Error(`Unknown classification input ID: ${row.conversationId}`);
    if (requireFirstPass && Object.hasOwn(row, "excerpts")) throw new Error("classification-input.jsonl is not a first-pass artifact");
    seen.add(row.conversationId);
    return row;
  });
  if (seen.size !== inventoryIds.size) throw new Error("Stale classification-input.jsonl: IDs do not match inventory");
  return rows;
}

function requireClassificationSet(classifications, conversations) {
  const inventoryIds = new Set(conversations.map((conversation) => conversation.conversationId));
  const seen = new Set();
  for (const classification of classifications) {
    if (seen.has(classification.conversationId)) throw new Error(`Duplicate classification ID: ${classification.conversationId}`);
    if (!inventoryIds.has(classification.conversationId)) throw new Error(`Unknown classification ID: ${classification.conversationId}`);
    seen.add(classification.conversationId);
  }
  if (seen.size !== inventoryIds.size) throw new Error("Classifications do not match current inventory");
}

async function run(argv = [], deps = {}) {
  const allowFullContent = parseArguments(argv);
  const rootDir = path.resolve(deps.rootDir || process.cwd());
  const paths = deps.paths || createPaths(rootDir);
  const state = requireRunState(paths);
  if (!["DISCOVER", "TAXONOMY_REVIEW", "CLASSIFY", "PLAN_REVIEW"].includes(state.phase)
    || state.applyProgress && Object.keys(state.applyProgress).length) {
    throw new Error("Planning is blocked once writes may have begun; use the documented post-write recovery path");
  }
  const plans = paths.plans;
  const taxonomyPath = path.join(plans, "taxonomy.yaml");
  const inputPath = path.join(plans, "classification-input.jsonl");
  const classificationsPath = path.join(plans, "classifications.json");
  const planPath = path.join(plans, "migration-plan.json");
  const reportPath = path.resolve(paths.reports, "review.html");
  const config = loadEffectiveConfig(rootDir, deps);

  if (state.phase === "DISCOVER") {
    if (allowFullContent) throw new Error("Full-content review requires CLASSIFY phase");
    let taxonomy;
    if (fs.existsSync(taxonomyPath)) {
      taxonomy = validateTaxonomy(taxonomyFromFile(YAML.parse(fs.readFileSync(taxonomyPath, "utf8"))));
    } else {
      taxonomy = validateTaxonomy(starterTaxonomy(rootDir, config));
      writePrivateFile(paths, paths.plans, taxonomyPath, YAML.stringify(taxonomy));
    }
    transitionState(state, "TAXONOMY_REVIEW");
    saveRunState(paths, state);
    const message = "Prepared .local/plans/taxonomy.yaml and entered TAXONOMY_REVIEW. Customize and approve the taxonomy, then run plan again.";
    (deps.stdout || process.stdout).write(`${message}\n`);
    return 0;
  }

  if (!fs.existsSync(taxonomyPath)) throw new Error(`Missing taxonomy artifact for phase ${state.phase}`);
  const taxonomy = validateTaxonomy(taxonomyFromFile(YAML.parse(fs.readFileSync(taxonomyPath, "utf8"))));
  const effectiveConfig = { ...config, taxonomy };
  const conversations = readJson(path.join(paths.raw, "conversations.json"));
  if (!Array.isArray(conversations)) throw new Error("No local conversation inventory; run discover first");
  const extracted = readExtracted(paths);
  const projectsPath = path.join(paths.raw, "projects.json");
  const existingProjects = fs.existsSync(projectsPath) ? readJson(projectsPath) : [];
  if (!Array.isArray(existingProjects)) throw new Error("Invalid local Project inventory");

  if (state.phase === "TAXONOMY_REVIEW") {
    if (allowFullContent) throw new Error("Full-content review requires CLASSIFY phase");
    const input = buildClassificationInput(conversations, extracted, effectiveConfig, {
      maxExcerptCodePoints: deps.maxExcerptCodePoints,
    });
    writePrivateFile(paths, paths.plans, inputPath, `${input.map((item) => JSON.stringify(item)).join("\n")}\n`);
    transitionState(state, "CLASSIFY");
    saveRunState(paths, state);
    const message = "Wrote .local/plans/classification-input.jsonl. Produce schema-valid classifications.json, then run plan again.";
    (deps.stdout || process.stdout).write(`${message}\n`);
    return 0;
  }

  if (!["CLASSIFY", "PLAN_REVIEW"].includes(state.phase)) {
    throw new Error(`Cannot build migration plan from phase ${state.phase}`);
  }

  const classifications = readJson(classificationsPath);
  if (classifications === null) throw new Error("Missing schema-valid classifications.json");
  validateClassifications(classifications);
  requireClassificationSet(classifications, conversations);
  readClassificationInput(inputPath, conversations, { requireFirstPass: allowFullContent });

  if (allowFullContent) {
    if (state.phase !== "CLASSIFY") throw new Error("Full-content review requires CLASSIFY phase");
    const input = buildClassificationInput(conversations, extracted, effectiveConfig, {
      allowFullContent: true,
      priorClassifications: classifications,
      maxExcerptCodePoints: deps.maxExcerptCodePoints,
    });
    writePrivateFile(paths, paths.plans, inputPath, `${input.map((item) => JSON.stringify(item)).join("\n")}\n`);
    const message = "Wrote additional excerpts for low-confidence conversations. Revise classifications.json and run plan again.";
    (deps.stdout || process.stdout).write(`${message}\n`);
    return 0;
  }

  const plan = buildMigrationPlan(conversations, classifications, effectiveConfig, existingProjects, { now: deps.now });
  delete state.approvals;
  delete state.pilotVerification;
  delete state.planHash;
  saveRunState(paths, state);
  writePrivateFile(paths, paths.plans, planPath, `${JSON.stringify(plan, null, 2)}\n`);
  const writeReport = deps.writeReviewReport || deps.writeReport;
  if (writeReport) writeReport(paths, reportPath, renderReviewHtml({ plan, taxonomy }));
  else writePrivateFile(paths, paths.reports, reportPath, renderReviewHtml({ plan, taxonomy }));
  if (state.phase === "CLASSIFY") transitionState(state, "PLAN_REVIEW");
  saveRunState(paths, state);
  const phase = state.phase;
  const message = `Wrote .local/plans/migration-plan.json and ${reportPath}; no ChatGPT changes were made. Phase is ${phase}. Review the plan before any approval.`;
  (deps.stdout || process.stdout).write(`${message}\n`);
  return 0;
}

module.exports = { run, readExtracted, readClassificationInput };
