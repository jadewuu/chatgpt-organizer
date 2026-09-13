const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");
const { createPaths } = require("../core/paths");
const { loadConfig } = require("../core/config");
const { validateTaxonomy, validateClassifications } = require("../core/validate");
const { loadRunState, saveRunState, transitionState } = require("../core/state");
const { buildClassificationInput, buildMigrationPlan } = require("../core/planner");

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`Unable to read ${filePath}: ${error.message}`);
  }
}

function writePrivate(paths, target, content) {
  const plans = path.resolve(paths.plans);
  const absolute = path.resolve(target);
  if (absolute !== plans && !absolute.startsWith(`${plans}${path.sep}`)) throw new Error("Refusing plan artifact outside .local/plans");
  fs.mkdirSync(plans, { recursive: true, mode: 0o700 });
  fs.chmodSync(plans, 0o700);
  const temporary = `${absolute}.tmp`;
  fs.writeFileSync(temporary, content, { mode: 0o600 });
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, absolute);
  fs.chmodSync(absolute, 0o600);
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

function updatePhase(paths, expected, next) {
  const state = loadRunState(paths);
  if (!state || state.phase !== expected) return state;
  transitionState(state, next);
  saveRunState(paths, state);
  return state;
}

async function run(argv = [], deps = {}) {
  if (argv.length) throw new Error("plan does not accept arguments");
  const rootDir = path.resolve(deps.rootDir || process.cwd());
  const paths = deps.paths || createPaths(rootDir);
  const plans = paths.plans;
  const taxonomyPath = path.join(plans, "taxonomy.yaml");
  const inputPath = path.join(plans, "classification-input.jsonl");
  const classificationsPath = path.join(plans, "classifications.json");
  const planPath = path.join(plans, "migration-plan.json");
  const config = loadEffectiveConfig(rootDir, deps);

  if (!fs.existsSync(taxonomyPath)) {
    const taxonomy = validateTaxonomy(starterTaxonomy(rootDir, config));
    writePrivate(paths, taxonomyPath, YAML.stringify(taxonomy));
    const message = "Seeded .local/plans/taxonomy.yaml. Customize and approve the taxonomy, then run plan again.";
    (deps.stdout || process.stdout).write(`${message}\n`);
    return 0;
  }

  const taxonomy = validateTaxonomy(taxonomyFromFile(YAML.parse(fs.readFileSync(taxonomyPath, "utf8"))));
  const effectiveConfig = { ...config, taxonomy };
  const conversations = readJson(path.join(paths.raw, "conversations.json"));
  if (!Array.isArray(conversations)) throw new Error("No local conversation inventory; run discover first");
  const extracted = readExtracted(paths);
  const projectsPath = path.join(paths.raw, "projects.json");
  const existingProjects = fs.existsSync(projectsPath) ? readJson(projectsPath) : [];
  if (!Array.isArray(existingProjects)) throw new Error("Invalid local Project inventory");

  if (!fs.existsSync(classificationsPath)) {
    const state = loadRunState(paths);
    if (state && !["TAXONOMY_REVIEW", "CLASSIFY"].includes(state.phase)) {
      throw new Error(`Cannot prepare classifications from phase ${state.phase}`);
    }
    const input = buildClassificationInput(conversations, extracted, effectiveConfig, {
      allowFullContent: deps.allowFullContent === true,
      priorClassifications: deps.priorClassifications || [],
      maxExcerptCodePoints: deps.maxExcerptCodePoints,
    });
    writePrivate(paths, inputPath, `${input.map((item) => JSON.stringify(item)).join("\n")}\n`);
    updatePhase(paths, "TAXONOMY_REVIEW", "CLASSIFY");
    const message = "Wrote .local/plans/classification-input.jsonl. Produce schema-valid classifications.json, then run plan again.";
    (deps.stdout || process.stdout).write(`${message}\n`);
    return 0;
  }

  const classifications = readJson(classificationsPath);
  validateClassifications(classifications);
  const stateBeforePlan = loadRunState(paths);
  if (stateBeforePlan && !["CLASSIFY", "PLAN_REVIEW"].includes(stateBeforePlan.phase)) {
    throw new Error(`Cannot build migration plan from phase ${stateBeforePlan.phase}`);
  }
  const plan = buildMigrationPlan(conversations, classifications, effectiveConfig, existingProjects, { now: deps.now });
  writePrivate(paths, planPath, `${JSON.stringify(plan, null, 2)}\n`);
  const state = updatePhase(paths, "CLASSIFY", "PLAN_REVIEW");
  const phase = state?.phase || "PLAN_REVIEW";
  const message = `Wrote .local/plans/migration-plan.json; phase is ${phase}. Review the plan before any approval.`;
  (deps.stdout || process.stdout).write(`${message}\n`);
  return 0;
}

module.exports = { run, writePrivate, readExtracted };
