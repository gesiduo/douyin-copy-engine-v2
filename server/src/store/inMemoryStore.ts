import { randomUUID } from "node:crypto";
import type {
  CopyOutputRecord,
  JobRecord,
  JobStatus,
  JobType,
  ProductInfo,
  ProductProfileRecord,
} from "../types/copy.js";

function nowIso(): string {
  return new Date().toISOString();
}

export class InMemoryStore {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly copyOutputs = new Map<string, CopyOutputRecord>();
  private readonly productProfiles = new Map<string, ProductProfileRecord>();
  private readonly requestIdToTaskId = new Map<string, string>();

  createJob(type: JobType, meta: Record<string, unknown>): JobRecord {
    const jobId = randomUUID();
    const record: JobRecord = {
      jobId,
      type,
      status: "queued",
      retryCount: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      meta,
    };
    this.jobs.set(jobId, record);
    return record;
  }

  setTaskIdByRequestId(clientRequestId: string, taskId: string): void {
    this.requestIdToTaskId.set(clientRequestId, taskId);
  }

  getTaskIdByRequestId(clientRequestId: string): string | undefined {
    return this.requestIdToTaskId.get(clientRequestId);
  }

  updateJobStatus(
    jobId: string,
    status: JobStatus,
    options?: {
      retryCount?: number;
      errorCode?: JobRecord["errorCode"];
      errorMessage?: string;
      transcriptText?: string;
      outputRef?: string;
    },
  ): JobRecord | undefined {
    const current = this.jobs.get(jobId);
    if (!current) {
      return undefined;
    }
    const updated: JobRecord = {
      ...current,
      status,
      retryCount: options?.retryCount ?? current.retryCount,
      errorCode: options?.errorCode ?? current.errorCode,
      errorMessage: options?.errorMessage ?? current.errorMessage,
      transcriptText: options?.transcriptText ?? current.transcriptText,
      outputRef: options?.outputRef ?? current.outputRef,
      updatedAt: nowIso(),
    };
    this.jobs.set(jobId, updated);
    return updated;
  }

  getJob(jobId: string): JobRecord | undefined {
    return this.jobs.get(jobId);
  }

  saveCopyOutput(output: CopyOutputRecord): void {
    this.copyOutputs.set(output.jobId, output);
  }

  getCopyOutput(jobId: string): CopyOutputRecord | undefined {
    return this.copyOutputs.get(jobId);
  }

  upsertProductProfile(input: ProductInfo): ProductProfileRecord {
    const profileId = randomUUID();
    const profile: ProductProfileRecord = {
      profileId,
      productName: input.productName,
      category: input.category,
      sellingPoints: input.sellingPoints,
      targetAudience: input.targetAudience,
      cta: input.cta,
      forbiddenWords: input.forbiddenWords ?? [],
      createdAt: nowIso(),
    };
    this.productProfiles.set(profileId, profile);
    return profile;
  }
}
