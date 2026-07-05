import {
  getSafeErrorCode,
  getSafeErrorMessage,
  isTransientInfrastructureError,
  traceServerStep,
} from "../runtime-diagnostics.ts";

export type OptionalOverviewSectionResult<T> = {
  data: T;
  failed: boolean;
};

export async function resolveOptionalOverviewSection<T>(input: {
  routeName: string;
  stepName: string;
  action: () => Promise<T>;
  fallback: T;
}): Promise<OptionalOverviewSectionResult<T>> {
  try {
    return {
      data: await traceServerStep(input.routeName, input.stepName, input.action),
      failed: false,
    };
  } catch (error) {
    if (!isTransientInfrastructureError(error)) {
      throw error;
    }

    console.warn(
      [
        "server_step_optional_fallback",
        `route=${JSON.stringify(input.routeName)}`,
        `step=${JSON.stringify(input.stepName)}`,
        `error_code=${JSON.stringify(getSafeErrorCode(error))}`,
        `error_message=${JSON.stringify(getSafeErrorMessage(error))}`,
      ].join(" "),
    );

    return {
      data: input.fallback,
      failed: true,
    };
  }
}

export function logDashboardOverviewDegraded(input: {
  routeName: string;
  sections: string[];
}) {
  if (input.sections.length === 0) {
    return;
  }

  console.warn(
    [
      "dashboard_overview_degraded",
      `route=${JSON.stringify(input.routeName)}`,
      `sections=${JSON.stringify(input.sections.join(","))}`,
    ].join(" "),
  );
}
