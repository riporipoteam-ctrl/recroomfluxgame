import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

process.env.NODE_ENV = "test";
process.env.PHOTON_APP_ID = "";

let app: FastifyInstance;

beforeAll(async () => {
  const { buildServer } = await import("../src/server.js");
  app = await buildServer();
});

afterAll(async () => {
  await app.close();
});

describe("Flux Rec Room 2022 gateway", () => {
  it("reports the exact target build", async () => {
    const response = await app.inject({ method: "GET", url: "/flux/health" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.build).toEqual({
      date: "2022-05-19",
      buildId: "8751857",
      manifestId: "6337851004861751095",
    });
  });

  it("does not silently fake unsupported Rec Room endpoints", async () => {
    const response = await app.inject({ method: "GET", url: "/api/not-implemented-yet" });
    expect(response.statusCode).toBe(501);
    expect(response.headers["x-flux-trace-id"]).toBeTruthy();
  });
});
