import type { Express, Request, Response } from "express";
import { z } from "zod";
import { InMemoryStore } from "../store/inMemoryStore.js";
import {
  generateProductWithQualityGate,
  generateRewriteWithQualityGate,
} from "../services/copyGenerator.js";
import type {
  CopyErrorCode,
  GenerateProductVariantsRequest,
  GenerateVariantsRequest,
  JobType,
  ProductInfo,
} from "../types/copy.js";

const rewriteSchema = z.object({
  sourceText: z.string().min(1, "sourceText 不能为空"),
  mode: z.literal("rewrite").default("rewrite"),
  variantCount: z.literal(3).default(3),
  strictness: z.literal("strict").default("strict"),
});

const productInfoSchema = z.object({
  productName: z.string().min(1),
  category: z.string().min(1),
  sellingPoints: z.array(z.string().min(1)).min(3).max(5),
  targetAudience: z.string().min(1),
  cta: z.string().min(1),
  forbiddenWords: z.array(z.string().min(1)).optional(),
  complianceNotes: z.array(z.string().min(1)).optional(),
});

const productVariantSchema = z.object({
  sourceText: z.string().min(1, "sourceText 不能为空"),
  mode: z.literal("product_adapt").default("product_adapt"),
  variantCount: z.literal(3).default(3),
  strictness: z.literal("strict").default("strict"),
  productInfo: productInfoSchema,
});

function serializeError(error: unknown): { errorCode: CopyErrorCode; errorMessage: string } {
  if (error instanceof Error) {
    if (error.message.startsWith("MODEL_TIMEOUT")) {
      return {
        errorCode: "MODEL_TIMEOUT",
        errorMessage: error.message,
      };
    }
    return {
      errorCode: error.message.startsWith("QC_FAILED") ? "QC_FAILED" : "INTERNAL_ERROR",
      errorMessage: error.message,
    };
  }
  return {
    errorCode: "INTERNAL_ERROR",
    errorMessage: "Unknown error",
  };
}

function enqueueGenerationJob(
  store: InMemoryStore,
  type: JobType,
  payload: GenerateVariantsRequest | GenerateProductVariantsRequest,
): string {
  const job = store.createJob(type, { mode: payload.mode });
  store.updateJobStatus(job.jobId, "generating");

  setImmediate(() => {
    void (async () => {
      try {
        if (payload.mode === "rewrite") {
          const result = await generateRewriteWithQualityGate(payload);
          store.saveCopyOutput({
            jobId: job.jobId,
            sourceText: payload.sourceText,
            versions: result.versions,
            qcReport: result.qcReport,
            modelMeta: {
              mode: payload.mode,
              strictness: payload.strictness,
              provider: process.env.VOLCENGINE_LLM_API_KEY ? "volcengine" : "local_fallback",
            },
            createdAt: new Date().toISOString(),
          });
          store.updateJobStatus(job.jobId, "succeeded", { outputRef: job.jobId });
          return;
        }

        const productPayload = payload as GenerateProductVariantsRequest;
        const profile = store.upsertProductProfile(productPayload.productInfo as ProductInfo);
        const result = await generateProductWithQualityGate(productPayload);
        store.saveCopyOutput({
          jobId: job.jobId,
          sourceText: productPayload.sourceText,
          versions: result.versions,
          qcReport: result.qcReport,
          modelMeta: {
            mode: productPayload.mode,
            strictness: productPayload.strictness,
            profileId: profile.profileId,
            provider: process.env.VOLCENGINE_LLM_API_KEY ? "volcengine" : "local_fallback",
          },
          createdAt: new Date().toISOString(),
        });
        store.updateJobStatus(job.jobId, "succeeded", { outputRef: job.jobId });
      } catch (error) {
        const serialized = serializeError(error);
        store.updateJobStatus(job.jobId, "failed", {
          errorCode: serialized.errorCode,
          errorMessage: serialized.errorMessage,
        });
      }
    })();
  });

  return job.jobId;
}

export function registerCopyRoutes(app: Express, store: InMemoryStore): void {
  app.post("/api/copy/variants", (req: Request, res: Response) => {
    const parseResult = rewriteSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        errorCode: "INVALID_INPUT",
        errorMessage: parseResult.error.flatten(),
      });
      return;
    }

    const jobId = enqueueGenerationJob(store, "rewrite", parseResult.data);
    res.status(202).json({ jobId, status: "queued" });
  });

  app.post("/api/copy/product-variants", (req: Request, res: Response) => {
    const parseResult = productVariantSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        errorCode: "INVALID_INPUT",
        errorMessage: parseResult.error.flatten(),
      });
      return;
    }

    const jobId = enqueueGenerationJob(store, "product_adapt", parseResult.data);
    res.status(202).json({ jobId, status: "queued" });
  });

  app.get("/api/jobs/:jobId", (req: Request, res: Response) => {
    const jobId = req.params.jobId;
    const job = store.getJob(jobId);
    if (!job) {
      res.status(404).json({
        errorCode: "NOT_FOUND",
        errorMessage: `jobId=${jobId} 不存在`,
      });
      return;
    }

    if (job.status !== "succeeded") {
      res.json({
        jobId: job.jobId,
        status: job.status,
        errorCode: job.errorCode,
        errorMessage: job.errorMessage,
      });
      return;
    }

    const output = store.getCopyOutput(job.jobId);
    if (!output) {
      res.status(500).json({
        jobId: job.jobId,
        status: "failed",
        errorCode: "INTERNAL_ERROR",
        errorMessage: "结果缺失",
      });
      return;
    }

    res.json({
      jobId: job.jobId,
      status: job.status,
      versions: output.versions,
      qcReport: output.qcReport,
    });
  });
}
