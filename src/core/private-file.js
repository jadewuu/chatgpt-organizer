const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function isInside(parent, candidate) {
  return candidate !== parent && candidate.startsWith(`${parent}${path.sep}`);
}

function ensurePrivateDirectory(directory) {
  try { fs.mkdirSync(directory, { mode: 0o700 }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  const stats = fs.lstatSync(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`Refusing symlinked or non-directory private path: ${directory}`);
  }
  fs.chmodSync(directory, 0o700);
}

function ensureDirectoryPath(parent, directory) {
  let current = parent;
  const relative = path.relative(parent, directory);
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    ensurePrivateDirectory(current);
  }
}

function writePrivateFile(paths, artifactDirectory, target, content) {
  const local = path.resolve(paths.local);
  const directory = path.resolve(artifactDirectory);
  const absolute = path.resolve(target);
  if (!isInside(local, directory) || !isInside(directory, absolute)) {
    throw new Error("Refusing private artifact outside its .local directory");
  }

  ensurePrivateDirectory(local);
  const resolvedLocal = fs.realpathSync(local);
  ensureDirectoryPath(local, directory);
  const resolvedDirectory = fs.realpathSync(directory);
  if (!isInside(resolvedLocal, resolvedDirectory)) {
    throw new Error("Refusing resolved artifact directory outside .local");
  }
  ensureDirectoryPath(directory, path.dirname(absolute));
  const resolvedParent = fs.realpathSync(path.dirname(absolute));
  if (resolvedParent !== resolvedDirectory && !isInside(resolvedDirectory, resolvedParent)) {
    throw new Error("Refusing resolved artifact target outside its private directory");
  }

  const temporary = path.join(
    path.dirname(absolute),
    `.${path.basename(absolute)}.${crypto.randomBytes(16).toString("hex")}.tmp`,
  );
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL
    | (fs.constants.O_NOFOLLOW || 0);
  let descriptor;
  let ownsTemporary = false;
  try {
    descriptor = fs.openSync(temporary, flags, 0o600);
    ownsTemporary = true;
    fs.writeFileSync(descriptor, content);
    fs.fchmodSync(descriptor, 0o600);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, absolute);
    ownsTemporary = false;
    const finalStats = fs.lstatSync(absolute);
    if (!finalStats.isFile() || finalStats.isSymbolicLink() || (finalStats.mode & 0o777) !== 0o600) {
      throw new Error(`Private artifact did not retain mode 0600: ${absolute}`);
    }
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch {}
    }
    if (ownsTemporary) {
      try { fs.unlinkSync(temporary); } catch (cleanupError) {
        if (cleanupError.code !== "ENOENT") error.cleanupError = cleanupError;
      }
    }
    throw error;
  }
}

module.exports = { writePrivateFile };
