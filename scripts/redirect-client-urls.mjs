import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

function optionValue(name) {
  const index = args.indexOf(name);
  if (index < 0) return "";
  const parts = [];
  for (let i = index + 1; i < args.length; i += 1) {
    if (args[i].startsWith("--")) break;
    parts.push(args[i]);
  }
  return parts.join(" ").trim();
}

const rootArg = optionValue("--root");
const root = path.resolve(rootArg || process.env.FLUX_RECROOM_CLIENT_DIR || "client");
const restore = args.includes("--restore");
const dryRun = args.includes("--dry-run");
const localBase = (process.env.FLUX_RECROOM_LOCAL_BASE || "http://127.0.0.1:81").replace(/\/+$/, "");
const statePath = path.join(root, ".flux-recroom-redirect.json");

// Build 8751857 does not hardcode every RecNet service host. Its IL2CPP client
// first requests this v2 bootstrap and deserializes FGCLJJMGLAI.NameServerResponse.
// Keep the replacement exactly the same byte length so no PE/IL2CPP layout is
// shifted. RipoTeamServer's local proxy serves /nsx and returns all service URLs.
const legacyNameServer = {
  host: "nameserver-v2",
  source: "https://ns.rec.net/?v=2",
  replacement: `${localBase}/nsx`,
};
if (Buffer.byteLength(legacyNameServer.source, "ascii") !== Buffer.byteLength(legacyNameServer.replacement, "ascii")) {
  throw new Error(
    `Unsafe nameserver redirect length: ${legacyNameServer.source.length} != ${legacyNameServer.replacement.length}. ` +
    `FLUX_RECROOM_LOCAL_BASE must remain ${"http://127.0.0.1:81".length} ASCII bytes.`,
  );
}

// Later/other builds can still contain direct service hosts. Retain these
// redirects as a compatibility fallback, but May 19 2022 only requires the
// nameserver mapping to count as a valid redirect.
const suffixByHost = {
  api: "",
  auth: "/",
  accounts: "/acct",
  rooms: "/r",
  match: "/m",
  apim: "/",
  econ: "/",
  commerce: "/shop",
  chat: "/",
  lists: "/l",
  discovery: "/disco",
  playersettings: "/psettingsx",
  notify: "/no",
  cards: "/c",
  leaderboard: "/leaderb",
  clubs: "/c",
};

const directMappings = Object.entries(suffixByHost).map(([host, suffix]) => {
  const source = `https://${host}.rec.net`;
  const replacement = `${localBase}${suffix}`;
  if (Buffer.byteLength(source, "ascii") !== Buffer.byteLength(replacement, "ascii")) {
    throw new Error(
      `Unsafe redirect length for ${source}: ${source.length} != ${replacement.length}. ` +
      `FLUX_RECROOM_LOCAL_BASE must remain ${"http://127.0.0.1:81".length} ASCII bytes.`,
    );
  }
  return { host, source, replacement };
});
const mappings = [legacyNameServer, ...directMappings];

const allowedExtensions = new Set([
  ".exe", ".dll", ".dat", ".bytes", ".json", ".txt", ".config", ".xml",
  ".assets", ".resource", ".ress", ".bin", ".manifest",
]);
const allowedNames = new Set(["globalgamemanagers", "globalgamemanagers.assets"]);
const excludedSuffixes = [".flux-backup", ".update-backup", ".update-new", ".flux-write"];
const maxFileBytes = Number(process.env.FLUX_RECROOM_REDIRECT_MAX_FILE_BYTES || String(768 * 1024 * 1024));

function shouldInspect(file, stat) {
  const lower = file.toLowerCase();
  const name = path.basename(lower);
  if (name === ".flux-recroom-redirect.json" || name.startsWith(".flux-recroom-redirect.")) return false;
  if (excludedSuffixes.some((suffix) => lower.endsWith(suffix))) return false;
  if (stat.size <= 0 || stat.size > maxFileBytes) return false;
  const ext = path.extname(lower);
  return allowedNames.has(name) || allowedExtensions.has(ext);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "Logs" || entry.name === "Crashes") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) {
      const stat = fs.statSync(full);
      if (shouldInspect(full, stat)) out.push({ file: full, stat });
    }
  }
  return out;
}

function indexesOf(buffer, needle) {
  const indexes = [];
  let offset = 0;
  while (offset <= buffer.length - needle.length) {
    const index = buffer.indexOf(needle, offset);
    if (index < 0) break;
    indexes.push(index);
    offset = index + needle.length;
  }
  return indexes;
}

