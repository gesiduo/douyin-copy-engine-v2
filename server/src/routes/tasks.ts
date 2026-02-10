import type { Express, Request, Response } from "express";
import { z } from "zod";
import { TranscriptPipeline } from "../services/transcriptPipeline.js";

const createTaskSchema = z.object({
  shareText: z.string().min(1, "shareText 不能为空"),
  clientRequestId: z.string().min(1, "clientRequestId 不能为空"),
});

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

    const result = transcriptPipeline.createTask(parseResult.data);
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
