import type { requestStatusValues } from "../../db/schema";

export const OPERATOR_QUEUE_ACTIONS = [
  "approve",
  "reject",
  "start",
  "done",
  "skip",
] as const;

export type OperatorQueueAction = (typeof OPERATOR_QUEUE_ACTIONS)[number];
export type RequestStatus = (typeof requestStatusValues)[number];

const allowedSourceStatuses: Record<
  OperatorQueueAction,
  readonly RequestStatus[]
> = {
  approve: ["pending"],
  reject: ["pending", "approved"],
  start: ["approved"],
  done: ["now"],
  skip: ["approved", "now"],
};

const targetStatuses: Record<OperatorQueueAction, RequestStatus> = {
  approve: "approved",
  reject: "rejected",
  start: "now",
  done: "done",
  skip: "skipped",
};

export function canApplyQueueAction(
  action: OperatorQueueAction,
  currentStatus: RequestStatus,
) {
  return allowedSourceStatuses[action].includes(currentStatus);
}

export function getTargetStatus(action: OperatorQueueAction) {
  return targetStatuses[action];
}
