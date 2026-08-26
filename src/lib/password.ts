// Admin password policy — ONE source of truth for the rules the form shows
// inline while you type and the rules the server enforces on submit. Keeping
// them in one place is what stops the checklist and the gate from drifting
// apart (a form that says "looks good" and a server that then says no).

export const PASSWORD_MIN_LENGTH = 12;

export interface PasswordRule {
  id: string;
  label: string;
  met: boolean;
}

/** Every rule with its pass/fail state — drives the live checklist. */
export function passwordRules(password: string): PasswordRule[] {
  return [
    {
      id: "length",
      label: `At least ${PASSWORD_MIN_LENGTH} characters`,
      met: password.length >= PASSWORD_MIN_LENGTH,
    },
    {
      id: "letter",
      label: "At least one letter",
      met: /\p{L}/u.test(password),
    },
    { id: "digit", label: "At least one number", met: /[0-9]/.test(password) },
  ];
}

/** Labels of the rules a candidate password fails; empty means it passes. */
export function passwordProblems(password: string): string[] {
  return passwordRules(password)
    .filter((r) => !r.met)
    .map((r) => r.label);
}

export function isPasswordValid(password: string): boolean {
  return passwordProblems(password).length === 0;
}
