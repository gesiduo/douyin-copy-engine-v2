import test from "node:test";
import assert from "node:assert/strict";
import {
  extractShareUrl,
  extractVideoUrlFromDouyinRouterData,
} from "../src/services/transcriptPipeline.js";

test("extractShareUrl should parse normal https url", () => {
  const input = "复制此链接 https://v.douyin.com/abc123/ 打开抖音";
  assert.equal(extractShareUrl(input), "https://v.douyin.com/abc123/");
});

test("extractShareUrl should parse douyin domain without protocol", () => {
  const input = "复制打开抖音 v.douyin.com/AbCdEfG/";
  assert.equal(extractShareUrl(input), "https://v.douyin.com/AbCdEfG/");
});

test("extractShareUrl should strip trailing chinese punctuation", () => {
  const input = "链接：https://v.douyin.com/xyz123/，";
  assert.equal(extractShareUrl(input), "https://v.douyin.com/xyz123/");
});

test("extractShareUrl should return undefined when no url exists", () => {
  const input = "这里没有任何链接内容";
  assert.equal(extractShareUrl(input), undefined);
});

test("extractVideoUrlFromDouyinRouterData should read video_(id)/page path", () => {
  const routerData = {
    loaderData: {
      "video_(id)/page": {
        videoInfoRes: {
          item_list: [
            {
              video: {
                play_addr: {
                  url_list: ["https://aweme.snssdk.com/aweme/v1/playwm/?video_id=abc123"],
                },
              },
            },
          ],
        },
      },
    },
  } as Record<string, unknown>;

  const videoUrl = extractVideoUrlFromDouyinRouterData(routerData);
  assert.equal(videoUrl, "https://aweme.snssdk.com/aweme/v1/playwm/?video_id=abc123");
});

test("extractVideoUrlFromDouyinRouterData should fallback to video_layout path", () => {
  const routerData = {
    loaderData: {
      video_layout: {
        videoInfoRes: {
          item_list: [
            {
              video: {
                download_addr: {
                  url_list: ["https://aweme.snssdk.com/aweme/v1/play/?video_id=def456"],
                },
              },
            },
          ],
        },
      },
    },
  } as Record<string, unknown>;

  const videoUrl = extractVideoUrlFromDouyinRouterData(routerData);
  assert.equal(videoUrl, "https://aweme.snssdk.com/aweme/v1/play/?video_id=def456");
});
