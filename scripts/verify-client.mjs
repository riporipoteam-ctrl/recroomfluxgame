import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const root = path.resolve(process.argv[2] || process.env.FLUX_RECROOM_CLIENT_DIR || "client");
const fingerprintPath = path.join(projectRoot, "config", "recroom-may-2022-fingerprint.json");
const fingerprint = JSON.parse(fs.readFileSync(fingerprintPath, "utf8"));

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(4 * 1024 * 1024);
  try {
    while (true) {
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!bytes) break;
      hash.update(buffer.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

console.log("Flux Rec Room exact-client verification");
console.log(`Target: ${fingerprint.buildDate} | build ${fingerprint.buildId} | manifest ${fingerprint.manifestId}`);
console.log(`Archive inventory: ${fingerprint.fileCount.toLocaleString()} files | ${fingerprint.totalBytes.toLocaleString()} bytes\n`);

if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  console.error(`FAIL client directory: ${root}`);
  process.exit(1);
}

let failed = 0;
for (const [label, expected] of Object.entries(fingerprint.criticalFiles)) {
  const filePath = path.join(root, ...expected.path.split("/"));
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    console.error(`FAIL ${label}: missing ${expected.path}`);
    failed += 1;
    continue;
  }
  const stat = fs.statSync(filePath);
  if (stat.size !== expected.size) {
    console.error(`FAIL ${label}: size ${stat.size} != ${expected.size}`);
    failed += 1;
    continue;
  }
  const actualHash = sha256File(filePath);
  if (actualHash !== expected.sha256) {
    console.error(`FAIL ${label}: sha256 ${actualHash} != ${expected.sha256}`);
    failed += 1;
    continue;
  }
  console.log(`OK   ${label}: ${expected.path} | ${stat.size.toLocaleString()} bytes | ${actualHash}`);
}

if (failed) {
  console.error(`\nClient is NOT build ${fingerprint.buildId} (${failed} critical fingerprint check(s) failed).`);
  process.exit(1);
}

console.log(`\nEXACT_BUILD_OK=true`);
console.log(`Build ${fingerprint.buildId} / manifest ${fingerprint.manifestId} fingerprint matches all pinned critical files.`);
