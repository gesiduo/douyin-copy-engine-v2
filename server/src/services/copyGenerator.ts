import { composeFramework, extractFramework } from "./frameworkExtractor.js";
import { evaluateQuality } from "./qualityGate.js";
import {
  generateProductVersionsByVolcengine,
  generateRewriteVersionsByVolcengine,
  isVolcengineLlmConfigured,
} from "./volcengineClient.js";
import type {
  GenerateProductVariantsRequest,
  GenerateVariantsRequest,
  ProductInfo,
  QcReport,
} from "../types/copy.js";

const RHYTHM_WORDS = ["其实", "说白了", "关键是", "更重要的是", "换句话说"];
const CONNECTOR_WORDS = ["所以", "然后", "同时", "而且", "最后"];

const SYNONYM_MAP: Record<string, string[]> = {
  真的: ["确实", "的确", "实打实"],
  马上: ["立刻", "现在就", "当下"],
  非常: ["很", "特别", "相当"],
  大家: ["你们", "很多人", "大多数人"],
  问题: ["困扰", "痛点", "难题"],
  方法: ["做法", "方案", "路径"],
  简单: ["省心", "不复杂", "容易上手"],
};

const MICRO_REWRITE_MAP: Record<string, string[]> = {
  昨天: ["前一天", "前阵子", "那天"],
  随手: ["顺手", "顺手就", "随手就"],
  立马: ["马上", "立刻", "立马就"],
  马上: ["立马", "立刻", "马上就"],
  真的: ["确实", "真的挺", "真的是"],
  特别: ["挺", "蛮", "比较"],
  适合: ["合适", "对味", "适配"],
  关键: ["重点", "要点", "关键点"],
  现在: ["这会", "当下", "眼下"],
  看看: ["看下", "瞅下", "瞧瞧"],
  真实: ["真是", "确实", "真正"],
  传统: ["老式", "传统式", "老法子"],
  吸满: ["吸饱", "裹满", "沾满"],
  入口先是: ["入口先有", "入口先尝", "入口先感到"],
  回味还有: ["回味仍有", "回口还有", "回味还留着"],
  最绝的是: ["更绝的是", "最妙的是", "最出彩的是"],
  往面里一放: ["往面里一加", "放进面里", "往面里一拌"],
  舒服: ["舒服些", "舒服点", "舒坦"],
};

const MICRO_FALLBACK_INSERT = ["就", "还", "也"];

function pickBySeed<T>(items: T[], seed: number): T {
  return items[seed % items.length];
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?])/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function applySynonyms(input: string, seed: number): string {
  let result = input;
  for (const [from, toList] of Object.entries(SYNONYM_MAP)) {
    const replacement = pickBySeed(toList, seed);
    result = result.replaceAll(from, replacement);
  }
  return result;
}

function rewriteSegment(segment: string, seed: number): string {
  const sentences = splitSentences(segment);
  if (sentences.length === 0) {
    return segment;
  }
  return sentences
    .map((sentence, index) => {
      let current = applySynonyms(sentence, seed + index);
      if (index % 2 === 0) {
        current = `${pickBySeed(RHYTHM_WORDS, seed + index)}，${current}`;
      } else {
        current = `${pickBySeed(CONNECTOR_WORDS, seed + index)}，${current}`;
      }
      return current.replace(/，，+/g, "，");
    })
    .join("");
}

function sanitizeByForbiddenWords(input: string, forbiddenWords: string[]): string {
  let output = input;
  for (const forbiddenWord of forbiddenWords) {
    if (!forbiddenWord.trim()) {
      continue;
    }
    output = output.replaceAll(forbiddenWord, "");
  }
  return output;
}

function adjustLengthStrict(sourceText: string, draft: string): string {
  const sourceLength = Math.max(1, sourceText.length);
  const minLength = Math.ceil(sourceLength * 0.9);
  const maxLength = Math.max(minLength, Math.floor(sourceLength * 1.1));
  let output = draft.trim();
  const fillerSeed = "这点很关键。照着做就行。整体节奏会更顺。";

  if (output.length > maxLength) {
    output = output.slice(0, maxLength);
  }

  while (output.length < minLength) {
    const remain = minLength - output.length;
    if (remain <= fillerSeed.length) {
      output += fillerSeed.slice(0, remain);
      break;
    }
    output += fillerSeed;
  }

  if (output.length > maxLength) {
    output = output.slice(0, maxLength);
  }

  if (!/[。！？!?]$/u.test(output) && output.length > 0) {
    if (output.length >= maxLength) {
      output = `${output.slice(0, Math.max(0, maxLength - 1))}。`;
    } else {
      output += "。";
    }
  }

  if (output.length > maxLength) {
    output = output.slice(0, maxLength);
  }
  if (output.length < minLength) {
    output = output.padEnd(minLength, "。");
    if (output.length > maxLength) {
      output = output.slice(0, maxLength);
    }
  }
  return output;
}

