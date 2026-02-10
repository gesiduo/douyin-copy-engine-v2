import type { Express, Request, Response } from "express";
import { z } from "zod";
import { TranscriptPipeline } from "../services/transcriptPipeline.js";

const createTaskSchema = z.object({
  shareText: z.string().min(1, "shareText 不能为空"),
  clientRequestId: z.string().min(1, "clientRequestId 不能为空"),
});

function buildBaseUrlFromRequest(req: Request): string | undefined {
  const explicit = process.env.PUBLIC_BASE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/u, "");
  }
  const forwardedProto = req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = req.header("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || req.header("host");
  if (!host) {
    return undefined;
  }
  const proto = forwardedProto || req.protocol || "http";
  return `${proto}://${host}`.replace(/\/+$/u, "");
}

export function registerTaskRoutes(app: Express, transcriptPipeline: TranscriptPipeline): void {
  app.post("/api/tasks", (req: Request, res: Response) => {
    const parseResult = createTaskSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        errorCode: "INVALID_INPUT",
        errorMessage: parseResult.error.flatten(),
      });
      return;
    }

    const baseUrl = buildBaseUrlFromRequest(req);
    const result = transcriptPipeline.createTask(parseResult.data, { baseUrl });
    res.status(202).json(result);
  });

  app.get("/api/tasks/:taskId", (req: Request, res: Response) => {
    const taskId = req.params.taskId;
    const result = transcriptPipeline.getTask(taskId);
    if (!result) {
      res.status(404).json({
        errorCode: "NOT_FOUND",
        errorMessage: `taskId=${taskId} 不存在`,
      });
      return;
    }
    res.json(result);
  });
}
