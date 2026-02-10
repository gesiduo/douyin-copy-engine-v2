import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { registerTaskRoutes } from "./routes/tasks.js";
import { registerCopyRoutes } from "./routes/copy.js";
import { InMemoryStore } from "./store/inMemoryStore.js";
import { TranscriptPipeline } from "./services/transcriptPipeline.js";

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const devWebDir = resolve(currentDir, "../../web");
  const prodWebDir = resolve(currentDir, "../../../web");
  const webDir = existsSync(devWebDir) ? devWebDir : prodWebDir;
  app.use(express.static(webDir));

  const store = new InMemoryStore();
  const transcriptPipeline = new TranscriptPipeline(store);

  registerTaskRoutes(app, transcriptPipeline);
  registerCopyRoutes(app, store);

  app.get("/healthz", (_req, res) => {
    res.json({
      status: "ok",
      now: new Date().toISOString(),
    });
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({
      errorCode: "INTERNAL_ERROR",
      errorMessage,
    });
  });

  return app;
}
