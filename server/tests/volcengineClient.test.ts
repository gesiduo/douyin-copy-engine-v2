import test from "node:test";
import assert from "node:assert/strict";
import { pickTextByPath } from "../src/services/volcengineClient.js";

test("pickTextByPath should resolve nested string path", () => {
  const data = {
    data: {
      result: {
        text: "hello world",
      },
    },
  };
  assert.equal(pickTextByPath(data, "data.result.text"), "hello world");
});

test("pickTextByPath should return undefined for missing path", () => {
  const data = {
    data: {
      text: "abc",
    },
  };
  assert.equal(pickTextByPath(data, "data.result.text"), undefined);
});

test("pickTextByPath should return undefined for non-string value", () => {
  const data = {
    data: {
      text: 123,
    },
  };
  assert.equal(pickTextByPath(data, "data.text"), undefined);
});
