import { beach } from "./beach";
import { cave } from "./cave";
import { forest } from "./forest";
import { meadow } from "./meadow";
import { pond } from "./pond";
import { snowfield } from "./snowfield";
import type { DioramaDef } from "./types";

export const DIORAMA_IDS = ["meadow", "forest", "beach", "cave", "snowfield", "pond"] as const;
export type DioramaId = (typeof DIORAMA_IDS)[number];

export const DIORAMAS: Record<DioramaId, () => DioramaDef> = {
  meadow,
  forest,
  beach,
  cave,
  snowfield,
  pond,
};

export function isDioramaId(id: string): id is DioramaId {
  return (DIORAMA_IDS as readonly string[]).includes(id);
}

export function getDiorama(id: DioramaId): DioramaDef {
  return DIORAMAS[id]();
}
