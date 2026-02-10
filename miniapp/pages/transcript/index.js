import { request } from "../../utils/api.js";

Page({
  data: {
    shareText: "",
    clientRequestId: "",
    taskId: "",
    status: "",
    transcriptText: "",
    errorMessage: "",
    polling: false,
  },

  onLoad() {
    this.setData({
      clientRequestId: `req_${Date.now()}`,
    });
  },

  onShareInput(event) {
    this.setData({
      shareText: event.detail.value,
    });
  },

  async submitTask() {
    const { shareText, clientRequestId } = this.data;
    if (!shareText.trim()) {
      tt.showToast({ title: "请先输入抖音链接文本", icon: "none" });
      return;
    }
    this.setData({
      status: "queued",
      errorMessage: "",
      transcriptText: "",
    });
    try {
      const response = await request({
        url: "/api/tasks",
        method: "POST",
        data: {
          shareText,
          clientRequestId,
        },
      });
      this.setData({
        taskId: response.taskId,
        polling: true,
      });
      this.pollTask();
    } catch (error) {
      this.setData({
        status: "failed",
        errorMessage: String(error),
      });
    }
  },

  async pollTask() {
    const { taskId, polling } = this.data;
    if (!taskId || !polling) {
      return;
    }
    try {
      const response = await request({
        url: `/api/tasks/${taskId}`,
        method: "GET",
      });
      this.setData({
        status: response.status,
        transcriptText: response.transcriptText || "",
        errorMessage: response.errorMessage || "",
      });

      if (response.status === "succeeded" || response.status === "failed") {
        this.setData({ polling: false });
        return;
      }
      setTimeout(() => this.pollTask(), 1500);
    } catch (error) {
      this.setData({
        polling: false,
        status: "failed",
        errorMessage: String(error),
      });
    }
  },

  retry() {
    this.setData({
      clientRequestId: `req_${Date.now()}`,
      taskId: "",
      status: "",
      transcriptText: "",
      errorMessage: "",
      polling: false,
    });
    this.submitTask();
  },

  copyTranscript() {
    if (!this.data.transcriptText) {
      return;
    }
    tt.setClipboardData({
      data: this.data.transcriptText,
      success: () => tt.showToast({ title: "已复制", icon: "success" }),
    });
  },

  goRewrite() {
    tt.navigateTo({
      url: `/pages/rewrite/index?sourceText=${encodeURIComponent(this.data.transcriptText)}`,
    });
  },

  goProduct() {
    tt.navigateTo({
      url: `/pages/product/index?sourceText=${encodeURIComponent(this.data.transcriptText)}`,
    });
  },
});
