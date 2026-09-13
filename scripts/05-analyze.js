// Compatibility wrapper; planning is read-only and all artifacts live under .local/.
const { main } = require("../src/cli");

main(["plan", ...process.argv.slice(2)]).then((code) => { process.exitCode = code; });
