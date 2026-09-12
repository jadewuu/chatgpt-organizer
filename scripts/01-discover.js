// Legacy implementation remains recoverable in Git history.
const { main } = require("../src/cli");
process.stderr.write("Deprecated: use pnpm organizer discover. Data now lives under .local/.\n");
main(["discover", ...process.argv.slice(2)]).then((code) => { process.exitCode = code; });
