import { buildServer } from "./server.js";
import { config } from "./config.js";

const app = await buildServer();

try {
  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info({ port: config.PORT, host: config.HOST, build: config.build }, "Flux Rec Room 2022 gateway online");
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
