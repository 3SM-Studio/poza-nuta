import {
  DASHBOARD_EVENT_QUEUE_ACTIONS,
  DASHBOARD_EVENT_QUEUE_FILTERS,
  DASHBOARD_EVENT_QUEUE_MOVE_DIRECTIONS,
  type DashboardEventQueueAction,
  type DashboardEventQueueFilter,
  type DashboardEventQueueMoveDirection,
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
): ValidationResult<DashboardEventQueueMoveDirection> {
  if (!isRecord(input) || typeof input.direction !== "string") {
    return invalidDirectionResult();
  }

  if (
    !DASHBOARD_EVENT_QUEUE_MOVE_DIRECTIONS.includes(
      input.direction as DashboardEventQueueMoveDirection,
    )
  ) {
    return invalidDirectionResult();
  }

  return {
    success: true,
    data: input.direction as DashboardEventQueueMoveDirection,
  };
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

function invalidDirectionResult(): ValidationResult<DashboardEventQueueMoveDirection> {
  return {
    success: false,
    issues: [
      {
        field: "direction",
        message: "direction must be up or down.",
      },
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
