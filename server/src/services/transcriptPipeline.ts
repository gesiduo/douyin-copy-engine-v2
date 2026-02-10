import type {
  CreateTaskRequest,
  CreateTaskResponse,
  TranscriptErrorCode,
  TranscriptResult,
} from "../types/copy.js";
import { randomUUID } from "node:crypto";
import { InMemoryStore } from "../store/inMemoryStore.js";
import { pickTextByPath } from "./volcengineClient.js";

const URL_REGEX = /(https?:\/\/[^\s]+)/i;
const DOUYIN_URL_REGEX =
  /((?:v\.douyin\.com|www\.douyin\.com|douyin\.com|iesdouyin\.com)\/[^\s]+)/i;
const TRAILING_PUNCTUATION_REGEX = /[)\]}'"，。！？；：、,.!?;:]+$/u;

interface ResolverResponse {
  videoUrl?: string;
}

interface AsrResponse {
  transcriptText?: string;
}

interface BuiltInResolverResult {
  videoUrl?: string;
  reason?: string;
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

function allowMockTranscript(): boolean {
  const raw = process.env.ALLOW_MOCK_TRANSCRIPT;
  return raw?.toLowerCase?.() === "true";
}

function looksLikeArkChatEndpoint(url: string): boolean {
  return /\/chat\/completions\/?$/i.test(url.trim());
}

function looksLikeOpenSpeechFlashEndpoint(url: string): boolean {
  return /openspeech\.bytedance\.com\/api\/v3\/auc\/bigmodel\/recognize\/flash\/?$/i.test(url.trim());
}

function looksLikeOpenSpeechSubmitEndpoint(url: string): boolean {
  return /openspeech\.bytedance\.com\/api\/v3\/auc\/bigmodel\/submit\/?$/i.test(url.trim());
}

function toOpenSpeechQueryUrl(submitUrl: string): string {
  return submitUrl.replace(/\/submit\/?$/i, "/query");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLikelyDirectMediaUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (/\.(mp3|wav|m4a|aac|ogg|flac|mp4|mov|mkv)(\?|$)/i.test(lower)) {
    return true;
  }
  return (
    lower.includes("douyinvod.com/") ||
    lower.includes("bytecdn.cn/") ||
    lower.includes("volces.com/") ||
    lower.includes("media/")
  );
}

function isLikelyDouyinShareUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes("v.douyin.com/") ||
    lower.includes("iesdouyin.com/share/") ||
    lower.includes("douyin.com/share/") ||
    lower.includes("douyin.com/video/")
  );
}

function isAwemePlayableApiUrl(url: string): boolean {
  return /aweme\.snssdk\.com\/aweme\/v1\/play/i.test(url);
}

function extractRouterDataJson(html: string): string | undefined {
  const match = html.match(/window\._ROUTER_DATA\s*=\s*([\s\S]*?)<\/script>/i);
  if (!match?.[1]) {
    return undefined;
  }
  return match[1].trim().replace(/;\s*$/u, "");
}

