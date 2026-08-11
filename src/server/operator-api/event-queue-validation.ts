import {
  DASHBOARD_EVENT_QUEUE_ACTIONS,
  DASHBOARD_EVENT_QUEUE_FILTERS,
  DASHBOARD_EVENT_QUEUE_MOVE_DIRECTIONS,
  type DashboardEventQueueAction,
  type DashboardEventQueueFilter,
  type DashboardEventQueueMoveInput,
} from "../../lib/dashboard-event-queue.ts";
import type { ValidationResult } from "./validation.ts";

export function validateDashboardEventQueueFilter(
  value: string | null,
): DashboardEventQueueFilter {
  return DASHBOARD_EVENT_QUEUE_FILTERS.includes(
    value as DashboardEventQueueFilter,
  )
    ? (value as DashboardEventQueueFilter)
    : "all";
}

export function validateDashboardEventQueueActionInput(
  input: unknown,
): ValidationResult<DashboardEventQueueAction> {
  if (!isRecord(input) || typeof input.action !== "string") {
    return invalidActionResult();
  }

  if (
    !DASHBOARD_EVENT_QUEUE_ACTIONS.includes(
      input.action as DashboardEventQueueAction,
    )
  ) {
    return invalidActionResult();
  }

  return {
    success: true,
    data: input.action as DashboardEventQueueAction,
  };
}

export function validateDashboardEventQueueMoveInput(
  input: unknown,
): ValidationResult<DashboardEventQueueMoveInput> {
  if (!isRecord(input)) {
    return invalidMoveResult();
  }

  if (typeof input.direction === "string") {
    if (
      !DASHBOARD_EVENT_QUEUE_MOVE_DIRECTIONS.includes(
        input.direction as "up" | "down",
      ) ||
      input.targetPosition !== undefined
    ) {
      return invalidMoveResult();
    }

    return {
      success: true,
      data: { direction: input.direction as "up" | "down" },
    };
  }

  if (
    Number.isSafeInteger(input.targetPosition) &&
    (input.targetPosition as number) > 0 &&
    input.direction === undefined
  ) {
    return {
      success: true,
      data: { targetPosition: input.targetPosition as number },
    };
  }

  return invalidMoveResult();
}

function invalidActionResult(): ValidationResult<DashboardEventQueueAction> {
  return {
    success: false,
    issues: [
      {
        field: "action",
        message: "action must be a supported event queue action.",
      },
    ],
  };
}

function invalidMoveResult(): ValidationResult<DashboardEventQueueMoveInput> {
  return {
    success: false,
    issues: [
      {
        field: "move",
        message: "provide direction up/down or a safe positive targetPosition.",
      },
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
