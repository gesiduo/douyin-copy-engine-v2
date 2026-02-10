# Douyin Copy Engine V2 API

## Base URL
- `http://localhost:3000`

## 1) 创建转写任务
- `POST /api/tasks`

Request:
```json
{
  "shareText": "7.21 复制打开抖音 https://v.douyin.com/xxxx/",
  "clientRequestId": "req-20260209-001"
}
```

Response `202`:
```json
{
  "taskId": "8f6f6de2-8a6c-4c17-a0f1-c5459d5a86f9",
  "status": "queued"
}
```

## 2) 查询转写任务
- `GET /api/tasks/{taskId}`

Response `200`:
```json
{
  "taskId": "8f6f6de2-8a6c-4c17-a0f1-c5459d5a86f9",
  "status": "succeeded",
  "transcriptText": "这是旁白转写文本..."
}
```

失败示例:
```json
{
  "taskId": "8f6f6de2-8a6c-4c17-a0f1-c5459d5a86f9",
  "status": "failed",
  "errorCode": "ASR_FAILED",
  "errorMessage": "ASR服务返回状态码 500"
}
```

## 3) 生成三版本改写
- `POST /api/copy/variants`

Request:
```json
{
  "sourceText": "原始文案文本",
  "mode": "rewrite",
  "variantCount": 3,
  "strictness": "strict"
}
```

Response `202`:
```json
{
  "jobId": "ef7ca4ee-fda4-418d-9aeb-bb6f583f1f96",
  "status": "queued"
}
```

## 4) 生成产品套框架三版本
- `POST /api/copy/product-variants`

Request:
```json
{
  "sourceText": "原始文案文本",
  "mode": "product_adapt",
  "variantCount": 3,
  "strictness": "strict",
  "productInfo": {
    "productName": "XX精华液",
    "category": "护肤品",
    "sellingPoints": ["吸收快", "不粘腻", "成分温和"],
    "targetAudience": "通勤女性",
    "cta": "想要清爽保湿，现在就试试。",
    "forbiddenWords": ["最强", "根治"],
    "complianceNotes": ["避免医疗功效承诺"]
  }
}
```

Response `202`:
```json
{
  "jobId": "7f742066-9181-4d6d-bc1e-f2b6ef7d2672",
  "status": "queued"
}
```

## 5) 查询文案任务
- `GET /api/jobs/{jobId}`

处理中:
```json
{
  "jobId": "7f742066-9181-4d6d-bc1e-f2b6ef7d2672",
  "status": "generating"
}
```

成功:
```json
{
  "jobId": "7f742066-9181-4d6d-bc1e-f2b6ef7d2672",
  "status": "succeeded",
  "versions": ["版本1", "版本2", "版本3"],
  "qcReport": {
    "mode": "product_adapt",
    "sourceLength": 120,
    "versionChecks": [],
    "allSellingPointsCovered": true,
    "overallPassed": true,
    "thresholds": {
      "minLengthRatio": 0.9,
      "maxLengthRatio": 1.1,
      "minStyleSimilarity": 0.82,
      "minStructureMatchRate": 0.8,
      "minSellingPointsPerVariant": 2
    }
  }
}
```

## 错误码
- 通用: `INVALID_INPUT`, `NOT_FOUND`, `INTERNAL_ERROR`
- 转写: `INVALID_LINK`, `RESOLVE_FAILED`, `ASR_TIMEOUT`, `ASR_FAILED`
- 文案: `QC_FAILED`, `FORBIDDEN_WORD`, `MODEL_TIMEOUT`

## 环境变量
- `PORT` 默认 `3000`
- `VOLCENGINE_LLM_BASE_URL` 默认 `https://ark.cn-beijing.volces.com/api/v3`
- `VOLCENGINE_LLM_API_KEY`, `VOLCENGINE_LLM_MODEL`, `VOLCENGINE_LLM_TIMEOUT_MS`
- `VOLCENGINE_ASR_API_URL`, `VOLCENGINE_ASR_API_KEY`, `VOLCENGINE_ASR_MODEL`
- `VOLCENGINE_ASR_APP_KEY`, `VOLCENGINE_ASR_ACCESS_KEY`, `VOLCENGINE_ASR_RESOURCE_ID`
- `VOLCENGINE_ASR_TEXT_FIELD_PATH`（可选，示例：`data.text`）
- `VOLCENGINE_RESOLVER_API_URL`, `VOLCENGINE_RESOLVER_API_KEY`
- `VOLCENGINE_RESOLVER_VIDEO_URL_FIELD_PATH`（可选，示例：`data.video_url`）
- `RESOLVER_TIMEOUT_MS`（可选，内置分享页解析超时，默认 `15000`）
- `ASR_TIMEOUT_MS`（可选，默认 `120000`）
- `STYLE_SIMILARITY_THRESHOLD` 默认 `0.82`
- `ALLOW_MOCK_TRANSCRIPT` 默认 `false`（为 `true` 时未配置 ASR 会返回模拟文本）
- `PUBLIC_BASE_URL`（云端建议必填，例如 `https://your-app.onrender.com`，用于 ASR 媒体代理）
- `ASR_MEDIA_PROXY_FORCE`（可选，默认 `false`，为 `true` 时所有 ASR 请求都走媒体代理）

## 供应商说明（火山云）
- 文案生成默认优先走火山云 Ark（`VOLCENGINE_LLM_*`），未配置时回退本地规则生成。
- 转写默认优先走火山云 ASR URL（`VOLCENGINE_ASR_*`），未配置时返回模拟文本（便于联调）。
- 链接解析优先调用 `VOLCENGINE_RESOLVER_API_URL`；若未配置或失败，后端会尝试从抖音分享页 `window._ROUTER_DATA` 自动提取视频 URL。
- 若分享页解析被反爬策略拦截，建议接火山函数网关作为 `VOLCENGINE_RESOLVER_API_URL`，返回稳定视频 URL。
- 注意：`VOLCENGINE_ASR_API_URL` 不能使用 Ark 聊天地址（`.../chat/completions`），那是 LLM 接口。
- 如果你使用 OpenSpeech 极速版，`VOLCENGINE_ASR_API_URL` 形如：
  `https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash`
  鉴权可用单 key（`VOLCENGINE_ASR_API_KEY`）或双 key（`VOLCENGINE_ASR_APP_KEY + VOLCENGINE_ASR_ACCESS_KEY`）。
- 如果你使用 OpenSpeech 标准版异步提交，`VOLCENGINE_ASR_API_URL` 可设置为：
  `https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit`
  后端会自动轮询对应 `.../query` 获取最终文本。
- 如果报错 `Invalid audio URI` / `audio download failed`，优先检查：
  1. `PUBLIC_BASE_URL` 是否填写成可公网访问的服务域名；
  2. 是否已重新部署使媒体代理生效；
  3. 必要时设置 `ASR_MEDIA_PROXY_FORCE=true` 再试。
