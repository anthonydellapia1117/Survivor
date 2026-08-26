import { describe, expect, it } from "vitest";
import {
  PASSWORD_MIN_LENGTH,
  isPasswordValid,
  passwordChecklist,
  passwordChecklistProblems,
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

describe("full checklist (rules that depend on the current password)", () => {
  it("shows re-using the current password as an unmet rule, not a submit-time surprise", () => {
    const same = "Survivor2026!";
    const rows = passwordChecklist(same, same);
    expect(rows.map((r) => r.id)).toEqual([
      "length",
      "letter",
      "digit",
      "different",
    ]);
    expect(rows.filter((r) => !r.met).map((r) => r.id)).toEqual(["different"]);
    expect(passwordChecklistProblems(same, same)).toEqual([
      "Different from your current password",
    ]);
  });

  it("passes when the new password is strong and actually new", () => {
    expect(
      passwordChecklistProblems("brand-new-pw-2027", "Survivor2026!"),
    ).toEqual([]);
  });

  it("treats an empty new password as not yet different", () => {
    expect(
      passwordChecklist("", "").find((r) => r.id === "different")!.met,
    ).toBe(false);
  });

  it("keeps every strength rule the base policy applies", () => {
    expect(passwordChecklistProblems("short1", "other-password-9")).toEqual([
      "At least 12 characters",
    ]);
  });
});
