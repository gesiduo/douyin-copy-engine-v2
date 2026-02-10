import { request } from "../../utils/api.js";

Page({
  data: {
    sourceText: "",
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

  onSourceInput(event) {
    this.setData({ sourceText: event.detail.value });
  },

  async generateVariants() {
    if (!this.data.sourceText.trim()) {
      tt.showToast({ title: "请先输入原文案", icon: "none" });
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
        url: "/api/copy/variants",
        method: "POST",
        data: {
          sourceText: this.data.sourceText,
          mode: "rewrite",
          variantCount: 3,
          strictness: "strict",
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
    const target = this.data.versions[index];
    if (!target) {
      return;
    }
    tt.setClipboardData({
      data: target,
      success: () => tt.showToast({ title: "已复制", icon: "success" }),
    });
  },
});
