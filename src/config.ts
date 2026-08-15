import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(2059),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  FIREBASE_PROJECT_ID: z.string().default("flux-544a6"),
  PHOTON_APP_ID: z.string().optional().default(""),
  PHOTON_APP_VERSION: z.string().default("flux-recroom-2022"),
  PHOTON_REGION: z.string().default("eu"),
  RECROOM_BUILD_DATE: z.string().default("2022-05-19"),
  RECROOM_BUILD_ID: z.string().default("8751857"),
  RECROOM_MANIFEST_ID: z.string().default("6337851004861751095"),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  TRACE_UNKNOWN_ROUTES: z.string().default("true"),
  TRACE_BODY_LIMIT: z.coerce.number().int().min(1024).max(262144).default(32768),
});

const parsed = envSchema.parse(process.env);

export const config = {
  ...parsed,
  corsOrigins: parsed.CORS_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean),
  traceUnknownRoutes: parsed.TRACE_UNKNOWN_ROUTES.toLowerCase() !== "false",
  build: {
    date: parsed.RECROOM_BUILD_DATE,
    buildId: parsed.RECROOM_BUILD_ID,
    manifestId: parsed.RECROOM_MANIFEST_ID,
  },
  photon: {
    appId: parsed.PHOTON_APP_ID,
    appVersion: parsed.PHOTON_APP_VERSION,
    region: parsed.PHOTON_REGION,
  },
} as const;

export function publicRuntimeConfig() {
  return {
    service: "flux-recroom-2022",
    build: config.build,
    photon: {
      configured: Boolean(config.photon.appId),
      appVersion: config.photon.appVersion,
      region: config.photon.region,
    },
    firebaseProjectId: config.FIREBASE_PROJECT_ID,
  };
}
