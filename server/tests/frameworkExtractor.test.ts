import test from "node:test";
import assert from "node:assert/strict";
import { composeFramework, extractFramework } from "../src/services/frameworkExtractor.js";

test("extractFramework should split text into five slots", () => {
  const source =
    "你是不是也总觉得时间不够用？每天加班还是做不完。后来我换了一个方法。把重点任务提前拆分，效率明显提升。你也可以现在试试。";
  const framework = extractFramework(source);

  assert.equal(framework.hook.length > 0, true);
  assert.equal(framework.painPoint.length > 0, true);
  assert.equal(framework.solution.length > 0, true);
  assert.equal(framework.evidence.length > 0, true);
  assert.equal(framework.cta.length > 0, true);
});

test("composeFramework should keep segment order", () => {
  const text = composeFramework({
    hook: "A",
    painPoint: "B",
    solution: "C",
    evidence: "D",
    cta: "E",
  });
  assert.equal(text, "A\nB\nC\nD\nE");
});