export function normalizeVersionsForStrictLength(sourceText: string, versions: string[]): string[] {
  return versions.map((version) => adjustLengthStrict(sourceText, version));
}

function canonicalizeForDistinct(text: string): string {
  return text.replace(/\s+/g, "");
}

function normalizeSentenceForRewrite(input: string): string {
  return input.replace(/[。！？!?、，,\s]/gu, "").toLowerCase();
}

function shouldSkipSentenceRewrite(sentence: string): boolean {
  const normalized = normalizeSentenceForRewrite(sentence);
  if (!normalized) {
    return true;
  }
  if (normalized === "抖音" || normalized === "douyin") {
    return true;
  }
  return normalized.length <= 3;
}

function pickDifferent(optionList: string[], original: string, seed: number): string {
  const items = optionList.filter((item) => item !== original);
  if (items.length === 0) {
    return original;
  }
  return pickBySeed(items, seed);
}

function lexicalEqual(a: string, b: string): boolean {
  return normalizeSentenceForRewrite(a) === normalizeSentenceForRewrite(b);
}

function stripTrailingPlatformTag(text: string): string {
  const stripped = text
    .replace(/(?:[。！？!?，,\s]*(?:抖音|douyin)[。！？!?，,\s]*)+$/giu, "")
    .trim();
  return stripped || text.trim();
}

function applyMicroRewrite(sentence: string, seed: number): string {
  if (shouldSkipSentenceRewrite(sentence)) {
    return sentence;
  }

  let output = sentence;
  let changed = false;

  for (const [from, toList] of Object.entries(MICRO_REWRITE_MAP)) {
    if (output.includes(from) && !toList.includes(from)) {
      output = output.replace(from, pickDifferent(toList, from, seed));
      changed = true;
      break;
    }
  }

  if (!changed) {
    if (output.includes("这个")) {
      output = output.replace("这个", pickBySeed(["这款", "这瓶"], seed));
      changed = true;
    } else if (output.includes("它")) {
      output = output.replace("它", pickBySeed(["这", "这款"], seed));
      changed = true;
    } else if (output.includes("很")) {
      output = output.replace("很", pickBySeed(["挺", "蛮"], seed));
      changed = true;
    } else if (output.includes("真")) {
      output = output.replace("真", pickBySeed(["确实", "的确"], seed));
      changed = true;
    } else if (output.includes("就")) {
      output = output.replace("就", pickBySeed(["就会", "就能"], seed));
      changed = true;
    }
  }

  if (!changed) {
    if (output.includes("，")) {
      output = output.replace("，", `，${pickBySeed(MICRO_FALLBACK_INSERT, seed)}`);
      changed = true;
    } else if (output.includes("。")) {
      output = output.replace("。", `，${pickBySeed(["确实", "其实", "说实话"], seed)}。`);
      changed = true;
    }
  }

  if (!changed) {
    return sentence;
  }

  return output.replace(/，，+/g, "，");
}

function mutateAllSentences(text: string, variantIndex: number): string {
  const sentences = splitSentences(text.trim());
  if (sentences.length === 0) {
    return text.trim();
  }

  return sentences
    .map((sentence, sentenceIndex) => applyMicroRewrite(sentence, variantIndex * 31 + sentenceIndex * 7 + 11))
    .join("");
}

function enforceSentenceLevelDifferences(sourceText: string, versions: string[]): string[] {
  const sourceSentences = splitSentences(sourceText.trim());
  if (sourceSentences.length === 0) {
    return versions;
  }

  return versions.map((version, variantIndex) => {
    const currentSentences = splitSentences(version.trim());
    const merged = sourceSentences.map((sourceSentence, sentenceIndex) => {
      const currentSentence = currentSentences[sentenceIndex] || sourceSentence;
      if (shouldSkipSentenceRewrite(sourceSentence)) {
        return sourceSentence;
      }
      if (lexicalEqual(currentSentence, sourceSentence)) {
        return applyMicroRewrite(sourceSentence, variantIndex * 29 + sentenceIndex * 5 + 3);
      }
      return currentSentence;
    });
    for (let i = sourceSentences.length; i < currentSentences.length; i += 1) {
      merged.push(currentSentences[i]);
    }
    return merged.join("");
  });
}

