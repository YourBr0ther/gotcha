/**
 * Request bodies for the games routes. Shape only; the service checks the
 * token, the manifest bounds and the score against maxScore.
 */

import { z } from "zod";

const gameId = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9-]+$/, "game ids are lower-case words joined by dashes");

export const StartBody = z.object({ gameId });

export const ResultBody = z.object({
  token: z.string().min(1).max(1024),
  gameId,
  score: z.number().finite().min(0),
  maxScore: z.number().finite().positive(),
  durationMs: z.int().min(0),
  perfect: z.boolean().default(false),
});

export type StartBody = z.output<typeof StartBody>;
export type ResultBody = z.output<typeof ResultBody>;
