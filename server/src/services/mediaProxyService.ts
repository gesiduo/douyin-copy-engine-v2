import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

interface MediaProxyRecord {
  sourceUrl: string;
  expiresAtMs: number;
}

function isPrivateIpv4(hostname: string): boolean {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return false;
  }
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }
  if (parts[0] === 10 || parts[0] === 127) {
    return true;
  }
  if (parts[0] === 192 && parts[1] === 168) {
    return true;
  }
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
    return true;
  }
  if (parts[0] === 169 && parts[1] === 254) {
    return true;
  }
  return false;
}

export function normalizeBaseUrl(baseUrl?: string): string | undefined {
  if (!baseUrl?.trim()) {
    return undefined;
  }
  try {
    const url = new URL(baseUrl.trim());
    if (!["http:", "https:"].includes(url.protocol)) {
      return undefined;
    }
    return url.origin.replace(/\/+$/u, "");
  } catch {
    return undefined;
  }
}

export function isPublicBaseUrl(baseUrl?: string): boolean {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) {
    return false;
  }
  const hostname = new URL(normalized).hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "::1" || hostname === "[::1]") {
    return false;
  }
  if (hostname.endsWith(".local")) {
    return false;
  }
  if (isPrivateIpv4(hostname)) {
    return false;
  }
  return true;
}

function shouldSendDouyinReferer(sourceUrl: string): boolean {
  const lower = sourceUrl.toLowerCase();
  return (
    lower.includes("douyin") ||
    lower.includes("aweme.snssdk.com") ||
    lower.includes("douyinvod.com") ||
    lower.includes("bytecdn.cn")
  );
}

export class MediaProxyService {
  private readonly records = new Map<string, MediaProxyRecord>();

  constructor(
    private readonly options: {
      ttlMs?: number;
      maxRecords?: number;
    } = {},
  ) {}

  createProxyUrl(sourceUrl: string, baseUrl?: string): string | undefined {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    if (!normalizedBaseUrl || !isPublicBaseUrl(normalizedBaseUrl)) {
      return undefined;
    }
    this.cleanupExpired();
    const maxRecords = this.options.maxRecords ?? 200;
    if (this.records.size >= maxRecords) {
      const firstKey = this.records.keys().next().value as string | undefined;
      if (firstKey) {
        this.records.delete(firstKey);
      }
    }
    const token = randomUUID();
    const ttlMs = this.options.ttlMs ?? 10 * 60 * 1000;
    this.records.set(token, {
      sourceUrl,
      expiresAtMs: Date.now() + ttlMs,
    });
    return `${normalizedBaseUrl}/api/media-proxy/${token}`;
  }

  handleRequest = async (req: Request, res: Response): Promise<void> => {
    this.cleanupExpired();
    const token = req.params.token;
    if (!token) {
      res.status(400).json({ errorCode: "INVALID_INPUT", errorMessage: "missing token" });
      return;
    }
    const record = this.records.get(token);
    if (!record || record.expiresAtMs <= Date.now()) {
      this.records.delete(token);
      res.status(404).json({ errorCode: "NOT_FOUND", errorMessage: "media token expired or not found" });
      return;
    }

    const controller = new AbortController();
    req.on("close", () => controller.abort());

    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      Accept: "*/*",
    };
    if (shouldSendDouyinReferer(record.sourceUrl)) {
      headers.Referer = "https://www.douyin.com/";
      headers.Origin = "https://www.douyin.com";
    }
    const rangeHeader = req.header("range");
    if (rangeHeader?.trim()) {
      headers.Range = rangeHeader;
    }

    try {
      const upstream = await fetch(record.sourceUrl, {
        method: "GET",
        redirect: "follow",
        headers,
        signal: controller.signal,
      });
      if (!upstream.ok || !upstream.body) {
        const responseText = (await upstream.text().catch(() => "")).slice(0, 300);
        res.status(502).json({
          errorCode: "UPSTREAM_FETCH_FAILED",
          errorMessage: `status=${upstream.status}, body=${responseText || "empty"}`,
        });
        return;
      }

      const contentType = upstream.headers.get("content-type") || "application/octet-stream";
      const contentLength = upstream.headers.get("content-length");
      const contentRange = upstream.headers.get("content-range");
      const acceptRanges = upstream.headers.get("accept-ranges") || "bytes";

      res.status(upstream.status);
      res.setHeader("Content-Type", contentType);
      res.setHeader("Accept-Ranges", acceptRanges);
      res.setHeader("Cache-Control", "private, max-age=60");
      if (contentLength) {
        res.setHeader("Content-Length", contentLength);
      }
      if (contentRange) {
        res.setHeader("Content-Range", contentRange);
      }

      const bodyStream = Readable.fromWeb(upstream.body as any);
      bodyStream.on("error", () => {
        if (!res.headersSent) {
          res.status(502).end("proxy stream failed");
          return;
        }
        res.destroy();
      });
      bodyStream.pipe(res);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      if (controller.signal.aborted) {
        return;
      }
      res.status(502).json({ errorCode: "UPSTREAM_FETCH_FAILED", errorMessage: message });
    }
  };

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [token, record] of this.records) {
      if (record.expiresAtMs <= now) {
        this.records.delete(token);
      }
    }
  }
}
