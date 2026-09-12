// Compatibility boundary; the verified original is recoverable in Git history.
const { createPaths } = require("../../src/core/paths");
const { createBrowser } = require("../../src/providers/chatgpt/browser");
const paths = createPaths();
module.exports = { ...createBrowser(paths), CHROME_USER_DATA_DIR: paths.profile, PROFILE: "Default" };
