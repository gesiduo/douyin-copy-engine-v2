# Render 云端部署指南（给普通测试用户用）

## 目标
部署后，测试者只需要打开浏览器访问 `https://你的域名/`，粘贴抖音分享文案即可使用。

## 1. 准备代码仓库
1. 把项目推送到 GitHub/GitLab。
2. 确认仓库里有：
- `/Users/lizhan/Desktop/sandbox/render.yaml`
- `/Users/lizhan/Desktop/sandbox/web/index.html`

## 2. 在 Render 创建服务
1. 登录 Render，点击 `New +` -> `Web Service`。
2. 选择你的仓库和分支。
3. 如果让 Render 自动读取 `render.yaml`，直接继续即可。
4. 若手动填写，使用：
- Build Command: `npm ci && npm run build`
- Start Command: `npm run start`
- Health Check Path: `/healthz`
- Runtime: Node 20+

## 3. 配置环境变量（必须）
在 Render 的 Environment 中添加以下变量：

- `VOLCENGINE_LLM_BASE_URL=https://ark.cn-beijing.volces.com/api/v3`
- `VOLCENGINE_LLM_API_KEY=<你的LLM新Key>`
- `VOLCENGINE_LLM_MODEL=<你的模型ID>`
- `VOLCENGINE_ASR_API_URL=<你的ASR地址>`
- `VOLCENGINE_ASR_API_KEY=<你的ASR新Key>`  
  说明：如果使用双key模式，则改为配置：
  - `VOLCENGINE_ASR_APP_KEY`
  - `VOLCENGINE_ASR_ACCESS_KEY`
- `VOLCENGINE_ASR_RESOURCE_ID=volc.seedasr.auc`
- `VOLCENGINE_ASR_TEXT_FIELD_PATH=result.text`
- `ALLOW_MOCK_TRANSCRIPT=false`
- `ASR_TIMEOUT_MS=120000`
- `PUBLIC_BASE_URL=https://你的域名`
- `ASR_MEDIA_PROXY_FORCE=false`（可选）
- `STYLE_SIMILARITY_THRESHOLD=0.82`

可选变量：
- `VOLCENGINE_RESOLVER_API_URL`
- `VOLCENGINE_RESOLVER_API_KEY`
- `VOLCENGINE_RESOLVER_VIDEO_URL_FIELD_PATH`

## 4. 验证部署
部署完成后检查：
1. 健康检查：
```bash
curl https://你的域名/healthz
```
期望返回：
```json
{"status":"ok","now":"..."}
```

2. 网页入口：
在浏览器打开：
```text
https://你的域名/
```

## 5. 给测试用户的使用方式
1. 打开网页。
2. 把抖音分享文案粘贴到「链接转写」。
3. 点「开始转写」。
4. 直接点「生成三版本改写」或「生成产品化三版本」。

## 6. 常见问题
1. `MODEL_TIMEOUT: VOLCENGINE_LLM_HTTP_404`
- 检查 `VOLCENGINE_LLM_MODEL` 是否填了正确模型 ID。
- 检查 `VOLCENGINE_LLM_BASE_URL` 是否是 Ark v3 地址。

2. `ASR_FAILED`
- 检查 `VOLCENGINE_ASR_API_URL` 不能是 `.../chat/completions`。
- 检查 ASR key 和资源 `VOLCENGINE_ASR_RESOURCE_ID` 是否有授权。
- 如果错误里有 `Invalid audio URI` / `audio download failed`：
  - 确认 `PUBLIC_BASE_URL` 已设置为当前 Render 域名；
  - 重新部署后重试；
  - 仍失败可临时设置 `ASR_MEDIA_PROXY_FORCE=true`。

3. 转写超时
- 将 `ASR_TIMEOUT_MS` 提高到 `180000` 再试。
