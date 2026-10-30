/**
 * Who is asking. Authelia fronts the app and sets Remote-User (and
 * Remote-Name for display); the first request from a new user creates the
 * trainer row. Outside production, GOTCHA_DEV_USER stands in for the
 * header. There is no login route.
 */

import { getDb, type Db } from "@/lib/db";
import type { TrainerRow } from "@/lib/db/schema";
import { ServiceError } from "@/lib/services/errors";
import { upsertTrainer } from "@/lib/services/trainers";

export const USER_HEADER = "remote-user";
export const NAME_HEADER = "remote-name";

const USERNAME = /^[a-z0-9._@-]{1,64}$/i;

export interface RequestIdentity {
  username: string;
  displayName?: string;
}

export function identityFromHeaders(headers: Headers, env: NodeJS.ProcessEnv = process.env): RequestIdentity | null {
  const header = headers.get(USER_HEADER)?.trim();
  if (header) return { username: header, displayName: headers.get(NAME_HEADER)?.trim() || undefined };
  if (env.NODE_ENV !== "production") {
    const dev = env.GOTCHA_DEV_USER?.trim();
    if (dev) return { username: dev };
  }
  return null;
}

export async function currentTrainer(request: Request, db: Db = getDb()): Promise<TrainerRow> {
  const identity = identityFromHeaders(request.headers);
  if (!identity) throw new ServiceError("unauthenticated", "no Remote-User header; is Authelia in front of this install?");
  if (!USERNAME.test(identity.username)) throw new ServiceError("unauthenticated", "Remote-User is not a username this install accepts");
  return upsertTrainer(db, identity.username, identity.displayName);
}
