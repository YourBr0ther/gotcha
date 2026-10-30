/**
 * Thin route plumbing: zod parse, call a service, JSON out. Errors become
 * `{ error, code }` with a status; the services decide which.
 */

import { z } from "zod";
import { currentTrainer } from "@/lib/auth";
import { getDb, type Db } from "@/lib/db";
import type { TrainerRow } from "@/lib/db/schema";
import { isServiceError, ServiceError } from "@/lib/services/errors";

export interface Ctx {
  db: Db;
  trainer: TrainerRow;
  now: string;
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, init);
}

export function errorResponse(error: unknown): Response {
  if (isServiceError(error)) {
    return json({ error: error.message, code: error.code, ...(error.details !== undefined ? { details: error.details } : {}) }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    return json({ error: "invalid request", code: "bad_request", details: z.flattenError(error) }, { status: 400 });
  }
  if (error instanceof SyntaxError) {
    return json({ error: "body is not valid JSON", code: "bad_request" }, { status: 400 });
  }
  console.error(error);
  return json({ error: "internal error", code: "internal" }, { status: 500 });
}

/** A handler that needs a trainer. */
export function withTrainer<P>(fn: (request: Request, ctx: Ctx, params: P) => Promise<Response>) {
  return async (request: Request, route?: { params: Promise<P> }): Promise<Response> => {
    try {
      const db = getDb();
      const trainer = await currentTrainer(request, db);
      const params = (await route?.params) as P;
      return await fn(request, { db, trainer, now: new Date().toISOString() }, params);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/** A handler that does not. */
export function plain<P>(fn: (request: Request, params: P) => Promise<Response>) {
  return async (request: Request, route?: { params: Promise<P> }): Promise<Response> => {
    try {
      return await fn(request, (await route?.params) as P);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export async function parseBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.output<T>> {
  const text = await request.text();
  const raw: unknown = text.trim() ? JSON.parse(text) : {};
  return schema.parse(raw);
}

export function parseQuery<T extends z.ZodType>(request: Request, schema: T): z.output<T> {
  const url = new URL(request.url);
  return schema.parse(Object.fromEntries(url.searchParams.entries()));
}

export const uuid = z.uuid();

export function requireUuid(id: string): string {
  const parsed = uuid.safeParse(id);
  if (!parsed.success) throw new ServiceError("not_found", "pokemon not found");
  return parsed.data;
}
