import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore";
import { createHash, randomBytes } from "node:crypto";
import { config } from "./config.js";

let firestore: Firestore | null = null;

function ensureFirebase() {
  if (!getApps().length) {
    initializeApp({
      credential: applicationDefault(),
      projectId: config.FIREBASE_PROJECT_ID,
    });
  }
  firestore ??= getFirestore();
  return { auth: getAuth(), db: firestore };
}

export type FluxIdentity = {
  uid: string;
  email: string | null;
  displayName: string;
  username: string;
  accountId: number;
  isAdmin: boolean;
};

function stableAccountId(uid: string) {
  const digest = createHash("sha256").update(uid).digest();
  return 100_000 + (digest.readUInt32BE(0) % 899_000_000);
}

function usernameFromToken(token: DecodedIdToken) {
  const emailStem = token.email?.split("@")[0]?.replace(/[^a-zA-Z0-9_]/g, "") || "player";
  return emailStem.slice(0, 20) || "player";
}

export async function verifyFirebaseIdToken(idToken: string): Promise<DecodedIdToken> {
  const { auth } = ensureFirebase();
  return auth.verifyIdToken(idToken, true);
}

export async function ensureFluxPlayer(token: DecodedIdToken): Promise<FluxIdentity> {
  const { db } = ensureFirebase();
  const ref = db.collection("recroomPlayers").doc(token.uid);
  const snap = await ref.get();
  const existing = snap.exists ? snap.data() ?? {} : {};

  const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const email = token.email ?? null;
  const isAdmin = Boolean(adminEmail && email?.toLowerCase() === adminEmail);
  const accountId = Number(existing.accountId) || stableAccountId(token.uid);
  const username = String(existing.username || usernameFromToken(token)).slice(0, 20);
  const displayName = String(existing.displayName || token.name || username).slice(0, 32);

  await ref.set(
    {
      accountId,
      username,
      displayName,
      email,
      isAdmin,
      level: Number(existing.level) || 1,
      xp: Number(existing.xp) || 0,
      tokens: existing.tokens == null ? 500 : Number(existing.tokens),
      updatedAt: FieldValue.serverTimestamp(),
      ...(snap.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    },
    { merge: true },
  );

  return { uid: token.uid, email, displayName, username, accountId, isAdmin };
}

function sessionHash(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

export async function createRecRoomSession(identity: FluxIdentity) {
  const { db } = ensureFirebase();
  const token = randomBytes(32).toString("base64url");
  const expiresAtMs = Date.now() + 1000 * 60 * 60 * 24 * 7;
  await db.collection("recroomSessions").doc(sessionHash(token)).set({
    uid: identity.uid,
    accountId: identity.accountId,
    createdAt: FieldValue.serverTimestamp(),
    expiresAtMs,
  });
  return { token, expiresAtMs };
}

export async function identityFromSession(rawToken: string): Promise<FluxIdentity | null> {
  if (!rawToken) return null;
  const { db } = ensureFirebase();
  const session = await db.collection("recroomSessions").doc(sessionHash(rawToken)).get();
  if (!session.exists) return null;
  const sessionData = session.data() ?? {};
  if (Number(sessionData.expiresAtMs) < Date.now()) return null;
  const uid = String(sessionData.uid || "");
  if (!uid) return null;
  const player = await db.collection("recroomPlayers").doc(uid).get();
  if (!player.exists) return null;
  const data = player.data() ?? {};
  return {
    uid,
    email: typeof data.email === "string" ? data.email : null,
    displayName: String(data.displayName || data.username || "Flux player"),
    username: String(data.username || "player"),
    accountId: Number(data.accountId) || stableAccountId(uid),
    isAdmin: Boolean(data.isAdmin),
  };
}

export async function loadPlayerState(uid: string) {
  const { db } = ensureFirebase();
  const snap = await db.collection("recroomPlayers").doc(uid).get();
  return snap.exists ? snap.data() ?? {} : {};
}

export async function savePlayerState(uid: string, patch: Record<string, unknown>) {
  const { db } = ensureFirebase();
  const allowed = new Set(["displayName", "username", "level", "xp", "tokens", "outfit", "settings", "inventory", "dormRoomId"]);
  const safe = Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.has(key)));
  await db.collection("recroomPlayers").doc(uid).set(
    { ...safe, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  return safe;
}
