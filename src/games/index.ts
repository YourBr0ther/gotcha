"use client";

/**
 * The playable for each manifest, loaded on demand so the Games screen
 * ships none of them. Manifests stay in ./manifests.ts for the server.
 */

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { GameProps } from "./types";

export const GAME_COMPONENTS: Record<string, ComponentType<GameProps>> = {
  "berry-catch": dynamic(() => import("./berry-catch/Game"), { ssr: false }),
  "whack-a-diglett": dynamic(() => import("./whack-a-diglett/Game"), { ssr: false }),
  "type-match": dynamic(() => import("./type-match/Game"), { ssr: false }),
};

export type { GameManifestData, GameProps, GameRoundResult } from "./types";