function ensureDistinctVersions(sourceText: string, versions: string[]): string[] {
  const seen = new Set<string>();
  return versions.map((version, index) => {
    let current = version;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const key = canonicalizeForDistinct(current);
      if (!seen.has(key)) {
        seen.add(key);
        return current;
      }
      current = adjustLengthStrict(sourceText, mutateAllSentences(sourceText, index + attempt + 1));
    }
    const fallback = adjustLengthStrict(sourceText, mutateAllSentences(sourceText, index + 9));
    seen.add(canonicalizeForDistinct(fallback) + `#${index}`);
    return fallback;
  });
}

export function buildHighSimilarityRewriteVariants(sourceText: string, variantCount: 3): string[] {
  const cleanedSource = stripTrailingPlatformTag(sourceText);
  const variants: string[] = [];
  for (let i = 0; i < variantCount; i += 1) {
    variants.push(adjustLengthStrict(cleanedSource, mutateAllSentences(cleanedSource, i)));
  }
  const sentenceDiffed = enforceSentenceLevelDifferences(cleanedSource, variants);
  const normalized = normalizeVersionsForStrictLength(cleanedSource, sentenceDiffed);
  return ensureDistinctVersions(cleanedSource, normalized).map((item) => stripTrailingPlatformTag(item));
}

function buildRewriteVariants(sourceText: string, variantCount: 3, seedBase: number): string[] {
  const framework = extractFramework(sourceText);
  const variants: string[] = [];

  for (let i = 0; i < variantCount; i += 1) {
    const seed = seedBase + i * 7;
    const rewritten = composeFramework({
      hook: rewriteSegment(framework.hook, seed),
      painPoint: rewriteSegment(framework.painPoint, seed + 1),
      solution: rewriteSegment(framework.solution, seed + 2),
      evidence: rewriteSegment(framework.evidence, seed + 3),
      cta: rewriteSegment(framework.cta, seed + 4),
    });
    variants.push(adjustLengthStrict(sourceText, rewritten));
  }
  return variants;
}

function allocatePoints(sellingPoints: string[], variantIndex: number): string[] {
  if (sellingPoints.length === 0) {
    return [];
  }
  const first = sellingPoints[variantIndex % sellingPoints.length];
  const second = sellingPoints[(variantIndex + 1) % sellingPoints.length];
  if (first === second) {
    return [first];
  }
  return [first, second];
}

function adaptHook(rawHook: string, productInfo: ProductInfo): string {
  if (!rawHook.trim()) {
    return `如果你是${productInfo.targetAudience}，先看下${productInfo.productName}。`;
  }
  return rawHook.replace(/这|它|这个|这件事/g, productInfo.productName);
}

function adaptCta(rawCta: string, productInfo: ProductInfo): string {
  if (productInfo.cta.trim()) {
    return productInfo.cta.trim();
  }
  if (!rawCta.trim()) {
    return `想了解${productInfo.productName}，现在就试试。`;
  }
  return rawCta.replace(/这|它|这个|这件事/g, productInfo.productName);
}

function buildProductVariants(
  sourceText: string,
  productInfo: ProductInfo,
  variantCount: 3,
  seedBase: number,
): string[] {
  const framework = extractFramework(sourceText);
  const variants: string[] = [];

  for (let i = 0; i < variantCount; i += 1) {
    const points = allocatePoints(productInfo.sellingPoints, i);
    const pointText = points.join("，");
    const seed = seedBase + i * 11;
    const solutionBase = framework.solution || framework.painPoint || framework.hook;
    const evidenceBase = framework.evidence || framework.solution || framework.painPoint;
    const adapted = composeFramework({
      hook: rewriteSegment(adaptHook(framework.hook, productInfo), seed),
      painPoint: rewriteSegment(
        `${framework.painPoint} 尤其是${productInfo.targetAudience}，更在意效率和体验。`,
        seed + 1,
      ),
      solution: rewriteSegment(
        `${solutionBase} 如果换成${productInfo.productName}这类${productInfo.category}，关键是${pointText}。`,
        seed + 2,
      ),
      evidence: rewriteSegment(
        `${evidenceBase} 实际落地时，${productInfo.productName}的优势是${pointText}，整体更顺手。`,
        seed + 3,
      ),
      cta: rewriteSegment(adaptCta(framework.cta, productInfo), seed + 4),
    });
    variants.push(adjustLengthStrict(sourceText, adapted));
  }

  return variants;
}