function variants(mapping) {
  return [
    {
      encoding: "ascii",
      source: Buffer.from(mapping.source, "ascii"),
      replacement: Buffer.from(mapping.replacement, "ascii"),
    },
    {
      encoding: "utf16le",
      source: Buffer.from(mapping.source, "utf16le"),
      replacement: Buffer.from(mapping.replacement, "utf16le"),
    },
  ];
}

function atomicReplace(file, buffer, mode) {
  // Per-player Wine sandboxes are hard-link clones of one immutable base client.
  // Writing directly through a hard link would mutate the base image and every
  // other player's client. Write a fresh inode beside it and rename atomically.
  const temp = `${file}.${process.pid}.${Date.now()}.flux-write`;
  fs.writeFileSync(temp, buffer, { mode });
  fs.renameSync(temp, file);
}

if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  console.error(`Client root does not exist: ${root}`);
  process.exit(2);
}

if (restore) {
  let restored = 0;
  for (const { file } of walk(root)) {
    const backup = `${file}.flux-backup`;
    if (!fs.existsSync(backup)) continue;
    const stat = fs.statSync(file);
    const original = fs.readFileSync(backup);
    atomicReplace(file, original, stat.mode);
    fs.unlinkSync(backup);
    restored += 1;
  }
  if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
  console.log(JSON.stringify({ ok: true, mode: "restore", root, restoredFiles: restored }, null, 2));
  process.exit(0);
}

const files = walk(root);
const report = [];
let totalSourceOccurrences = 0;
let totalPreparedOccurrences = 0;
let changedFiles = 0;

for (const { file, stat } of files) {
  const original = fs.readFileSync(file);
  const changes = [];
  let preparedInFile = 0;

  for (const mapping of mappings) {
    for (const variant of variants(mapping)) {
      const sourceIndexes = indexesOf(original, variant.source);
      const preparedIndexes = indexesOf(original, variant.replacement);
      preparedInFile += preparedIndexes.length;
      if (sourceIndexes.length) {
        changes.push({
          host: mapping.host,
          source: mapping.source,
          replacement: mapping.replacement,
          encoding: variant.encoding,
          indexes: sourceIndexes,
        });
      }
    }
  }

  const sourceCount = changes.reduce((sum, item) => sum + item.indexes.length, 0);
  totalSourceOccurrences += sourceCount;
  totalPreparedOccurrences += preparedInFile;
  if (!sourceCount) continue;

  const relative = path.relative(root, file);
  report.push({
    file: relative,
    size: stat.size,
    sourceOccurrences: sourceCount,
    alreadyPreparedOccurrences: preparedInFile,
    redirects: changes.map(({ host, encoding, indexes }) => ({ host, encoding, occurrences: indexes.length })),
  });

  if (dryRun) continue;
  const backup = `${file}.flux-backup`;
  if (!fs.existsSync(backup)) fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);

  const patched = Buffer.from(original);
  for (const change of changes) {
    const mapping = mappings.find((item) => item.host === change.host);
    const variant = variants(mapping).find((item) => item.encoding === change.encoding);
    for (const index of change.indexes) variant.replacement.copy(patched, index);
  }
  atomicReplace(file, patched, stat.mode);
  changedFiles += 1;
}

let preparedAfter = 0;
if (!dryRun) {
  for (const { file } of files) {
    const buffer = fs.readFileSync(file);
    for (const mapping of mappings) {
      for (const variant of variants(mapping)) preparedAfter += indexesOf(buffer, variant.replacement).length;
    }
  }
} else {
  preparedAfter = totalPreparedOccurrences;
}

const state = {
  ok: totalSourceOccurrences > 0 || preparedAfter > 0,
  mode: dryRun ? "dry-run" : "apply",
  root,
  targetBuild: "2022-05-19",
  buildId: "8751857",
  localBase,
  inspectedFiles: files.length,
  changedFiles,
  sourceOccurrences: totalSourceOccurrences,
  preparedOccurrences: preparedAfter,
  files: report,
  mappings,
  generatedAt: new Date().toISOString(),
};

if (!dryRun) fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
console.log(JSON.stringify(state, null, 2));

if (!state.ok) {
  console.error(
    "No May 2022 RecNet nameserver/direct service URLs were found in ASCII or UTF-16LE. " +
    "Do not assume the client is redirected; inspect the exact client before launch.",
  );
  process.exitCode = 4;
}
