import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { randomUUID } from "node:crypto";
import { config, publicRuntimeConfig } from "./config.js";
import {
  createRecRoomSession,
  ensureFluxPlayer,
  identityFromSession,
  loadPlayerState,
  savePlayerState,
  verifyFirebaseIdToken,
  type FluxIdentity,
} from "./firebase.js";

function bearer(request: FastifyRequest) {
  const value = request.headers.authorization || "";
  return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : "";
}

async function requireSession(request: FastifyRequest): Promise<FluxIdentity> {
  const token = bearer(request);
  const identity = await identityFromSession(token);
  if (!identity) {
    const error = new Error("Flux Rec Room session is missing or expired") as Error & { statusCode?: number };
    error.statusCode = 401;
    throw error;
  }
  return identity;
}

function accountShape(identity: FluxIdentity, state: Record<string, unknown> = {}) {
  return {
    accountId: identity.accountId,
    username: identity.username,
    displayName: identity.displayName,
    profileImage: "",
    junior: false,
    platforms: ["Steam"],
    createdAt: state.createdAt ?? null,
    isAdmin: identity.isAdmin,
    level: Number(state.level) || 1,
    xp: Number(state.xp) || 0,
    tokens: state.tokens == null ? 500 : Number(state.tokens),
  };
}

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === "test" ? "silent" : "info",
      redact: ["req.headers.authorization", "headers.authorization", "body.idToken", "body.token"],
    },
    bodyLimit: Math.max(config.TRACE_BODY_LIMIT, 1024 * 1024),
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes("*") || config.corsOrigins.includes(origin)) return callback(null, true);
      callback(new Error("Origin not allowed"), false);
    },
    credentials: true,
  });

  app.get("/flux/health", async () => ({
    ok: true,
    now: new Date().toISOString(),
    ...publicRuntimeConfig(),
  }));

  app.get("/flux/config", async () => publicRuntimeConfig());

  // Flux web -> native-game session exchange. The browser sends its Firebase ID
  // token once; the native client can use the returned opaque session token.
  app.post<{ Body: { idToken?: string } }>("/flux/auth/firebase", async (request, reply) => {
    const idToken = request.body?.idToken || bearer(request);
    if (!idToken) return reply.code(400).send({ ok: false, error: "Firebase ID token required" });
    const decoded = await verifyFirebaseIdToken(idToken);
    const identity = await ensureFluxPlayer(decoded);
    const session = await createRecRoomSession(identity);
    return {
      ok: true,
      sessionToken: session.token,
      expiresAtMs: session.expiresAtMs,
      account: accountShape(identity),
    };
  });

  app.get("/flux/player/state", async (request) => {
    const identity = await requireSession(request);
    const state = await loadPlayerState(identity.uid);
    return { ok: true, account: accountShape(identity, state), state };
  });

  app.patch<{ Body: Record<string, unknown> }>("/flux/player/state", async (request) => {
    const identity = await requireSession(request);
    const saved = await savePlayerState(identity.uid, request.body || {});
    return { ok: true, saved };
  });

  // ---- Rec Room compatibility surface -------------------------------------
  // Response shapes here are deliberately small. Unknown/mismatched 2022 calls
  // are traced by the not-found handler so we can evolve them from real client
  // traffic instead of pretending a later Rec Room schema is identical.

  app.get("/api/config/v2", async () => ({
    Environment: "Flux",
    BuildId: config.build.buildId,
    BuildDate: config.build.date,
    AllowUnsupportedVersion: true,
  }));

  app.get("/Accounts/account/me", async (request) => {
    const identity = await requireSession(request);
    const state = await loadPlayerState(identity.uid);
    return accountShape(identity, state);
  });

  app.get<{ Querystring: { id?: string | string[] } }>("/Accounts/account/bulk", async (request) => {
    const identity = await requireSession(request);
    void request.query;
    return [accountShape(identity, await loadPlayerState(identity.uid))];
  });

  app.post("/Matchmaking/player/login", async (request) => {
    const identity = await requireSession(request);
    return {
      success: true,
      accountId: identity.accountId,
      playerId: identity.accountId,
      statusVisibility: 0,
      platform: "Steam",
    };
  });

  app.post("/Matchmaking/player/logout", async (request) => {
    await requireSession(request);
    return { success: true };
  });

  app.post("/Matchmaking/player/heartbeat", async (request) => {
    const identity = await requireSession(request);
    return { success: true, playerId: identity.accountId, serverTime: Date.now() };
  });

  app.get("/Matchmaking/player", async (request) => {
    const identity = await requireSession(request);
    return { accountId: identity.accountId, playerId: identity.accountId, isOnline: true };
  });

  app.get("/Room_server/dormroom/me", async (request) => {
    const identity = await requireSession(request);
    const state = await loadPlayerState(identity.uid);
    const roomId = Number(state.dormRoomId) || identity.accountId + 1_000_000_000;
    return {
      RoomId: roomId,
      Name: `DormRoom_${identity.accountId}`,
      Description: "Flux private dorm room",
      CreatorAccountId: identity.accountId,
      IsDormRoom: true,
      MaxPlayerCalculationMode: 0,
      MaxPlayers: 1,
      Accessibility: 1,
      SupportsScreens: true,
      SupportsWalkVR: true,
      SupportsTeleportVR: true,
    };
  });

  app.get("/Room_server/photon_access_token", async (request, reply) => {
    const identity = await requireSession(request);
    if (!config.photon.appId) {
      return reply.code(503).send({
        error: "Photon is not configured on this deployment",
        code: "PHOTON_NOT_CONFIGURED",
      });
    }
    return {
      AppId: config.photon.appId,
      AppVersion: config.photon.appVersion,
      Region: config.photon.region,
      UserId: String(identity.accountId),
      // The May-2022 client may expect a different auth-token field. The exact
      // packet/response shape will be filled from the trace harness.
      Token: "",
    };
  });

  app.post("/Matchmaking/matchmake/dorm", async (request) => {
    const identity = await requireSession(request);
    return {
      success: true,
      roomId: identity.accountId + 1_000_000_000,
      roomInstanceId: `flux-dorm-${identity.accountId}`,
      photon: {
        appId: config.photon.appId ? "configured" : "missing",
        region: config.photon.region,
      },
    };
  });

  const emptyArrayGet = [
    "/api/relationships/v2/get",
    "/api/messages/v2/get",
    "/Room_server/featuredrooms/current",
    "/Room_server/rooms/hot",
    "/Room_server/rooms/ownedby/me",
    "/Room_server/rooms/visitedby/me",
    "/api/rooms/v1/filters",
    "/api/inventions/v2/mine",
    "/outfits/me/saved",
    "/clubs/club/mine/member",
    "/clubs/subscription/mine/member",
    "/Commerce/api/catalog/v1/all",
    "/api/gameconfigs/v1/all",
    "/api/playerevents/v1/all",
  ];
  for (const route of emptyArrayGet) app.get(route, async (request) => { await requireSession(request); return []; });

  app.get("/api/communityboard/v2/current", async (request) => {
    await requireSession(request);
    return { entries: [] };
  });

  app.get("/api/sanitize/v1/isPure", async (request) => {
    await requireSession(request);
    return { isPure: true };
  });

  app.post("/api/sanitize/v1", async (request) => {
    await requireSession(request);
    return request.body ?? {};
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode = Number((error as Error & { statusCode?: number }).statusCode) || 500;
    if (statusCode >= 500) request.log.error({ err: error }, "request failed");
    else request.log.info({ err: error }, "request rejected");
    reply.code(statusCode).send({ ok: false, error: error.message, statusCode });
  });

  app.setNotFoundHandler((request, reply) => {
    const traceId = randomUUID();
    if (config.traceUnknownRoutes) {
      const headers = { ...request.headers } as Record<string, unknown>;
      if (headers.authorization) headers.authorization = "[REDACTED]";
      request.log.warn({
        traceId,
        method: request.method,
        url: request.url,
        headers,
        body: request.body,
      }, "unimplemented Rec Room 2022 endpoint");
    }
    reply.header("x-flux-trace-id", traceId).code(501).send({
      ok: false,
      error: "Rec Room 2022 compatibility endpoint not implemented yet",
      traceId,
      method: request.method,
      path: request.url,
    });
  });

  return app;
}