export interface GenerateOutput {
  versions: string[];
  qcReport: QcReport;
}

export async function generateRewriteWithQualityGate(input: GenerateVariantsRequest): Promise<GenerateOutput> {
  let finalReport: QcReport | null = null;
  const maxRegenerateCount = 2;
  const preferVolcengine = isVolcengineLlmConfigured();
  let lastModelError: Error | null = null;
  const cleanedSourceText = stripTrailingPlatformTag(input.sourceText);
  const cleanedInput: GenerateVariantsRequest = { ...input, sourceText: cleanedSourceText };

  for (let attempt = 0; attempt <= maxRegenerateCount; attempt += 1) {
    let versions: string[];
    if (preferVolcengine) {
      try {
        versions = await generateRewriteVersionsByVolcengine(cleanedInput);
      } catch (error) {
        lastModelError = error instanceof Error ? error : new Error(String(error));
        versions = buildRewriteVariants(cleanedSourceText, input.variantCount, attempt * 17);
      }
    } else {
      versions = buildRewriteVariants(cleanedSourceText, input.variantCount, attempt * 17);
    }

    const normalizedVersions = normalizeVersionsForStrictLength(cleanedSourceText, versions);
    const sentenceDiffed = enforceSentenceLevelDifferences(cleanedSourceText, normalizedVersions);
    const renormalized = normalizeVersionsForStrictLength(cleanedSourceText, sentenceDiffed);
    const distinctVersions = ensureDistinctVersions(cleanedSourceText, renormalized).map((item) =>
      stripTrailingPlatformTag(item),
    );
    const report = evaluateQuality({
      mode: "rewrite",
      sourceText: cleanedSourceText,
      versions: distinctVersions,
    });
    finalReport = report;
    if (report.overallPassed) {
      return { versions: distinctVersions, qcReport: report };
    }
  }

  const safeVersions = buildHighSimilarityRewriteVariants(cleanedSourceText, input.variantCount);
  const safeReport = evaluateQuality({
    mode: "rewrite",
    sourceText: cleanedSourceText,
    versions: safeVersions,
  });
  if (safeReport.overallPassed) {
    return { versions: safeVersions, qcReport: safeReport };
  }

  if (lastModelError?.message?.startsWith("MODEL_TIMEOUT")) {
    throw lastModelError;
  }
  if (!finalReport) {
    throw new Error("QC_FAILED");
  }
  throw new Error(`QC_FAILED:${JSON.stringify(finalReport)}`);
}

export async function generateProductWithQualityGate(
  input: GenerateProductVariantsRequest,
): Promise<GenerateOutput> {
  let finalReport: QcReport | null = null;
  const maxRegenerateCount = 2;
  const forbiddenWords = input.productInfo.forbiddenWords ?? [];
  const preferVolcengine = isVolcengineLlmConfigured();
  let lastModelError: Error | null = null;

  for (let attempt = 0; attempt <= maxRegenerateCount; attempt += 1) {
    let drafts: string[];
    if (preferVolcengine) {
      try {
        drafts = await generateProductVersionsByVolcengine(input);
      } catch (error) {
        lastModelError = error instanceof Error ? error : new Error(String(error));
        drafts = buildProductVariants(input.sourceText, input.productInfo, input.variantCount, attempt * 19);
      }
    } else {
      drafts = buildProductVariants(input.sourceText, input.productInfo, input.variantCount, attempt * 19);
    }

    const sanitized = drafts.map((draft) => sanitizeByForbiddenWords(draft, forbiddenWords));
    const normalizedVersions = normalizeVersionsForStrictLength(input.sourceText, sanitized);
    const report = evaluateQuality({
      mode: "product_adapt",
      sourceText: input.sourceText,
      versions: normalizedVersions,
      forbiddenWords,
      sellingPoints: input.productInfo.sellingPoints,
    });
    finalReport = report;
    if (report.overallPassed) {
      return { versions: normalizedVersions, qcReport: report };
    }
  }

  if (lastModelError?.message?.startsWith("MODEL_TIMEOUT")) {
    throw lastModelError;
  }
  if (!finalReport) {
    throw new Error("QC_FAILED");
  }
  throw new Error(`QC_FAILED:${JSON.stringify(finalReport)}`);
}
