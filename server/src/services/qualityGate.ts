import { extractFramework } from "./frameworkExtractor.js";
import type { QcReport, QcThresholds, VersionQcItem } from "../types/copy.js";

const DEFAULT_THRESHOLDS: QcThresholds = {
  minLengthRatio: 0.9,
  maxLengthRatio: 1.1,
  minStyleSimilarity: Number(process.env.STYLE_SIMILARITY_THRESHOLD ?? 0.82),
  minStructureMatchRate: 0.8,
  minSellingPointsPerVariant: 2,
};

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function getBigrams(input: string): Set<string> {
  const normalized = normalizeText(input);
  if (normalized.length <= 1) {
    return new Set(normalized ? [normalized] : []);
  }

  const grams = new Set<string>();
  for (let i = 0; i < normalized.length - 1; i += 1) {
    grams.add(normalized.slice(i, i + 2));
  }
  return grams;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const union = new Set<string>([...a, ...b]);
  if (union.size === 0) {
    return 1;
  }

  let intersectionCount = 0;
  for (const item of a) {
    if (b.has(item)) {
      intersectionCount += 1;
    }
  }
  return intersectionCount / union.size;
}

function sentenceAverageLength(text: string): number {
  const sentences = text
    .split(/[。！？!?]/u)
    .map((item) => item.trim())
    .filter(Boolean);
  if (sentences.length === 0) {
    return text.length;
  }
  const total = sentences.reduce((sum, current) => sum + current.length, 0);
  return total / sentences.length;
}

function rhythmSimilarity(sourceText: string, targetText: string): number {
  const sourceAvg = sentenceAverageLength(sourceText);
  const targetAvg = sentenceAverageLength(targetText);
  const base = Math.max(sourceAvg, 1);
  const ratioGap = Math.abs(sourceAvg - targetAvg) / base;
  return Math.max(0, 1 - ratioGap);
}

function styleSimilarity(sourceText: string, targetText: string): number {
  const lexical = jaccard(getBigrams(sourceText), getBigrams(targetText));
  const rhythm = rhythmSimilarity(sourceText, targetText);
  return Number((lexical * 0.75 + rhythm * 0.25).toFixed(4));
}

function structureMatchRate(sourceText: string, targetText: string): number {
  const source = extractFramework(sourceText);
  const target = extractFramework(targetText);
  const sourceSegments = [
    source.hook,
    source.painPoint,
    source.solution,
    source.evidence,
    source.cta,
  ].map((item) => item.trim());
  const targetSegments = [
    target.hook,
    target.painPoint,
    target.solution,
    target.evidence,
    target.cta,
  ].map((item) => item.trim());

  let matched = 0;
  for (let i = 0; i < sourceSegments.length; i += 1) {
    if (sourceSegments[i].length === 0) {
      matched += 1;
      continue;
    }
    const overlap = jaccard(getBigrams(sourceSegments[i]), getBigrams(targetSegments[i]));
    if (overlap >= 0.1 || targetSegments[i].length > 0) {
      matched += 1;
    }
  }
  return Number((matched / sourceSegments.length).toFixed(4));
}

function findForbiddenHits(text: string, forbiddenWords: string[]): string[] {
  const normalized = normalizeText(text);
  return forbiddenWords.filter((word) => {
    const cleaned = normalizeText(word);
    return cleaned.length > 0 && normalized.includes(cleaned);
  });
}

function findCoveredSellingPoints(text: string, sellingPoints: string[]): string[] {
  const normalized = normalizeText(text);
  return sellingPoints.filter((point) => {
    const cleaned = normalizeText(point);
    if (cleaned.length <= 1) {
      return false;
    }
    return normalized.includes(cleaned);
  });
}

function versionPass(
  item: VersionQcItem,
  mode: "rewrite" | "product_adapt",
  thresholds: QcThresholds,
): boolean {
  if (item.lengthRatio < thresholds.minLengthRatio || item.lengthRatio > thresholds.maxLengthRatio) {
    return false;
  }
  if (item.styleSimilarity < thresholds.minStyleSimilarity) {
    return false;
  }
  if (item.structureMatchRate < thresholds.minStructureMatchRate) {
    return false;
  }
  if (item.forbiddenHits.length > 0) {
    return false;
  }
  if (mode === "product_adapt" && item.sellingPointsCovered.length < thresholds.minSellingPointsPerVariant) {
    return false;
  }
  return true;
}

export interface EvaluateQualityInput {
  mode: "rewrite" | "product_adapt";
  sourceText: string;
  versions: string[];
  forbiddenWords?: string[];
  sellingPoints?: string[];
  thresholds?: Partial<QcThresholds>;
}

export function evaluateQuality(input: EvaluateQualityInput): QcReport {
  const thresholds: QcThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...input.thresholds,
  };
  const sourceLength = Math.max(input.sourceText.length, 1);
  const forbiddenWords = input.forbiddenWords ?? [];
  const sellingPoints = input.sellingPoints ?? [];

  const versionChecks = input.versions.map((version, index) => {
    const lengthRatio = Number((version.length / sourceLength).toFixed(4));
    const style = styleSimilarity(input.sourceText, version);
    const structure = structureMatchRate(input.sourceText, version);
    const forbiddenHits = findForbiddenHits(version, forbiddenWords);
    const covered = findCoveredSellingPoints(version, sellingPoints);

    const item: VersionQcItem = {
      index,
      textLength: version.length,
      lengthRatio,
      styleSimilarity: style,
      structureMatchRate: structure,
      forbiddenHits,
      sellingPointsCovered: covered,
      passed: false,
    };
    item.passed = versionPass(item, input.mode, thresholds);
    return item;
  });

  const allSellingPointsCovered =
    input.mode !== "product_adapt"
      ? true
      : sellingPoints.every((point) =>
          versionChecks.some((item) => item.sellingPointsCovered.includes(point)),
        );

  const overallPassed = versionChecks.every((item) => item.passed) && allSellingPointsCovered;
  return {
    mode: input.mode,
    sourceLength,
    versionChecks,
    allSellingPointsCovered,
    overallPassed,
    thresholds,
  };
}