export function extractVideoUrlFromDouyinRouterData(routerData: Record<string, unknown>): string | undefined {
  const candidates = [
    "loaderData.video_(id)/page.videoInfoRes.item_list.0.video.play_addr.url_list.0",
    "loaderData.video_(id)/page.videoInfoRes.item_list.0.video.play_addr_h264.url_list.0",
    "loaderData.video_(id)/page.videoInfoRes.item_list.0.video.download_addr.url_list.0",
    "loaderData.video_(id)/page.videoInfoRes.item_list.0.video.bit_rate.0.play_addr.url_list.0",
    "loaderData.video_layout.videoInfoRes.item_list.0.video.play_addr.url_list.0",
    "loaderData.video_layout.videoInfoRes.item_list.0.video.download_addr.url_list.0",
    "data.videoUrl",
    "videoUrl",
  ];
  for (const candidate of candidates) {
    const value = pickTextByPath(routerData, candidate);
    if (value?.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function sanitizeUrlCandidate(input: string): string {
  return input.trim().replace(TRAILING_PUNCTUATION_REGEX, "");
}

export function extractShareUrl(shareText: string): string | undefined {
  const direct = shareText.match(URL_REGEX)?.[1];
  if (direct) {
    return sanitizeUrlCandidate(direct);
  }

  const douyinDomain = shareText.match(DOUYIN_URL_REGEX)?.[1];
  if (douyinDomain) {
    return `https://${sanitizeUrlCandidate(douyinDomain)}`;
  }
  return undefined;
}

export class TranscriptPipeline {
  constructor(private readonly store: InMemoryStore) {}

  createTask(input: CreateTaskRequest): CreateTaskResponse {
    const existingTaskId = this.store.getTaskIdByRequestId(input.clientRequestId);
    if (existingTaskId) {
      return { taskId: existingTaskId, status: "queued" };
    }

    const job = this.store.createJob("transcript", {
      shareText: input.shareText,
      clientRequestId: input.clientRequestId,
    });
    this.store.setTaskIdByRequestId(input.clientRequestId, job.jobId);
    void this.process(job.jobId, input.shareText);
    return { taskId: job.jobId, status: "queued" };
  }

  getTask(taskId: string): TranscriptResult | undefined {
    const job = this.store.getJob(taskId);
    if (!job || job.type !== "transcript") {
      return undefined;
    }
    return {
      taskId,
      status: job.status,
      transcriptText: job.transcriptText,
      errorCode: job.errorCode as TranscriptErrorCode | undefined,
      errorMessage: job.errorMessage,
    };
  }

  private async process(taskId: string, shareText: string): Promise<void> {
    try {
      this.store.updateJobStatus(taskId, "resolving");
      const rawUrl = this.extractUrl(shareText);
      const resolvedVideoUrl = await this.resolveVideoUrl(rawUrl, shareText);
      this.store.updateJobStatus(taskId, "transcribing");
      const transcriptText = await this.transcribe(resolvedVideoUrl, shareText);
      this.store.updateJobStatus(taskId, "succeeded", {
        transcriptText,
      });
    } catch (error) {
      const mapped = this.mapError(error);
      this.store.updateJobStatus(taskId, "failed", {
        errorCode: mapped.errorCode,
        errorMessage: mapped.errorMessage,
      });
    }
  }

  private extractUrl(shareText: string): string {
    const extracted = extractShareUrl(shareText);
    if (!extracted) {
      throw new PipelineError("INVALID_LINK", "分享文本中未识别到有效链接。");
    }
    return extracted;
  }

  private async resolveVideoUrl(rawUrl: string, shareText: string): Promise<string> {
    const resolverApiUrl = process.env.VOLCENGINE_RESOLVER_API_URL || process.env.RESOLVER_API_URL;
    const resolverApiKey = process.env.VOLCENGINE_RESOLVER_API_KEY || process.env.RESOLVER_API_KEY;

    if (isLikelyDirectMediaUrl(rawUrl)) {
      return this.normalizeAsrMediaUrl(rawUrl);
    }

    let resolverErrorMessage = "";
    if (resolverApiUrl) {
      try {
        const response = await fetch(resolverApiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(resolverApiKey ? { Authorization: `Bearer ${resolverApiKey}` } : {}),
          },
          body: JSON.stringify({ shareText, url: rawUrl }),
        });

        if (!response.ok) {
          const responseText = (await response.text()).slice(0, 500);
          throw new PipelineError(
            "RESOLVE_FAILED",
            `解析服务返回状态码 ${response.status}，响应: ${responseText || "empty"}`,
          );
        }

        const data = (await response.json()) as ResolverResponse & Record<string, unknown>;
        const videoUrl = this.pickVideoUrlFromResolverResponse(data);
        if (videoUrl?.trim()) {
          return this.normalizeAsrMediaUrl(videoUrl.trim());
        }
        resolverErrorMessage = "解析服务未返回视频地址。";
      } catch (error) {
        if (error instanceof PipelineError) {
          resolverErrorMessage = error.message;
        } else {
          resolverErrorMessage = safeErrorMessage(error);
        }
      }
    }

    const builtInResolved = await this.resolveViaBuiltInDouyinPage(rawUrl);
    if (builtInResolved.videoUrl?.trim()) {
      return this.normalizeAsrMediaUrl(builtInResolved.videoUrl.trim());
    }

    const builtInReason = builtInResolved.reason || "内置解析器未提取到视频地址。";
    if (resolverErrorMessage) {
      throw new PipelineError("RESOLVE_FAILED", `${resolverErrorMessage}；并且${builtInReason}`);
    }
    throw new PipelineError(
      "RESOLVE_FAILED",
      `当前是分享页链接而非媒体直链。${builtInReason}。请配置 VOLCENGINE_RESOLVER_API_URL 将分享链接解析为可下载音视频URL，或直接传入媒体直链。`,
    );
  }

  private async transcribe(videoUrl: string, shareText: string): Promise<string> {
    const asrApiUrl = process.env.VOLCENGINE_ASR_API_URL || process.env.ASR_API_URL;
    const asrApiKey = process.env.VOLCENGINE_ASR_API_KEY || process.env.ASR_API_KEY;

    if (!asrApiUrl) {
      if (allowMockTranscript()) {
        return `这是根据抖音链接生成的模拟旁白转写文本。原始分享内容：${shareText}。视频地址：${videoUrl}。`;
      }
      throw new PipelineError(
        "ASR_FAILED",
        "未配置ASR接口。请设置 VOLCENGINE_ASR_API_URL / VOLCENGINE_ASR_API_KEY，或显式设置 ALLOW_MOCK_TRANSCRIPT=true。",
      );
    }
    if (looksLikeArkChatEndpoint(asrApiUrl)) {
      throw new PipelineError(
        "ASR_FAILED",
        "VOLCENGINE_ASR_API_URL 当前指向 Ark Chat 接口(/chat/completions)，请改为火山语音转写接口地址。",
      );
    }

    if (looksLikeOpenSpeechFlashEndpoint(asrApiUrl)) {
      return this.transcribeViaOpenSpeechFlash(asrApiUrl, videoUrl);
    }
    if (looksLikeOpenSpeechSubmitEndpoint(asrApiUrl)) {
      return this.transcribeViaOpenSpeechSubmit(asrApiUrl, videoUrl);
    }

    const timeoutMs = Number(process.env.ASR_TIMEOUT_MS ?? 120000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(asrApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(asrApiKey ? { Authorization: `Bearer ${asrApiKey}` } : {}),
        },
        body: JSON.stringify({
          videoUrl,
          video_url: videoUrl,
          url: videoUrl,
          audioUrl: videoUrl,
          language: "zh",
          model: process.env.VOLCENGINE_ASR_MODEL,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const responseText = await response.text();
        const responseTextForLog = responseText.slice(0, 500);
        throw new PipelineError(
          "ASR_FAILED",
          `ASR服务返回状态码 ${response.status}，响应: ${responseTextForLog || "empty"}`,
        );
      }

      const rawText = await response.text();
      let data: AsrResponse & Record<string, unknown> = {};
      try {
        data = rawText ? (JSON.parse(rawText) as AsrResponse & Record<string, unknown>) : {};
      } catch {
        throw new PipelineError("ASR_FAILED", "ASR服务响应非JSON。");
      }
      const transcriptText = this.pickTranscriptFromAsrResponse(data);
      if (!transcriptText) {
        throw new PipelineError("ASR_FAILED", "ASR服务未返回有效文本。");
      }
      return transcriptText;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new PipelineError("ASR_TIMEOUT", "ASR服务超时。");
      }
      if (error instanceof PipelineError) {
        throw error;
      }
      throw new PipelineError("ASR_FAILED", safeErrorMessage(error));
    } finally {
      clearTimeout(timer);
    }
  }

  private async transcribeViaOpenSpeechFlash(asrApiUrl: string, mediaUrl: string): Promise<string> {
    const appKey = process.env.VOLCENGINE_ASR_APP_KEY?.trim();
    const accessKey = process.env.VOLCENGINE_ASR_ACCESS_KEY?.trim();
    const apiKey = process.env.VOLCENGINE_ASR_API_KEY?.trim();
    const resourceId = process.env.VOLCENGINE_ASR_RESOURCE_ID?.trim() || "volc.bigasr.auc_turbo";
    const modelName = process.env.VOLCENGINE_ASR_MODEL?.trim() || "bigmodel";

    const hasDualKey = Boolean(appKey && accessKey);
    const hasSingleKey = Boolean(apiKey);
    if (!hasDualKey && !hasSingleKey) {
      throw new PipelineError(
        "ASR_FAILED",
        "OpenSpeech ASR 缺少鉴权参数。请设置 VOLCENGINE_ASR_API_KEY（单key）或 VOLCENGINE_ASR_APP_KEY + VOLCENGINE_ASR_ACCESS_KEY（双key）。",
      );
    }

    const timeoutMs = Number(process.env.ASR_TIMEOUT_MS ?? 120000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resourceCandidates = Array.from(
        new Set([resourceId, "volc.seedasr.auc", "volc.bigasr.auc", "volc.bigasr.auc_turbo"]),
      );
      const explicitPath = process.env.VOLCENGINE_ASR_TEXT_FIELD_PATH || process.env.ASR_TEXT_FIELD_PATH;
      let lastErrorMessage = "";
      let grantDeniedCount = 0;

      for (const candidateResourceId of resourceCandidates) {
        const response = await fetch(asrApiUrl, {
          method: "POST",
          headers: this.buildOpenSpeechHeaders({
            appKey,
            accessKey,
            apiKey,
            resourceId: candidateResourceId,
          }),
          body: JSON.stringify({
            user: {
              uid: appKey || "single-key-user",
            },
            audio: {
              url: mediaUrl,
            },
            request: {
              model_name: modelName,
            },
          }),
          signal: controller.signal,
        });

        const responseText = await response.text();
        const responseTextForLog = responseText.slice(0, 500);
        if (!response.ok) {
          lastErrorMessage = `OpenSpeech ASR状态码 ${response.status}，响应: ${responseTextForLog || "empty"}，resource_id=${candidateResourceId}`;
          if (this.isResourceDenied(responseText)) {
            grantDeniedCount += 1;
            continue;
          }
          throw new PipelineError("ASR_FAILED", lastErrorMessage);
        }

        let data: Record<string, unknown> = {};
        try {
          data = responseText ? (JSON.parse(responseText) as Record<string, unknown>) : {};
        } catch {
          throw new PipelineError("ASR_FAILED", `OpenSpeech ASR响应非JSON，resource_id=${candidateResourceId}`);
        }

        const headerCode = this.pickHeaderCode(data);
        const headerMessage = this.pickHeaderMessage(data);
        if (headerCode && headerCode !== 0) {
          lastErrorMessage = `OpenSpeech ASR业务失败 code=${headerCode} message=${headerMessage || "unknown"}，resource_id=${candidateResourceId}`;
          if (this.isResourceDenied(headerMessage || "") || this.isResourceDenied(String(headerCode || ""))) {
            grantDeniedCount += 1;
            continue;
          }
          throw new PipelineError("ASR_FAILED", lastErrorMessage);
        }

        const byPath = pickTextByPath(data, explicitPath) || pickTextByPath(data, "result.text");
        if (!byPath?.trim()) {
          lastErrorMessage = `OpenSpeech ASR未返回result.text，请检查 VOLCENGINE_ASR_TEXT_FIELD_PATH。resource_id=${candidateResourceId}`;
          throw new PipelineError("ASR_FAILED", lastErrorMessage);
        }
        return byPath.trim();
      }

      if (grantDeniedCount === resourceCandidates.length) {
        throw new PipelineError(
          "ASR_FAILED",
          `OpenSpeech 授权不足：当前账号对资源 ${resourceCandidates.join(", ")} 均无授权。请在火山控制台开通或改用已授权资源。`,
        );
      }

      throw new PipelineError("ASR_FAILED", lastErrorMessage || "OpenSpeech ASR 调用失败");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new PipelineError("ASR_TIMEOUT", "OpenSpeech ASR 超时。");
      }
      if (error instanceof PipelineError) {
        throw error;
      }
      throw new PipelineError("ASR_FAILED", safeErrorMessage(error));
    } finally {
      clearTimeout(timer);
    }
  }

  private async transcribeViaOpenSpeechSubmit(asrApiUrl: string, mediaUrl: string): Promise<string> {
    const appKey = process.env.VOLCENGINE_ASR_APP_KEY?.trim();
    const accessKey = process.env.VOLCENGINE_ASR_ACCESS_KEY?.trim();
    const apiKey = process.env.VOLCENGINE_ASR_API_KEY?.trim();
    const resourceId = process.env.VOLCENGINE_ASR_RESOURCE_ID?.trim() || "volc.seedasr.auc";
    const modelName = process.env.VOLCENGINE_ASR_MODEL?.trim() || "bigmodel";
    const explicitPath = process.env.VOLCENGINE_ASR_TEXT_FIELD_PATH || process.env.ASR_TEXT_FIELD_PATH;

    if (!apiKey && !(appKey && accessKey)) {
      throw new PipelineError(
        "ASR_FAILED",
        "OpenSpeech submit 缺少鉴权参数。请设置 VOLCENGINE_ASR_API_KEY（单key）或 VOLCENGINE_ASR_APP_KEY + VOLCENGINE_ASR_ACCESS_KEY（双key）。",
      );
    }

    const queryUrl = toOpenSpeechQueryUrl(asrApiUrl);
    const timeoutMs = Number(process.env.ASR_TIMEOUT_MS ?? 120000);
    const pollIntervalMs = Number(process.env.ASR_POLL_INTERVAL_MS ?? 1500);
    const maxPollTimes = Number(process.env.ASR_QUERY_MAX_POLLS ?? 40);

    const resourceCandidates = Array.from(
      new Set([resourceId, "volc.seedasr.auc", "volc.bigasr.auc", "volc.bigasr.auc_turbo"]),
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let lastError = "";
      let grantDeniedCount = 0;

      for (const candidateResourceId of resourceCandidates) {
        const requestId = randomUUID();
        const submitHeaders = this.buildOpenSpeechSubmitHeaders({
          appKey,
          accessKey,
          apiKey,
          resourceId: candidateResourceId,
          requestId,
        });

        const submitResp = await fetch(asrApiUrl, {
          method: "POST",
          headers: submitHeaders,
          body: JSON.stringify({
            user: {
              uid: appKey || "single-key-user",
            },
            audio: {
              url: mediaUrl,
            },
            request: {
              model_name: modelName,
            },
          }),
          signal: controller.signal,
        });

        const submitText = await submitResp.text();
        const submitTextForLog = submitText.slice(0, 500);
        const submitStatusCode = submitResp.headers.get("X-Api-Status-Code") || "";
        const submitMessage = submitResp.headers.get("X-Api-Message") || "";
        const submitLogId = submitResp.headers.get("X-Tt-Logid") || "";

        if (!submitResp.ok) {
          lastError = `OpenSpeech submit状态码 ${submitResp.status}，响应: ${submitTextForLog || "empty"}，resource_id=${candidateResourceId}`;
          if (this.isResourceDenied(submitText)) {
            grantDeniedCount += 1;
            continue;
          }
          throw new PipelineError("ASR_FAILED", lastError);
        }

        if (submitStatusCode && !["20000000", "20000001", "20000002"].includes(submitStatusCode)) {
          lastError = `OpenSpeech submit失败 code=${submitStatusCode} message=${submitMessage || "unknown"}，resource_id=${candidateResourceId}`;
          if (this.isResourceDenied(lastError)) {
            grantDeniedCount += 1;
            continue;
          }
          throw new PipelineError("ASR_FAILED", lastError);
        }

        for (let i = 0; i < maxPollTimes; i += 1) {
          const queryHeaders = this.buildOpenSpeechSubmitHeaders({
            appKey,
            accessKey,
            apiKey,
            resourceId: candidateResourceId,
            requestId,
            xTtLogId: submitLogId,
          });
          const queryResp = await fetch(queryUrl, {
            method: "POST",
            headers: queryHeaders,
            body: JSON.stringify({}),
            signal: controller.signal,
          });

          const queryText = await queryResp.text();
          const queryTextForLog = queryText.slice(0, 2000);
          const queryStatusCode = queryResp.headers.get("X-Api-Status-Code") || "";
          const queryMessage = queryResp.headers.get("X-Api-Message") || "";

          if (!queryResp.ok) {
            lastError = `OpenSpeech query状态码 ${queryResp.status}，响应: ${queryTextForLog || "empty"}，resource_id=${candidateResourceId}`;
            if (this.isResourceDenied(lastError)) {
              grantDeniedCount += 1;
              break;
            }
            throw new PipelineError("ASR_FAILED", lastError);
          }

          if (queryStatusCode === "20000001" || queryStatusCode === "20000002") {
            await sleep(pollIntervalMs);
            continue;
          }

          if (queryStatusCode && !["20000000", "20000001", "20000002"].includes(queryStatusCode)) {
            lastError = `OpenSpeech query失败 code=${queryStatusCode} message=${queryMessage || "unknown"}，resource_id=${candidateResourceId}`;
            if (this.isResourceDenied(lastError)) {
              grantDeniedCount += 1;
              break;
            }
            throw new PipelineError("ASR_FAILED", lastError);
          }

          if (!queryText.trim()) {
            if (i < maxPollTimes - 1) {
              await sleep(pollIntervalMs);
              continue;
            }
            throw new PipelineError("ASR_FAILED", "OpenSpeech query返回空响应，未获取到转写结果。");
          }

          let queryData: Record<string, unknown> = {};
          try {
            queryData = queryText ? (JSON.parse(queryText) as Record<string, unknown>) : {};
          } catch {
            if (i < maxPollTimes - 1) {
              await sleep(pollIntervalMs);
              continue;
            }
            throw new PipelineError("ASR_FAILED", "OpenSpeech query响应非JSON");
          }

          const headerCode = this.pickHeaderCode(queryData);
          const headerMessage = this.pickHeaderMessage(queryData) || queryMessage || "unknown";
          if (headerCode && headerCode !== 0) {
            lastError = `OpenSpeech query业务失败 code=${headerCode} message=${headerMessage}，resource_id=${candidateResourceId}`;
            if (this.isResourceDenied(lastError)) {
              grantDeniedCount += 1;
              break;
            }
            throw new PipelineError("ASR_FAILED", lastError);
          }

          const transcriptText = pickTextByPath(queryData, explicitPath) || pickTextByPath(queryData, "result.text");
          if (transcriptText?.trim()) {
            return transcriptText.trim();
          }
          // Query completed but no text means this path is wrong.
          throw new PipelineError(
            "ASR_FAILED",
            `OpenSpeech query完成但未返回文本，请检查 VOLCENGINE_ASR_TEXT_FIELD_PATH。resource_id=${candidateResourceId}`,
          );
        }
      }

      if (grantDeniedCount >= resourceCandidates.length) {
        throw new PipelineError(
          "ASR_FAILED",
          `OpenSpeech 授权不足：当前账号对资源 ${resourceCandidates.join(", ")} 均无授权。请在火山控制台开通或改用已授权资源。`,
        );
      }
      throw new PipelineError("ASR_FAILED", lastError || "OpenSpeech submit/query 调用失败");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new PipelineError("ASR_TIMEOUT", "OpenSpeech submit/query 超时。");
      }
      if (error instanceof PipelineError) {
        throw error;
      }
      throw new PipelineError("ASR_FAILED", safeErrorMessage(error));
    } finally {
      clearTimeout(timer);
    }
  }

  private isResourceDenied(message: string): boolean {
    const normalized = message.toLowerCase();
    return (
      normalized.includes("requested grant not found") ||
      normalized.includes("is not allowed") ||
      normalized.includes("45000010") ||
      normalized.includes("45000000")
    );
  }

  private pickHeaderCode(data: Record<string, unknown>): number | undefined {
    const header = data.header;
    if (!header || typeof header !== "object") {
      return undefined;
    }
    const code = (header as Record<string, unknown>).code;
    return typeof code === "number" ? code : undefined;
  }

  private pickHeaderMessage(data: Record<string, unknown>): string | undefined {
    const header = data.header;
    if (!header || typeof header !== "object") {
      return undefined;
    }
    const message = (header as Record<string, unknown>).message;
    return typeof message === "string" ? message : undefined;
  }

  private mapError(error: unknown): { errorCode: TranscriptErrorCode; errorMessage: string } {
    if (error instanceof PipelineError) {
      return { errorCode: error.code, errorMessage: error.message };
    }
    return {
      errorCode: "INTERNAL_ERROR",
      errorMessage: safeErrorMessage(error),
    };
  }

  private pickVideoUrlFromResolverResponse(data: Record<string, unknown>): string | undefined {
    const explicitPath = process.env.VOLCENGINE_RESOLVER_VIDEO_URL_FIELD_PATH || process.env.RESOLVER_VIDEO_URL_FIELD_PATH;
    const explicitValue = pickTextByPath(data, explicitPath);
    if (explicitValue?.trim()) {
      return explicitValue.trim();
    }

    const candidates = [
      "videoUrl",
      "video_url",
      "url",
      "data.videoUrl",
      "data.video_url",
      "data.url",
      "result.videoUrl",
      "result.video_url",
      "result.url",
    ];
    for (const candidate of candidates) {
      const value = pickTextByPath(data, candidate);
      if (value?.trim()) {
        return value.trim();
      }
    }
    return undefined;
  }

  private async resolveViaBuiltInDouyinPage(rawUrl: string): Promise<BuiltInResolverResult> {
    if (!isLikelyDouyinShareUrl(rawUrl)) {
      return { reason: "链接不是抖音分享页" };
    }

    const controller = new AbortController();
    const timeoutMs = Number(process.env.RESOLVER_TIMEOUT_MS ?? 15000);
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(rawUrl, {
        method: "GET",
        redirect: "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          Referer: "https://www.douyin.com/",
          "Accept-Language": "zh-CN,zh;q=0.9",
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        return { reason: `内置解析请求失败，状态码 ${response.status}` };
      }

      const html = await response.text();
      const routerDataText = extractRouterDataJson(html);
      if (!routerDataText) {
        return { reason: "分享页未找到 window._ROUTER_DATA" };
      }

      let routerData: Record<string, unknown> = {};
      try {
        routerData = JSON.parse(routerDataText) as Record<string, unknown>;
      } catch {
        return { reason: "window._ROUTER_DATA 解析失败" };
      }

      const videoUrl = extractVideoUrlFromDouyinRouterData(routerData);
      if (!videoUrl?.trim()) {
        return { reason: "window._ROUTER_DATA 中未找到视频地址" };
      }
      return { videoUrl: videoUrl.trim() };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return { reason: "内置解析超时" };
      }
      return { reason: `内置解析异常: ${safeErrorMessage(error)}` };
    } finally {
      clearTimeout(timer);
    }
  }

  private async normalizeAsrMediaUrl(url: string): Promise<string> {
    if (!isAwemePlayableApiUrl(url)) {
      return url;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        },
        signal: controller.signal,
      });
      const location = response.headers.get("location");
      if (!location?.trim()) {
        return url;
      }
      return sanitizeUrlCandidate(location.trim());
    } catch {
      return url;
    } finally {
      clearTimeout(timer);
    }
  }

  private pickTranscriptFromAsrResponse(data: Record<string, unknown>): string | undefined {
    const explicitPath = process.env.VOLCENGINE_ASR_TEXT_FIELD_PATH || process.env.ASR_TEXT_FIELD_PATH;
    const explicitValue = pickTextByPath(data, explicitPath);
    if (explicitValue?.trim()) {
      return explicitValue.trim();
    }

    const candidates = [
      "transcriptText",
      "text",
      "result",
      "data.transcriptText",
      "data.text",
      "data.result",
      "payload.text",
      "payload.result",
    ];
    for (const candidate of candidates) {
      const value = pickTextByPath(data, candidate);
      if (value?.trim()) {
        return value.trim();
      }
    }
    return undefined;
  }

  private buildOpenSpeechHeaders(input: {
    appKey?: string;
    accessKey?: string;
    apiKey?: string;
    resourceId: string;
  }): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Api-Resource-Id": input.resourceId,
      "X-Api-Request-Id": randomUUID(),
      "X-Api-Sequence": "-1",
    };
    if (input.appKey) {
      headers["X-Api-App-Key"] = input.appKey;
    }
    if (input.accessKey) {
      headers["X-Api-Access-Key"] = input.accessKey;
    }
    if (input.apiKey) {
      headers.Authorization = `Bearer ${input.apiKey}`;
      if (!input.accessKey) {
        headers["X-Api-Access-Key"] = input.apiKey;
      }
      if (!input.appKey) {
        headers["X-Api-App-Key"] = input.apiKey;
      }
    }
    return headers;
  }

  private buildOpenSpeechSubmitHeaders(input: {
    appKey?: string;
    accessKey?: string;
    apiKey?: string;
    resourceId: string;
    requestId: string;
    xTtLogId?: string;
  }): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Api-Resource-Id": input.resourceId,
      "X-Api-Request-Id": input.requestId,
      "X-Api-Sequence": "-1",
    };
    if (input.appKey) {
      headers["X-Api-App-Key"] = input.appKey;
    }
    if (input.accessKey) {
      headers["X-Api-Access-Key"] = input.accessKey;
    }
    if (input.apiKey) {
      headers["x-api-key"] = input.apiKey;
    }
    if (input.xTtLogId) {
      headers["X-Tt-Logid"] = input.xTtLogId;
    }
    return headers;
  }
}

class PipelineError extends Error {
  constructor(public readonly code: TranscriptErrorCode, message: string) {
    super(message);
    this.name = "PipelineError";
  }
}
