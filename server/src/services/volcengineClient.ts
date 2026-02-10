import { z } from "zod";
import type { GenerateProductVariantsRequest, GenerateVariantsRequest } from "../types/copy.js";

const DEFAULT_ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const DEFAULT_TIMEOUT_MS = 30000;

const llmOutputSchema = z.object({
  versions: z.array(z.string().min(1)),
});

interface VolcengineLlmResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

function buildArkBaseUrl(): string {
  return process.env.VOLCENGINE_LLM_BASE_URL?.trim() || DEFAULT_ARK_BASE_URL;
}

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function safeParseJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function normalizeJsonBlock(content: string): string {
  const fenced = content.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  return content.trim();
}

function extractVersions(content: string, expectedCount: number): string[] {
  const normalized = normalizeJsonBlock(content);
  const parsed = safeParseJson(normalized);
  const schemaResult = llmOutputSchema.safeParse(parsed);
  if (!schemaResult.success) {
    throw new Error("INTERNAL_ERROR:LLM_OUTPUT_SCHEMA_INVALID");
  }

  const versions = schemaResult.data.versions
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, expectedCount);
  if (versions.length !== expectedCount) {
    throw new Error("INTERNAL_ERROR:LLM_OUTPUT_COUNT_INVALID");
  }
  return versions;
}

function getLlmTimeoutMs(): number {
  const raw = Number(process.env.VOLCENGINE_LLM_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.floor(raw);
}

function buildRewritePrompt(input: GenerateVariantsRequest): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    "你是短视频文案改写专家。",
    "目标：在不改变原文核心含义和框架顺序前提下，生成3个高度接近原文风格的版本。",
    "必须满足：",
    "1) 输出JSON格式：{\"versions\": [\"v1\", \"v2\", \"v3\"]}；不要输出其他字段。",
    "2) 每个版本字数在原文的90%-110%。",
    "3) 不新增原文不存在的事实信息。",
    "4) 三个版本做轻微差异，只做词句微调。",
  ].join("\n");

  const userPrompt = [
    `原文案：\n${input.sourceText}`,
    `variantCount=${input.variantCount}, strictness=${input.strictness}`,
    "请直接返回JSON。",
  ].join("\n\n");

  return { systemPrompt, userPrompt };
}

function buildProductPrompt(
  input: GenerateProductVariantsRequest,
): { systemPrompt: string; userPrompt: string } {
  const forbiddenWords = input.productInfo.forbiddenWords ?? [];
  const complianceNotes = input.productInfo.complianceNotes ?? [];
  const systemPrompt = [
    "你是短视频产品植入改写专家。",
    "目标：按原文结构框架（Hook/痛点/解决方案/证据/CTA）将产品信息自然替换，生成3个版本。",
    "必须满足：",
    "1) 输出JSON格式：{\"versions\": [\"v1\", \"v2\", \"v3\"]}；不要输出其他字段。",
    "2) 每个版本字数在原文的90%-110%。",
    "3) 语气和节奏与原文一致，禁止改成公文体或硬广腔。",
    "4) 每个版本至少覆盖2个卖点，三个版本合计覆盖全部卖点。",
    "5) 禁止出现禁用词。",
  ].join("\n");

  const userPrompt = [
    `原文案：\n${input.sourceText}`,
    `产品名：${input.productInfo.productName}`,
    `品类：${input.productInfo.category}`,
    `目标人群：${input.productInfo.targetAudience}`,
    `CTA：${input.productInfo.cta}`,
    `卖点：${input.productInfo.sellingPoints.join("；")}`,
    `禁用词：${forbiddenWords.join("；") || "无"}`,
    `合规备注：${complianceNotes.join("；") || "无"}`,
    "请直接返回JSON。",
  ].join("\n\n");

  return { systemPrompt, userPrompt };
}

async function requestArkChatCompletion(
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const apiKey = process.env.VOLCENGINE_LLM_API_KEY?.trim();
  const model = process.env.VOLCENGINE_LLM_MODEL?.trim();
  if (!apiKey || !model) {
    throw new Error("INTERNAL_ERROR:VOLCENGINE_LLM_NOT_CONFIGURED");
  }

  const baseUrl = buildArkBaseUrl();
  if (!isHttpUrl(baseUrl)) {
    throw new Error("INTERNAL_ERROR:VOLCENGINE_LLM_BASE_URL_INVALID");
  }
  const requestUrl = new URL("/chat/completions", baseUrl).toString();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getLlmTimeoutMs());
  try {
    const response = await fetch(requestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`MODEL_TIMEOUT:VOLCENGINE_LLM_HTTP_${response.status}`);
    }
    const data = (await response.json()) as VolcengineLlmResponse;
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("MODEL_TIMEOUT:VOLCENGINE_LLM_EMPTY_CONTENT");
    }
    return content;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("MODEL_TIMEOUT:VOLCENGINE_LLM_TIMEOUT");
    }
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("MODEL_TIMEOUT:VOLCENGINE_LLM_UNKNOWN");
  } finally {
    clearTimeout(timer);
  }
}

export function isVolcengineLlmConfigured(): boolean {
  return Boolean(process.env.VOLCENGINE_LLM_API_KEY?.trim() && process.env.VOLCENGINE_LLM_MODEL?.trim());
}

export async function generateRewriteVersionsByVolcengine(
  input: GenerateVariantsRequest,
): Promise<string[]> {
  const prompt = buildRewritePrompt(input);
  const content = await requestArkChatCompletion(prompt.systemPrompt, prompt.userPrompt);
  return extractVersions(content, input.variantCount);
}

export async function generateProductVersionsByVolcengine(
  input: GenerateProductVariantsRequest,
): Promise<string[]> {
  const prompt = buildProductPrompt(input);
  const content = await requestArkChatCompletion(prompt.systemPrompt, prompt.userPrompt);
  return extractVersions(content, input.variantCount);
}

export function pickTextByPath(data: unknown, path?: string): string | undefined {
  if (!path?.trim()) {
    return undefined;
  }
  const segments = path
    .split(".")
    .map((item) => item.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    return undefined;
  }

  let current: unknown = data;
  for (const segment of segments) {
    if (typeof current !== "object" || current === null || !(segment in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" ? current : undefined;
}
