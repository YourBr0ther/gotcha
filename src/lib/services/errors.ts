/**
 * Errors services throw. Routes turn them into `{ error, code }` JSON with
 * the status here; anything else is a 500.
 */

export type ServiceErrorCode =
  | "unauthenticated"
  | "not_found"
  | "unknown_species"
  | "unknown_item"
  | "unknown_action"
  | "bad_request"
  | "party_full"
  | "box_full"
  | "box_slot_taken"
  | "not_in_party"
  | "not_in_pc"
  | "not_home"
  | "in_transit"
  | "released"
  | "already_present"
  | "starter_already_chosen"
  | "insufficient_bytes"
  | "item_not_in_bag"
  | "item_required"
  | "bad_file"
  | "signing_unavailable";

const STATUS: Record<ServiceErrorCode, number> = {
  unauthenticated: 401,
  not_found: 404,
  unknown_species: 404,
  unknown_item: 404,
  unknown_action: 400,
  bad_request: 400,
  party_full: 409,
  box_full: 409,
  box_slot_taken: 409,
  not_in_party: 409,
  not_in_pc: 409,
  not_home: 409,
  in_transit: 409,
  released: 410,
  already_present: 409,
  starter_already_chosen: 409,
  insufficient_bytes: 402,
  item_not_in_bag: 409,
  item_required: 400,
  bad_file: 422,
  signing_unavailable: 503,
};

export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ServiceErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError || (typeof error === "object" && error !== null && (error as { name?: string }).name === "ServiceError");
}
