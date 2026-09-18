import { describe, expect, it, vi } from "vitest";

import { isSessionCodeUniqueViolation } from "@/lib/session-code-db-error";

vi.mock("server-only", () => ({}));

import {
  generateCanonicalSessionCode,
  SessionCodeGenerationExhaustedError,
  withSessionCodeCollisionRetry,
} from "@/server/session-code";

describe("server session-code generation", () => {
  it("draws from exactly one million values and preserves leading zeros", () => {
    const draws = [0, 1, 4_271, 999_999];
    const expected = ["000000", "000001", "004271", "999999"];

    for (const [index, draw] of draws.entries()) {
      const randomInt = vi.fn(() => draw);
      expect(generateCanonicalSessionCode(randomInt)).toBe(expected[index]);
      expect(randomInt).toHaveBeenCalledWith(0, 1_000_000);
    }
  });

  it("rejects values outside the canonical random range", () => {
    expect(() => generateCanonicalSessionCode(() => -1)).toThrow(RangeError);
    expect(() => generateCanonicalSessionCode(() => 1_000_000)).toThrow(
      RangeError,
    );
  });

  it("retries a recognized collision with a bounded attempt count", async () => {
    const generated = ["000001", "000002"];
    const attempted: string[] = [];
    const result = await withSessionCodeCollisionRetry(
      async (code) => {
        attempted.push(code);
        if (attempted.length === 1) {
          throw { code: "23505", constraint: "events_session_code_idx" };
        }
        return code;
      },
      isSessionCodeUniqueViolation,
      { attempts: 2, generate: () => generated.shift() ?? "999999" },
    );

    expect(result).toBe("000002");
    expect(attempted).toEqual(["000001", "000002"]);
  });

  it("returns a controlled error after collision retry exhaustion", async () => {
    await expect(
      withSessionCodeCollisionRetry(
        async () => {
          throw { code: "23505", constraint_name: "events_session_code_idx" };
        },
        isSessionCodeUniqueViolation,
        { attempts: 2, generate: () => "000001" },
      ),
    ).rejects.toBeInstanceOf(SessionCodeGenerationExhaustedError);
  });

  it("does not retry unrelated database errors", async () => {
    let attempts = 0;
    const unrelated = { code: "23505", constraint: "events_slug_idx" };

    await expect(
      withSessionCodeCollisionRetry(
        async () => {
          attempts += 1;
          throw unrelated;
        },
        isSessionCodeUniqueViolation,
        { attempts: 3, generate: () => "000001" },
      ),
    ).rejects.toBe(unrelated);
    expect(attempts).toBe(1);
  });
});
