import dotenv from "dotenv";
import { existsSync, readFileSync } from "node:fs";

dotenv.config();

export const E2E_AUTH_STATE_PATH = ".auth/operator.json";
export const E2E_DASHBOARD_AUTH_STATUS_PATH = ".auth/dashboard-status.json";
export const DEFAULT_E2E_BASE_URL = "http://127.0.0.1:3000";

export type DashboardAuthSetupStatus =
  | {
      status: "success";
      message: string;
      path: string;
      hasOperatorEmail: boolean;
      hasOrgPublicId: boolean;
    }
  | {
      status:
        | "missing_env"
        | "profile_onboarding_required"
        | "no_organization"
        | "credentials_error"
        | "unexpected";
      message: string;
      path: string | null;
      hasOperatorEmail: boolean;
      hasOrgPublicId: boolean;
      missingEnv?: string[];
    };

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

export function getOptionalConfiguredE2ESessionCode() {
  const value = process.env.E2E_SESSION_CODE?.trim();

  if (!value) {
    return null;
  }

  return value;
}

export function getRequiredE2EEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required for this E2E test.`);
  }

  return value;
}

export function readDashboardAuthSetupStatus(): DashboardAuthSetupStatus | null {
  if (!existsSync(E2E_DASHBOARD_AUTH_STATUS_PATH)) {
    return null;
  }

  try {
    return JSON.parse(
      readFileSync(E2E_DASHBOARD_AUTH_STATUS_PATH, "utf8"),
    ) as DashboardAuthSetupStatus;
  } catch {
    return null;
  }
}

function getMissingEnv(names: string[]) {
  return names.filter((name) => !process.env[name]?.trim());
}
