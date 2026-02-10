import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHighSimilarityRewriteVariants,
  normalizeVersionsForStrictLength,
} from "../src/services/copyGenerator.js";
import { evaluateQuality } from "../src/services/qualityGate.js";

test("normalizeVersionsForStrictLength should clamp long text to 110%", () => {
  const source = "a".repeat(100);
  const tooLong = "b".repeat(130);
  const [normalized] = normalizeVersionsForStrictLength(source, [tooLong]);
  assert.equal(normalized.length <= 110, true);
  assert.equal(normalized.length >= 90, true);
});

test("normalizeVersionsForStrictLength should pad short text to 90%", () => {
  const source = "a".repeat(100);
  const tooShort = "b".repeat(20);
  const [normalized] = normalizeVersionsForStrictLength(source, [tooShort]);
  assert.equal(normalized.length >= 90, true);
  assert.equal(normalized.length <= 110, true);
});

test("buildHighSimilarityRewriteVariants should satisfy strict rewrite QC", () => {
  const source =
    "今天这个做法真的很实用，尤其是你时间紧的时候，照着步骤来，效率会明显提升，马上就能看到变化。";
  const versions = buildHighSimilarityRewriteVariants(source, 3);
  const report = evaluateQuality({
    mode: "rewrite",
    sourceText: source,
    versions,
  });
  assert.equal(report.overallPassed, true);
});

test("buildHighSimilarityRewriteVariants should return truly distinct variants", () => {
  const source =
    "昨天朋友来家里唠嗑，随手给我塞了盒永显传家的冻干叉烧肉。吃一口直接被惊艳到，立马去网上下单。他家都是精选猪肉，传统腌制，冻干锁鲜工艺做的。";
  const versions = buildHighSimilarityRewriteVariants(source, 3);
  const distinctCount = new Set(versions.map((item) => item.replace(/\s+/g, ""))).size;
  assert.equal(distinctCount, 3);
});

test("buildHighSimilarityRewriteVariants should change wording sentence by sentence", () => {
  const source =
    "上次去同事家喝了这个果汁，立马 get 同款。它真的特别适合经常外卖、火锅、烧烤的姐妹。关键现在到手6瓶，你看看才多少钱？入口先是甘蔗的清甜，回味还有马蹄的清香。";
  const versions = buildHighSimilarityRewriteVariants(source, 3);
  const sourceSentences = source.split(/(?<=[。！？!?])/u).map((item) => item.trim()).filter(Boolean);
  for (const version of versions) {
    const versionSentences = version.split(/(?<=[。！？!?])/u).map((item) => item.trim()).filter(Boolean);
    assert.equal(versionSentences.length, sourceSentences.length);
    for (let i = 0; i < sourceSentences.length; i += 1) {
      assert.notEqual(versionSentences[i].replace(/\s+/g, ""), sourceSentences[i].replace(/\s+/g, ""));
    }
  }
});

test("buildHighSimilarityRewriteVariants should not append filler particles after douyin ending", () => {
  const source =
    "昨天朋友来家里唠嗑，随手给我塞了盒永显传家的冻干叉烧肉。吃一口直接被惊艳到，立马去网上下单。抖音";
  const versions = buildHighSimilarityRewriteVariants(source, 3);
  for (const version of versions) {
    assert.equal(/抖音[。！？!?]?[呀呢啊]/u.test(version), false);
    assert.equal(/抖音[。！？!?]?$/u.test(version), false);
  }
});
