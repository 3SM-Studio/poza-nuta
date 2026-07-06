import dotenv from "dotenv";

dotenv.config();

export const E2E_AUTH_STATE_PATH = ".auth/operator.json";
export const DEFAULT_E2E_BASE_URL = "http://127.0.0.1:3000";

export const hasExplicitE2EBaseUrl = Boolean(
  process.env.E2E_BASE_URL?.trim(),
);

export const E2E_BASE_URL =
  process.env.E2E_BASE_URL?.trim() || DEFAULT_E2E_BASE_URL;

export function getMissingDashboardAuthEnv() {
  return getMissingEnv([
    "E2E_BASE_URL",
    "E2E_OPERATOR_EMAIL",
    "E2E_OPERATOR_PASSWORD",
  ]);
}

export function getMissingDashboardSmokeEnv() {
  return getMissingEnv([
    "E2E_BASE_URL",
    "E2E_OPERATOR_EMAIL",
    "E2E_OPERATOR_PASSWORD",
    "E2E_ORG_PUBLIC_ID",
  ]);
}

export function getOptionalE2EEventId() {
  const value = process.env.E2E_EVENT_ID?.trim();

  if (!value) {
    return null;
  }

  return value;
}

export function getOptionalE2ESessionCode() {
  return (
    process.env.E2E_SESSION_CODE?.trim() ||
    "invalid-e2e-session-code-readonly"
  );
}

export function getRequiredE2EEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required for this E2E test.`);
  }

  return value;
}

function getMissingEnv(names: string[]) {
  return names.filter((name) => !process.env[name]?.trim());
}
