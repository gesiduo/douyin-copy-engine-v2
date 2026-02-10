export type JobType = "transcript" | "rewrite" | "product_adapt";

export type JobStatus =
  | "queued"
  | "resolving"
  | "transcribing"
  | "generating"
  | "succeeded"
  | "failed";

export type TranscriptErrorCode =
  | "INVALID_LINK"
  | "UNSUPPORTED_VIDEO"
  | "RESOLVE_FAILED"
  | "ASR_TIMEOUT"
  | "ASR_FAILED"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export type CopyErrorCode =
  | "INVALID_INPUT"
  | "QC_FAILED"
  | "FORBIDDEN_WORD"
  | "MODEL_TIMEOUT"
  | "INTERNAL_ERROR";

export interface CreateTaskRequest {
  shareText: string;
  clientRequestId: string;
}

export interface CreateTaskResponse {
  taskId: string;
  status: "queued";
}

export interface TranscriptResult {
  taskId: string;
  status: JobStatus;
  transcriptText?: string;
  errorCode?: TranscriptErrorCode;
  errorMessage?: string;
}

export type StrictnessMode = "strict";

export interface GenerateVariantsRequest {
  sourceText: string;
  mode: "rewrite";
  variantCount: 3;
  strictness: StrictnessMode;
}

export interface ProductInfo {
  productName: string;
  category: string;
  sellingPoints: string[];
  targetAudience: string;
  cta: string;
  forbiddenWords?: string[];
  complianceNotes?: string[];
}

export interface GenerateProductVariantsRequest {
  sourceText: string;
  mode: "product_adapt";
  variantCount: 3;
  strictness: StrictnessMode;
  productInfo: ProductInfo;
}

export interface VersionQcItem {
  index: number;
  textLength: number;
  lengthRatio: number;
  styleSimilarity: number;
  structureMatchRate: number;
  forbiddenHits: string[];
  sellingPointsCovered: string[];
  passed: boolean;
}

export interface QcThresholds {
  minLengthRatio: number;
  maxLengthRatio: number;
  minStyleSimilarity: number;
  minStructureMatchRate: number;
  minSellingPointsPerVariant: number;
}

export interface QcReport {
  mode: "rewrite" | "product_adapt";
  sourceLength: number;
  versionChecks: VersionQcItem[];
  allSellingPointsCovered: boolean;
  overallPassed: boolean;
  thresholds: QcThresholds;
}

export interface GenerateResult {
  jobId: string;
  status: JobStatus;
  versions: string[];
  qcReport: QcReport;
}

export interface CopyFramework {
  hook: string;
  painPoint: string;
  solution: string;
  evidence: string;
  cta: string;
}

export interface JobRecord {
  jobId: string;
  type: JobType;
  status: JobStatus;
  retryCount: number;
  inputRef?: string;
  outputRef?: string;
  errorCode?: TranscriptErrorCode | CopyErrorCode;
  errorMessage?: string;
  transcriptText?: string;
  createdAt: string;
  updatedAt: string;
  meta: Record<string, unknown>;
}

export interface CopyOutputRecord {
  jobId: string;
  sourceText: string;
  versions: string[];
  qcReport: QcReport;
  modelMeta: Record<string, unknown>;
  createdAt: string;
}

export interface ProductProfileRecord {
  profileId: string;
  productName: string;
  category: string;
  sellingPoints: string[];
  targetAudience: string;
  cta: string;
  forbiddenWords: string[];
  createdAt: string;
}
