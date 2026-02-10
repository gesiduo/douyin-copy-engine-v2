import assert from "node:assert/strict";
import test from "node:test";
import { MediaProxyService, isPublicBaseUrl, normalizeBaseUrl } from "../src/services/mediaProxyService.js";

test("normalizeBaseUrl should keep origin and trim trailing slash", () => {
  assert.equal(normalizeBaseUrl("https://demo.example.com///"), "https://demo.example.com");
});

test("normalizeBaseUrl should return undefined on invalid protocol", () => {
  assert.equal(normalizeBaseUrl("ftp://demo.example.com"), undefined);
});

test("isPublicBaseUrl should reject localhost/private", () => {
  assert.equal(isPublicBaseUrl("http://localhost:3000"), false);
  assert.equal(isPublicBaseUrl("http://127.0.0.1:3000"), false);
  assert.equal(isPublicBaseUrl("http://192.168.1.11:3000"), false);
});

test("isPublicBaseUrl should accept public domain", () => {
  assert.equal(isPublicBaseUrl("https://douyin-copy-engine-v2.onrender.com"), true);
});

test("MediaProxyService createProxyUrl should skip non-public baseUrl", () => {
  const service = new MediaProxyService();
  const proxyUrl = service.createProxyUrl("https://aweme.snssdk.com/aweme/v1/play/?video_id=abc", "http://localhost:3000");
  assert.equal(proxyUrl, undefined);
});

test("MediaProxyService createProxyUrl should generate proxy url for public baseUrl", () => {
  const service = new MediaProxyService();
  const proxyUrl = service.createProxyUrl(
    "https://aweme.snssdk.com/aweme/v1/play/?video_id=abc",
    "https://douyin-copy-engine-v2.onrender.com",
  );
  assert.ok(proxyUrl?.startsWith("https://douyin-copy-engine-v2.onrender.com/api/media-proxy/"));
});
