import { describe, expect, it } from "vitest";
import {
  PASSWORD_MIN_LENGTH,
  isPasswordValid,
  passwordProblems,
  passwordRules,
} from "@/lib/password";

describe("password policy", () => {
  it("requires 12 characters, a letter and a digit", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    expect(isPasswordValid("Survivor2026!")).toBe(true);
    expect(isPasswordValid("Short1pass")).toBe(false); // 10 chars
    expect(isPasswordValid("123456789012")).toBe(false); // no letter
    expect(isPasswordValid("abcdefghijkl")).toBe(false); // no digit
  });

  it("counts an exactly-12-character password as long enough", () => {
    expect(passwordRules("abcdefghijk1")[0].met).toBe(true);
    expect(passwordRules("abcdefghij1")[0].met).toBe(false);
  });

  it("accepts symbols and unicode letters without requiring them", () => {
    expect(isPasswordValid("señor-pool-2026")).toBe(true);
    expect(isPasswordValid("!!!!!!!!!!!!")).toBe(false); // symbols only
  });

  it("names every unmet rule, and nothing when the password passes", () => {
    expect(passwordProblems("abc")).toEqual([
      "At least 12 characters",
      "At least one number",
    ]);
    expect(passwordProblems("longenough123")).toEqual([]);
  });

  it("reports rules for an empty password as all unmet", () => {
    expect(passwordRules("").every((r) => !r.met)).toBe(true);
  });
});
