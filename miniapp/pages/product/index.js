import { request } from "../../utils/api.js";

function splitLines(input) {
  return input
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

Page({
  data: {
    sourceText: "",
    productName: "",
    category: "",
    targetAudience: "",
    cta: "",
    sellingPointsText: "",
    forbiddenWordsText: "",
    jobId: "",
    status: "",
    versions: [],
    qcReport: null,
    errorMessage: "",
    polling: false,
  },

  onLoad(query) {
    const sourceText = query?.sourceText ? decodeURIComponent(query.sourceText) : "";
    this.setData({ sourceText });
  },

  onInput(event) {
    const { field } = event.currentTarget.dataset;
    this.setData({ [field]: event.detail.value });
  },

  async generateProductVariants() {
    const requiredFields = [
      "sourceText",
      "productName",
      "category",
      "targetAudience",
      "cta",
      "sellingPointsText",
    ];
    const missing = requiredFields.some((field) => !String(this.data[field]).trim());
    if (missing) {
      tt.showToast({ title: "请补全必填字段", icon: "none" });
      return;
    }

    const sellingPoints = splitLines(this.data.sellingPointsText);
    if (sellingPoints.length < 3 || sellingPoints.length > 5) {
      tt.showToast({ title: "卖点需要3-5条", icon: "none" });
      return;
    }

    this.setData({
      status: "queued",
      versions: [],
      qcReport: null,
      errorMessage: "",
      polling: true,
    });

    try {
      const response = await request({
        url: "/api/copy/product-variants",
        method: "POST",
        data: {
          sourceText: this.data.sourceText,
          mode: "product_adapt",
          variantCount: 3,
          strictness: "strict",
          productInfo: {
            productName: this.data.productName,
            category: this.data.category,
            sellingPoints,
            targetAudience: this.data.targetAudience,
            cta: this.data.cta,
            forbiddenWords: splitLines(this.data.forbiddenWordsText),
            complianceNotes: [],
          },
        },
      });
      this.setData({ jobId: response.jobId });
      this.pollJob();
    } catch (error) {
      this.setData({
        status: "failed",
        polling: false,
        errorMessage: String(error),
      });
    }
  },

  async pollJob() {
    if (!this.data.jobId || !this.data.polling) {
      return;
    }
    try {
      const response = await request({
        url: `/api/jobs/${this.data.jobId}`,
        method: "GET",
      });
      this.setData({
        status: response.status,
        errorMessage: response.errorMessage || "",
      });
      if (response.status === "succeeded") {
        this.setData({
          versions: response.versions || [],
          qcReport: response.qcReport || null,
          polling: false,
        });
        return;
      }
      if (response.status === "failed") {
        this.setData({ polling: false });
        return;
      }
      setTimeout(() => this.pollJob(), 1500);
    } catch (error) {
      this.setData({
        polling: false,
        status: "failed",
        errorMessage: String(error),
      });
    }
  },

  copyVersion(event) {
    const index = Number(event.currentTarget.dataset.index);
    const text = this.data.versions[index];
    if (!text) {
      return;
    }
    tt.setClipboardData({
      data: text,
      success: () => tt.showToast({ title: "已复制", icon: "success" }),
    });
  },
});
