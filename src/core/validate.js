const fs = require("node:fs");
const path = require("node:path");
const Ajv2020 = require("ajv/dist/2020");

const schemasDir = path.resolve(__dirname, "../../schemas");
const ajv = new Ajv2020({ allErrors: true });

ajv.addKeyword({
  keyword: "uniqueProjectNames",
  type: "array",
  schemaType: "boolean",
  errors: false,
  validate: (enabled, projects) => !enabled || new Set(projects.map((project) => project.name)).size === projects.length,
});

function loadValidator(name) {
  const schema = JSON.parse(fs.readFileSync(path.join(schemasDir, `${name}.schema.json`), "utf8"));
  return ajv.compile(schema);
}

const validators = {
  taxonomy: loadValidator("taxonomy"),
  classifications: loadValidator("classifications"),
  "migration plan": loadValidator("migration-plan"),
};

function validate(name, value) {
  const validator = validators[name];
  if (validator(value)) return value;
  const errors = validator.errors
    .map((error) => `${error.instancePath || "/"} ${error.message}`)
    .join("; ");
  throw new Error(`Invalid ${name}: ${errors}`);
}

function validateTaxonomy(value) {
  return validate("taxonomy", value);
}

function validateClassifications(value) {
  return validate("classifications", value);
}

function validateMigrationPlan(value) {
  return validate("migration plan", value);
}

module.exports = {
  validateTaxonomy,
  validateClassifications,
  validateMigrationPlan,
};
