import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const rootArgIndex = args.indexOf("--root");
const mapArgIndexes = args
  .map((value, index) => (value === "--map" ? index : -1))
  .filter((index) => index >= 0);

const root = path.resolve(
  rootArgIndex >= 0 && args[rootArgIndex + 1]
    ? args[rootArgIndex + 1]
    : process.env.FLUX_RECROOM_CLIENT_DIR || "client",
);

const mappings = [];
for (const index of mapArgIndexes) {
  const raw = args[index + 1] || "";
  const separator = raw.indexOf("=");
  if (separator <= 0) {
    console.error(`Invalid --map value: ${raw}. Expected OLD=NEW.`);
    process.exit(2);
  }
  mappings.push({ oldValue: raw.slice(0, separator), newValue: raw.slice(separator + 1) });
}

if (process.env.FLUX_RECROOM_URL_MAP) {
  for (const entry of process.env.FLUX_RECROOM_URL_MAP.split(";;")) {
    if (!entry) continue;
    const separator = entry.indexOf("=");
    if (separator <= 0) {
      console.error("Invalid FLUX_RECROOM_URL_MAP entry. Expected OLD=NEW entries separated by ';;'.");
      process.exit(2);
    }
    mappings.push({ oldValue: entry.slice(0, separator), newValue: entry.slice(separator + 1) });
  }
}

if (!mappings.length) {
  console.error("No URL mappings supplied. Use --map 'OLD=NEW' (repeatable) or FLUX_RECROOM_URL_MAP.");
  process.exit(2);
}

if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  console.error(`Client root does not exist: ${root}`);
  process.exit(2);
}

const allowedRelativeFiles = [
  "RecRoom.exe",
  "Recroom_Release.exe",
  "GameAssembly.dll",
  path.join("RecRoom_Data", "il2cpp_data", "Metadata", "global-metadata.dat"),
  path.join("Recroom_Release_Data", "il2cpp_data", "Metadata", "global-metadata.dat"),
];

function assertSafeReplacement(oldValue, newValue) {
  if (!oldValue || oldValue.length < 4) throw new Error("OLD mapping value is too short.");
  const oldBytes = Buffer.from(oldValue, "ascii");
  const newBytes = Buffer.from(newValue, "ascii");
  if (oldBytes.length !== oldValue.length || newBytes.length !== newValue.length) {
    throw new Error("Only plain ASCII URL/string replacements are supported in this patcher.");
  }
  if (newBytes.length > oldBytes.length) {
    throw new Error(`Replacement is longer than source (${newBytes.length} > ${oldBytes.length}): ${oldValue} -> ${newValue}`);
  }
  return { oldBytes, newBytes };
}

function allIndexes(buffer, needle) {
  const indexes = [];
  let offset = 0;
  while (offset <= buffer.length - needle.length) {
    const index = buffer.indexOf(needle, offset);
    if (index === -1) break;
    indexes.push(index);
    offset = index + needle.length;
  }
  return indexes;
}

const validatedMappings = mappings.map(({ oldValue, newValue }) => ({
  oldValue,
  newValue,
  ...assertSafeReplacement(oldValue, newValue),
}));

const plan = [];
for (const relative of allowedRelativeFiles) {
  const file = path.resolve(root, relative);
  const relativeCheck = path.relative(root, file);
  if (relativeCheck.startsWith("..") || path.isAbsolute(relativeCheck)) {
    throw new Error(`Refusing path outside client root: ${file}`);
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;

  const original = fs.readFileSync(file);
  const fileChanges = [];
  for (const mapping of validatedMappings) {
    const indexes = allIndexes(original, mapping.oldBytes);
    if (indexes.length) {
      fileChanges.push({
        oldValue: mapping.oldValue,
        newValue: mapping.newValue,
        indexes,
      });
    }
  }
  if (fileChanges.length) plan.push({ file, relative, original, fileChanges });
}

const printablePlan = plan.map(({ relative, fileChanges }) => ({
  file: relative,
  replacements: fileChanges.map(({ oldValue, newValue, indexes }) => ({
    oldValue,
    newValue,
    occurrences: indexes.length,
    offsets: indexes,
  })),
}));

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  root,
  targetBuild: "2022-05-19",
  buildId: "8751857",
  files: printablePlan,
  totalOccurrences: printablePlan.reduce(
    (total, file) => total + file.replacements.reduce((sum, item) => sum + item.occurrences, 0),
    0,
  ),
}, null, 2));

if (!plan.length) {
  console.error("No exact ASCII occurrences were found. Run scan-client-urls first; the build may use UTF-16, metadata indirection, runtime config, or constructed URLs.");
  process.exitCode = 3;
} else if (!apply) {
  console.error("Dry run only. Re-run with --apply after verifying the exact mappings above.");
} else {
  for (const item of plan) {
    const backup = `${item.file}.flux-backup`;
    if (!fs.existsSync(backup)) fs.copyFileSync(item.file, backup, fs.constants.COPYFILE_EXCL);

    const patched = Buffer.from(item.original);
    for (const change of item.fileChanges) {
      const mapping = validatedMappings.find(
        (candidate) => candidate.oldValue === change.oldValue && candidate.newValue === change.newValue,
      );
      if (!mapping) continue;
      for (const index of change.indexes) {
        mapping.newBytes.copy(patched, index);
        patched.fill(0, index + mapping.newBytes.length, index + mapping.oldBytes.length);
      }
    }
    fs.writeFileSync(item.file, patched);
    console.error(`Patched ${item.relative}; backup: ${path.basename(backup)}`);
  }
}
