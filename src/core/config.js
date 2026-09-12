const fs = require("node:fs");
const YAML = require("yaml");

function loadConfig(filePath) {
  const value = YAML.parse(fs.readFileSync(filePath, "utf8")) || {};
  return {
    provider: value.provider || "chatgpt",
    classification: {
      moveThreshold: value.classification?.moveThreshold ?? 0.95,
      fullContentBelow: value.classification?.fullContentBelow ?? 0.90,
    },
    actions: {
      allowCreateProjects: value.actions?.allowCreateProjects === true,
      allowMove: value.actions?.allowMove === true,
      allowArchive: value.actions?.allowArchive === true,
      neverDelete: true,
    },
    taxonomy: value.taxonomy,
  };
}

module.exports = { loadConfig };
