/**
 * Rate Limiting Middleware Tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  checkRateLimit,
  getRateLimitHeaders,
  initializeRateLimit,
  getRateLimitStats,
} from "./rateLimit";

describe("Rate Limiting", () => {
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = {
      rpc: vi.fn(),
      from: vi.fn(),
    };
  });

  describe("getRateLimitHeaders", () => {
    it("should return correct headers when allowed", () => {
      const result = {
        allowed: true,
        tokensRemaining: 100,
        resetAfterSeconds: 60,
        status: "allowed" as const,
      };

      const headers = getRateLimitHeaders(result);

      expect(headers["X-RateLimit-Limit"]).toBe("120");
      expect(headers["X-RateLimit-Remaining"]).toBe("100");
      expect(headers).toHaveProperty("X-RateLimit-Reset");
    });

    it("should include Retry-After header when blocked", () => {
      const result = {
        allowed: false,
        tokensRemaining: 0,
        resetAfterSeconds: 60,
        status: "blocked" as const,
        retryAfterSeconds: 30,
      };

      const headers = getRateLimitHeaders(result);

      expect(headers["Retry-After"]).toBe("30");
    });

    it("should track warning status", () => {
      const result = {
        allowed: true,
        tokensRemaining: 10,
        resetAfterSeconds: 60,
        status: "warning" as const,
      };

      const headers = getRateLimitHeaders(result);

      expect(headers["X-RateLimit-Remaining"]).toBe("10");
      expect(parseInt(headers["X-RateLimit-Remaining"])).toBeLessThan(
        parseInt(headers["X-RateLimit-Limit"]) / 5
      );
    });
  });

  describe("checkRateLimit", () => {
    it("should allow requests within limit", async () => {
      mockSupabase.rpc.mockResolvedValueOnce({
        data: [
          {
            allowed: true,
            tokens_remaining: 100,
            reset_after: 60,
            status: "allowed",
          },
        ],
        error: null,
      });

      const result = await checkRateLimit(mockSupabase, "test-key", 1);

      expect(result.allowed).toBe(true);
      expect(result.tokensRemaining).toBe(100);
      expect(mockSupabase.rpc).toHaveBeenCalledWith("check_rate_limit", {
        p_api_key: "test-key",
        p_tokens_needed: 1,
        p_ip_address: null,
      });
    });

    it("should block requests exceeding limit", async () => {
      mockSupabase.rpc.mockResolvedValueOnce({
        data: [
          {
            allowed: false,
            tokens_remaining: 0,
            reset_after: 60,
            status: "blocked",
          },
        ],
        error: null,
      });

      const result = await checkRateLimit(mockSupabase, "test-key", 1);

      expect(result.allowed).toBe(false);
      expect(result.tokensRemaining).toBe(0);
      expect(result.status).toBe("blocked");
    });

    it("should warn when approaching limit", async () => {
      mockSupabase.rpc.mockResolvedValueOnce({
        data: [
          {
            allowed: true,
            tokens_remaining: 10,
            reset_after: 60,
            status: "warning",
          },
        ],
        error: null,
      });

      const result = await checkRateLimit(mockSupabase, "test-key", 1);

      expect(result.status).toBe("warning");
      expect(result.tokensRemaining).toBe(10);
    });

    it("should include IP address in check", async () => {
      mockSupabase.rpc.mockResolvedValueOnce({
        data: [
          {
            allowed: true,
            tokens_remaining: 100,
            reset_after: 60,
            status: "allowed",
          },
        ],
        error: null,
      });

      await checkRateLimit(mockSupabase, "test-key", 1, "192.168.1.1");

      expect(mockSupabase.rpc).toHaveBeenCalledWith("check_rate_limit", {
        p_api_key: "test-key",
        p_tokens_needed: 1,
        p_ip_address: "192.168.1.1",
      });
    });

    it("should fail open on database error", async () => {
      mockSupabase.rpc.mockResolvedValueOnce({
        data: null,
        error: new Error("Database connection failed"),
      });

      const result = await checkRateLimit(mockSupabase, "test-key", 1);

      // Should allow request when database is unavailable
      expect(result.allowed).toBe(true);
    });
  });

  describe("initializeRateLimit", () => {
    it("should initialize rate limit bucket", async () => {
      const insertMock = vi.fn().mockReturnThis();
      const selectMock = vi.fn().mockReturnThis();
      const singleMock = vi.fn().mockResolvedValueOnce({
        data: { api_key: "test-key" },
        error: null,
      });

      mockSupabase.from.mockReturnValueOnce({
        insert: insertMock,
        select: selectMock,
        single: singleMock,
      });

      await initializeRateLimit(mockSupabase, "test-key", "user-123");

      expect(mockSupabase.from).toHaveBeenCalledWith("rate_limit_buckets");
      expect(insertMock).toHaveBeenCalledWith({
        api_key: "test-key",
        user_id: "user-123",
        tenant_id: undefined,
        tokens_remaining: 120,
        tokens_capacity: 120,
        refill_rate: 2,
      });
    });

    it("should handle duplicate key gracefully", async () => {
      const insertMock = vi.fn().mockReturnThis();
      const selectMock = vi.fn().mockReturnThis();
      const singleMock = vi.fn().mockResolvedValueOnce({
        data: null,
        error: { code: "23505", message: "Duplicate key" },
      });

      mockSupabase.from.mockReturnValueOnce({
        insert: insertMock,
        select: selectMock,
        single: singleMock,
      });

      // Should not throw
      await expect(
        initializeRateLimit(mockSupabase, "existing-key")
      ).resolves.not.toThrow();
    });
  });

  describe("Token Bucket Algorithm", () => {
    it("should respect refill rate", () => {
      // This is implemented in the database, but we can verify the concept
      const capacityTokens = 120;
      const tokensPerMinute = 2;
      const elapsedMinutes = 5;
      const tokensToAdd = elapsedMinutes * tokensPerMinute;

      expect(tokensToAdd).toBe(10);
      expect(Math.min(120, tokensToAdd)).toBeLessThanOrEqual(capacityTokens);
    });

    it("should cap tokens at capacity", () => {
      const capacity = 120;
      const current = 110;
      const toAdd = 20;
      const newTotal = Math.min(capacity, current + toAdd);

      expect(newTotal).toBe(capacity);
    });
  });

  describe("Rate Limit Stats", () => {
    it("should retrieve rate limit statistics", async () => {
      const selectMock = vi.fn().mockReturnThis();
      const eqMock = vi.fn().mockReturnThis();
      const singleMock = vi.fn().mockResolvedValueOnce({
        data: {
          tokens_remaining: 80,
          total_requests: 100,
          blocked_requests: 5,
          is_blocked: false,
          block_reason: null,
        },
        error: null,
      });

      mockSupabase.from.mockReturnValueOnce({
        select: selectMock,
        eq: eqMock,
        single: singleMock,
      });

      const stats = await getRateLimitStats(mockSupabase, "test-key");

      expect(stats.tokensRemaining).toBe(80);
      expect(stats.totalRequests).toBe(100);
      expect(stats.blockedRequests).toBe(5);
      expect(stats.isBlocked).toBe(false);
    });
  });

  describe("Edge Cases", () => {
    it("should handle missing API key", async () => {
      mockSupabase.rpc.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      const result = await checkRateLimit(mockSupabase, "", 1);

      expect(result.allowed).toBe(false);
    });

    it("should handle concurrent requests from same key", async () => {
      const responses = Array(10).fill({
        data: [
          {
            allowed: true,
            tokens_remaining: 110 - 1,
            reset_after: 60,
            status: "allowed",
          },
        ],
        error: null,
      });

      mockSupabase.rpc.mockResolvedValue(responses[0]);

      const promises = Array(10)
        .fill(null)
        .map(() => checkRateLimit(mockSupabase, "test-key", 1));

      const results = await Promise.all(promises);

      expect(results.every((r) => r.allowed)).toBe(true);
    });

    it("should track different metrics per key", async () => {
      mockSupabase.rpc
        .mockResolvedValueOnce({
          data: [{ allowed: true, tokens_remaining: 100, reset_after: 60, status: "allowed" }],
          error: null,
        })
        .mockResolvedValueOnce({
          data: [{ allowed: true, tokens_remaining: 95, reset_after: 60, status: "allowed" }],
          error: null,
        });

      const result1 = await checkRateLimit(mockSupabase, "key-1", 1);
      const result2 = await checkRateLimit(mockSupabase, "key-2", 1);

      expect(result1.tokensRemaining).toBe(100);
      expect(result2.tokensRemaining).toBe(95);
    });
  });
});
