import test from "node:test";
import assert from "node:assert/strict";
import { evaluateQuality } from "../src/services/qualityGate.js";

test("evaluateQuality should pass strict checks for close variants", () => {
  const source =
    "你是不是也有这个困扰？每天忙到很晚，事情还是做不完。后来我调整了方法，把任务按优先级拆开，效率明显提升。你也可以试试看。";
  const versions = [
    "你是不是也有这个困扰？每天忙到很晚，事情还是做不完。后来我调整了做法，把任务按优先级拆开，效率明显提升。你也可以试试看。",
    "你是不是也有这个难题？每天忙到很晚，事情还是做不完。后来我调整了方法，把任务按优先级拆开，效率明显提升。你也可以试试看。",
    "你是不是也有这个困扰？每天忙到很晚，事情还是做不完。后来我换了个方法，把任务按优先级拆开，效率明显提升。你也可以试试看。",
  ];

  const report = evaluateQuality({
    mode: "rewrite",
    sourceText: source,
    versions,
  });

  assert.equal(report.overallPassed, true);
});

test("evaluateQuality should fail when forbidden word appears", () => {
  const report = evaluateQuality({
    mode: "product_adapt",
    sourceText: "今天聊聊一款产品怎么选。",
    versions: ["今天聊聊最强产品怎么选。", "第二版内容", "第三版内容"],
    forbiddenWords: ["最强"],
    sellingPoints: ["吸收快", "不粘腻", "温和"],
  });

  assert.equal(report.versionChecks[0].passed, false);
});
