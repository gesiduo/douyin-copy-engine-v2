#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
ROOT_DIR="/Users/lizhan/Desktop/sandbox"
ENV_FILE="${ROOT_DIR}/.env.local"

if [ -f "${ENV_FILE}" ]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

if [ -z "${VOLCENGINE_ASR_API_URL:-}" ] && [ "${ALLOW_MOCK_TRANSCRIPT:-false}" != "true" ]; then
  echo "ASR not configured."
  echo "Please set VOLCENGINE_ASR_API_URL and VOLCENGINE_ASR_API_KEY in ${ENV_FILE}"
  echo "or set ALLOW_MOCK_TRANSCRIPT=true to allow mock transcript."
  exit 1
fi

if [[ "${VOLCENGINE_ASR_API_URL:-}" =~ /chat/completions/?$ ]]; then
  echo "Invalid VOLCENGINE_ASR_API_URL: it points to Ark chat completions."
  echo "Please replace it with your real Volcengine ASR endpoint."
  exit 1
fi

if [[ "${VOLCENGINE_ASR_API_URL:-}" =~ openspeech\.bytedance\.com/api/v3/auc/bigmodel/(recognize/flash|submit)/?$ ]]; then
  if [ -z "${VOLCENGINE_ASR_API_KEY:-}" ] && { [ -z "${VOLCENGINE_ASR_APP_KEY:-}" ] || [ -z "${VOLCENGINE_ASR_ACCESS_KEY:-}" ]; }; then
    echo "OpenSpeech ASR auth missing."
    echo "Set either VOLCENGINE_ASR_API_KEY (single key) OR VOLCENGINE_ASR_APP_KEY + VOLCENGINE_ASR_ACCESS_KEY (dual key) in ${ENV_FILE}"
    exit 1
  fi
fi

SHARE_TEXT_RAW=""
PRODUCT_JSON_PATH=""

if [ "$#" -ge 2 ] && [ -f "${!#}" ]; then
  PRODUCT_JSON_PATH="${!#}"
  SHARE_TEXT_RAW="$(printf '%s ' "${@:1:$(($# - 1))}")"
  SHARE_TEXT_RAW="${SHARE_TEXT_RAW% }"
else
  SHARE_TEXT_RAW="${*:-}"
fi

if [ -z "${SHARE_TEXT_RAW}" ]; then
  echo "Usage: ${0} 'share text with douyin url' [product_info.json]"
  exit 1
fi

trim_surrounding_quotes() {
  local s="$1"
  s="${s#\"}"
  s="${s%\"}"
  s="${s#\'}"
  s="${s%\'}"
  s="${s#“}"
  s="${s#”}"
  s="${s%“}"
  s="${s%”}"
  echo "$s"
}

SHARE_TEXT="$(trim_surrounding_quotes "${SHARE_TEXT_RAW}")"

json_get() {
  node -e '
    const data = JSON.parse(process.argv[1]);
    const path = process.argv[2].split(".");
    let cur = data;
    for (const p of path) cur = cur?.[p];
    if (cur === undefined || cur === null) process.exit(2);
    if (typeof cur === "object") console.log(JSON.stringify(cur));
    else console.log(String(cur));
  ' "$1" "$2"
}

echo "[1/4] create transcript task"
TASK_REQ="$(node -e 'console.log(JSON.stringify({
  shareText: process.argv[1],
  clientRequestId: "req_" + Date.now()
}))' "${SHARE_TEXT}")"

TASK_RESP="$(curl -sS -X POST "${BASE_URL}/api/tasks" \
  -H "Content-Type: application/json" \
  -d "${TASK_REQ}")"
TASK_ID="$(json_get "${TASK_RESP}" "taskId")"
echo "taskId=${TASK_ID}"

echo "[2/4] polling transcript"
TRANSCRIPT_TEXT=""
for i in $(seq 1 60); do
  RESP="$(curl -sS "${BASE_URL}/api/tasks/${TASK_ID}")"
  STATUS="$(json_get "${RESP}" "status" || true)"
  echo "  transcript[${i}] status=${STATUS}"

  if [ "${STATUS}" = "succeeded" ]; then
    TRANSCRIPT_TEXT="$(json_get "${RESP}" "transcriptText")"
    break
  fi
  if [ "${STATUS}" = "failed" ]; then
    echo "transcript failed:"
    echo "${RESP}"
    exit 1
  fi
  sleep 2
done

if [ -z "${TRANSCRIPT_TEXT}" ]; then
  echo "transcript timeout"
  exit 1
fi

echo "[3/4] create product-adapt job"
PRODUCT_REQ="$(node -e '
  const fs = require("node:fs");
  const sourceText = process.argv[1];
  const path = process.argv[2] || "";
  let productInfo;

  if (path) {
    const raw = fs.readFileSync(path, "utf-8");
    productInfo = JSON.parse(raw);
  } else {
    productInfo = {
      productName: "轻盈保湿精华",
      category: "护肤品",
      sellingPoints: ["吸收快", "不粘腻", "温和配方"],
      targetAudience: "通勤女性",
      cta: "想要清爽保湿，现在就试试。",
      forbiddenWords: ["最强", "根治"],
      complianceNotes: ["避免医疗承诺", "避免绝对化表述"]
    };
  }

  const payload = {
    sourceText,
    mode: "product_adapt",
    variantCount: 3,
    strictness: "strict",
    productInfo
  };
  console.log(JSON.stringify(payload));
' "${TRANSCRIPT_TEXT}" "${PRODUCT_JSON_PATH}")"

PRODUCT_RESP="$(curl -sS -X POST "${BASE_URL}/api/copy/product-variants" \
  -H "Content-Type: application/json" \
  -d "${PRODUCT_REQ}")"
JOB_ID="$(json_get "${PRODUCT_RESP}" "jobId")"
echo "jobId=${JOB_ID}"

echo "[4/4] polling product-adapt job"
FINAL=""
for i in $(seq 1 60); do
  RESP="$(curl -sS "${BASE_URL}/api/jobs/${JOB_ID}")"
  STATUS="$(json_get "${RESP}" "status" || true)"
  echo "  product[${i}] status=${STATUS}"

  if [ "${STATUS}" = "succeeded" ]; then
    FINAL="${RESP}"
    break
  fi
  if [ "${STATUS}" = "failed" ]; then
    echo "product-adapt failed:"
    echo "${RESP}"
    exit 1
  fi
  sleep 2
done

if [ -z "${FINAL}" ]; then
  echo "product-adapt timeout"
  exit 1
fi

echo
echo "===== Transcript ====="
echo "${TRANSCRIPT_TEXT}"
echo
echo "===== Product Versions ====="
node -e '
  const d = JSON.parse(process.argv[1]);
  (d.versions || []).forEach((v, i) => {
    console.log(`\n--- Version ${i + 1} ---\n${v}`);
  });
  console.log("\n===== QC =====");
  console.log(JSON.stringify(d.qcReport || {}, null, 2));
' "${FINAL}"
