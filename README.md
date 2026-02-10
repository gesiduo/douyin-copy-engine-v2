# 抖音小程序文案引擎 V2

## 本地运行
1. 安装 Node.js 20+  
2. 安装依赖：
```bash
cd /Users/lizhan/Desktop/sandbox
npm install
```
3. 配置环境变量：
```bash
cp /Users/lizhan/Desktop/sandbox/.env.example /Users/lizhan/Desktop/sandbox/.env.local
```
按你在火山云控制台拿到的信息填写：
- `VOLCENGINE_LLM_API_KEY`
- `VOLCENGINE_LLM_MODEL`
- `VOLCENGINE_ASR_API_URL`
- `VOLCENGINE_ASR_API_KEY`（单key模式可直接使用）
- `VOLCENGINE_ASR_APP_KEY`（OpenSpeech 推荐）
- `VOLCENGINE_ASR_ACCESS_KEY`（OpenSpeech 推荐）
- `VOLCENGINE_ASR_RESOURCE_ID=volc.bigasr.auc_turbo`（OpenSpeech 推荐）
- `VOLCENGINE_ASR_TEXT_FIELD_PATH`（如果返回字段不是 `text`）
- `VOLCENGINE_RESOLVER_API_URL`（可选）
- `VOLCENGINE_RESOLVER_VIDEO_URL_FIELD_PATH`（可选）
- `ALLOW_MOCK_TRANSCRIPT=false`（默认，未配置 ASR 时直接报错）

注意：`VOLCENGINE_ASR_API_URL` 不能填 Ark 聊天接口 `.../chat/completions`。
OpenSpeech 鉴权支持两种方式：
1. 单 key：`VOLCENGINE_ASR_API_KEY`
2. 双 key：`VOLCENGINE_ASR_APP_KEY + VOLCENGINE_ASR_ACCESS_KEY`
ASR 接口地址支持：
1. `.../recognize/flash`（同步极速版）
2. `.../submit`（异步提交，后端自动轮询 `.../query`）

抖音链接解析策略：
1. 优先调用 `VOLCENGINE_RESOLVER_API_URL`（如果已配置）
2. 未配置或解析失败时，后端会尝试内置解析器（从分享页 `window._ROUTER_DATA` 提取视频地址）
3. 若目标链接反爬策略升级导致内置解析失效，再接入火山函数解析服务

4. 启动后端：
```bash
npm run dev
```
后端会自动读取 `/Users/lizhan/Desktop/sandbox/.env.local`，无需手动 `source`。
5. 健康检查：
```bash
curl http://127.0.0.1:3000/healthz
```
6. 打开浏览器测试页：
```text
http://127.0.0.1:3000/
```

## 云端部署（Render，推荐）
目标：部署一次，测试者只需浏览器访问，无需本地安装 Node。

1. 把项目推到 GitHub（或 Render 支持的 Git 仓库）。
2. 在 Render 创建 Web Service，选择该仓库。
3. Render 配置（可直接读仓库根目录 `render.yaml`）：
```text
Build Command: npm ci && npm run build
Start Command: npm run start
Health Check Path: /healthz
```
4. 在 Render 环境变量中填写：
- `VOLCENGINE_LLM_BASE_URL=https://ark.cn-beijing.volces.com/api/v3`
- `VOLCENGINE_LLM_API_KEY`
- `VOLCENGINE_LLM_MODEL`
- `VOLCENGINE_ASR_API_URL`
- `VOLCENGINE_ASR_API_KEY`（或双key：`VOLCENGINE_ASR_APP_KEY` + `VOLCENGINE_ASR_ACCESS_KEY`）
- `VOLCENGINE_ASR_RESOURCE_ID`（示例：`volc.seedasr.auc`）
- `VOLCENGINE_ASR_TEXT_FIELD_PATH=result.text`
- `ALLOW_MOCK_TRANSCRIPT=false`
- `ASR_TIMEOUT_MS=120000`
5. 部署成功后：
- 健康检查：`https://你的域名/healthz`
- 网页测试入口：`https://你的域名/`

详细步骤见：`/Users/lizhan/Desktop/sandbox/docs/deploy-render.md`

## 目录
- `/Users/lizhan/Desktop/sandbox/server`：API 服务
- `/Users/lizhan/Desktop/sandbox/miniapp`：抖音小程序页面
- `/Users/lizhan/Desktop/sandbox/docs/api.md`：接口说明

## 测试
```bash
npm test
```
