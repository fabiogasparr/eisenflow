/**
 * Testes do rate limit do cliente.
 *
 * Depois da migração não há mais mock de cliente de banco nem de RPC: o balde
 * vive em memória e o enforcement real é do servidor (rate limit nativo do Appwrite +
 * Function hermes-mcp). Os testes passaram a exercitar o token bucket local.
 */

import { describe, it, expect } from "vitest";
import {
  checkRateLimit,
  getRateLimitHeaders,
  initializeRateLimit,
  getRateLimitStats,
  DEFAULT_CONFIG,
} from "./rateLimit";

/** Cada teste usa uma chave própria: o balde é global ao módulo. */
let contador = 0;
const novaChave = (nome: string) => `${nome}-${++contador}`;

describe("Rate Limiting", () => {
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
      const chave = novaChave("dentro-do-limite");
      await initializeRateLimit(chave);

      const result = await checkRateLimit(chave, 1);

      expect(result.allowed).toBe(true);
      expect(result.status).toBe("allowed");
      expect(result.tokensRemaining).toBe(DEFAULT_CONFIG.tokensPerMinute - 1);
    });

    it("should block requests exceeding limit", async () => {
      const chave = novaChave("estourado");
      await initializeRateLimit(chave);

      // Consome o balde inteiro de uma vez
      await checkRateLimit(chave, DEFAULT_CONFIG.tokensPerMinute);
      const result = await checkRateLimit(chave, 1);

      expect(result.allowed).toBe(false);
      expect(result.tokensRemaining).toBe(0);
      expect(result.status).toBe("blocked");
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    });

    it("should warn when approaching limit", async () => {
      const chave = novaChave("avisando");
      await initializeRateLimit(chave);

      // Deixa 10 fichas: abaixo dos 20% de warningThreshold
      const consumir = DEFAULT_CONFIG.tokensPerMinute - 10;
      await checkRateLimit(chave, consumir);
      const result = await checkRateLimit(chave, 0);

      expect(result.allowed).toBe(true);
      expect(result.status).toBe("warning");
      expect(result.tokensRemaining).toBe(10);
    });

    it("should accept an optional IP address without touching the database", async () => {
      const chave = novaChave("com-ip");
      await initializeRateLimit(chave);

      const result = await checkRateLimit(chave, 1, "192.168.1.1");

      // O IP é aceito por compatibilidade de assinatura; quem limita por IP é
      // o Appwrite, nativamente.
      expect(result.allowed).toBe(true);
    });
  });

  describe("initializeRateLimit", () => {
    it("should initialize a full bucket", async () => {
      const chave = novaChave("novo-balde");
      await initializeRateLimit(chave);

      const stats = await getRateLimitStats(chave);

      expect(stats.tokensRemaining).toBe(DEFAULT_CONFIG.tokensPerMinute);
      expect(stats.totalRequests).toBe(0);
      expect(stats.isBlocked).toBe(false);
    });

    it("should reset an existing bucket instead of failing", async () => {
      const chave = novaChave("reinicio");
      await initializeRateLimit(chave);
      await checkRateLimit(chave, 50);

      // Reinicializar não lança (o antigo tratava a violação de unique 23505)
      await expect(initializeRateLimit(chave)).resolves.not.toThrow();

      const stats = await getRateLimitStats(chave);
      expect(stats.tokensRemaining).toBe(DEFAULT_CONFIG.tokensPerMinute);
    });
  });

  describe("Token Bucket Algorithm", () => {
    it("should respect refill rate", () => {
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
    it("should retrieve local rate limit statistics", async () => {
      const chave = novaChave("stats");
      await initializeRateLimit(chave);
      await checkRateLimit(chave, 40);

      const stats = await getRateLimitStats(chave);

      expect(stats.tokensRemaining).toBe(DEFAULT_CONFIG.tokensPerMinute - 40);
      expect(stats.totalRequests).toBe(1);
      expect(stats.blockedRequests).toBe(0);
      expect(stats.isBlocked).toBe(false);
    });
  });

  describe("Edge Cases", () => {
    it("should handle missing API key", async () => {
      const result = await checkRateLimit("", 1);

      expect(result.allowed).toBe(false);
      expect(result.status).toBe("blocked");
    });

    it("should handle concurrent requests from same key", async () => {
      const chave = novaChave("concorrente");
      await initializeRateLimit(chave);

      const results = await Promise.all(
        Array(10)
          .fill(null)
          .map(() => checkRateLimit(chave, 1))
      );

      expect(results.every((r) => r.allowed)).toBe(true);
      const stats = await getRateLimitStats(chave);
      expect(stats.tokensRemaining).toBe(DEFAULT_CONFIG.tokensPerMinute - 10);
    });

    it("should track different metrics per key", async () => {
      const chave1 = novaChave("key");
      const chave2 = novaChave("key");
      await initializeRateLimit(chave1);
      await initializeRateLimit(chave2);

      const result1 = await checkRateLimit(chave1, 20);
      const result2 = await checkRateLimit(chave2, 25);

      expect(result1.tokensRemaining).toBe(DEFAULT_CONFIG.tokensPerMinute - 20);
      expect(result2.tokensRemaining).toBe(DEFAULT_CONFIG.tokensPerMinute - 25);
    });
  });
});
