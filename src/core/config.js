const fs = require("node:fs");
const YAML = require("yaml");

function isPlainMapping(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function requirePlainMapping(name, value) {
  if (!isPlainMapping(value)) throw new Error(`Invalid ${name}: expected a mapping`);
}

function threshold(name, value, defaultValue) {
  if (value === undefined) return defaultValue;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Invalid classification.${name}: expected a finite number from 0 through 1`);
  }
  return value;
}

function loadConfig(filePath) {
  const value = YAML.parse(fs.readFileSync(filePath, "utf8")) || {};
  requirePlainMapping("config", value);
  if (value.provider !== undefined && value.provider !== "chatgpt") {
    throw new Error("Invalid provider: only chatgpt is supported");
  }
  if (value.classification !== undefined) requirePlainMapping("classification", value.classification);
  if (value.actions !== undefined) requirePlainMapping("actions", value.actions);
  if (value.taxonomy !== undefined) requirePlainMapping("taxonomy", value.taxonomy);
  const classification = value.classification || {};
  const actions = value.actions || {};
  return {
    provider: "chatgpt",
    classification: {
      moveThreshold: threshold("moveThreshold", classification.moveThreshold, 0.95),
      fullContentBelow: threshold("fullContentBelow", classification.fullContentBelow, 0.90),
    },
    actions: {
      allowCreateProjects: actions.allowCreateProjects === true,
      allowMove: actions.allowMove === true,
      allowArchive: actions.allowArchive === true,
      neverDelete: true,
    },
    taxonomy: value.taxonomy,
  };
}

module.exports = { loadConfig };
