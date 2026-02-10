import type { CopyFramework } from "../types/copy.js";

const SENTENCE_SPLIT_REGEX = /(?<=[。！？!?])/u;

function normalizeSentence(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function splitSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(SENTENCE_SPLIT_REGEX))
    .map(normalizeSentence)
    .filter(Boolean);
}

function fallbackSegment(candidate: string, fallback: string): string {
  return candidate.trim().length > 0 ? candidate.trim() : fallback.trim();
}

export function extractFramework(sourceText: string): CopyFramework {
  const sentences = splitSentences(sourceText);
  if (sentences.length === 0) {
    return {
      hook: "",
      painPoint: "",
      solution: "",
      evidence: "",
      cta: "",
    };
  }

  const hook = sentences[0] ?? "";
  const cta = sentences.length > 1 ? sentences[sentences.length - 1] : "";
  const middle = sentences.slice(1, Math.max(1, sentences.length - 1));

  const painPoint = middle[0] ?? "";
  const solution = middle[1] ?? "";
  const evidence = middle.slice(2).join(" ");

  const mergedMiddle = middle.join(" ");

  return {
    hook: fallbackSegment(hook, sourceText),
    painPoint: fallbackSegment(painPoint, mergedMiddle),
    solution: fallbackSegment(solution, mergedMiddle),
    evidence: fallbackSegment(evidence, mergedMiddle),
    cta: fallbackSegment(cta, hook),
  };
}

export function composeFramework(framework: CopyFramework): string {
  return [
    framework.hook,
    framework.painPoint,
    framework.solution,
    framework.evidence,
    framework.cta,
  ]
    .map((item) => item.trim())
    .filter(Boolean)
    .join("\n");
}
