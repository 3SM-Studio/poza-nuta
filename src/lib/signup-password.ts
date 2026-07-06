export type SignupPasswordRequirementId =
  | "minLength"
  | "uppercase"
  | "lowercase"
  | "number"
  | "special";

export type SignupPasswordRequirementState = {
  id: SignupPasswordRequirementId;
  label: string;
  met: boolean;
};

const SIGNUP_PASSWORD_REQUIREMENTS: Array<{
  id: SignupPasswordRequirementId;
  label: string;
  test: (password: string) => boolean;
}> = [
  {
    id: "minLength",
    label: "Minimum 8 znaków",
    test: (password) => password.length >= 8,
  },
  {
    id: "uppercase",
    label: "Wielka litera",
    test: (password) => /[A-Z]/.test(password),
  },
  {
    id: "lowercase",
    label: "Mała litera",
    test: (password) => /[a-z]/.test(password),
  },
  {
    id: "number",
    label: "Cyfra",
    test: (password) => /\d/.test(password),
  },
  {
    id: "special",
    label: "Znak specjalny",
    test: (password) => /[^A-Za-z0-9]/.test(password),
  },
];

export function getSignupPasswordRequirementStates(password: string) {
  return SIGNUP_PASSWORD_REQUIREMENTS.map((requirement) => ({
    id: requirement.id,
    label: requirement.label,
    met: requirement.test(password),
  }));
}

export function isStrongSignupPassword(password: string) {
  return getSignupPasswordRequirementStates(password).every(
    (requirement) => requirement.met,
  );
}
