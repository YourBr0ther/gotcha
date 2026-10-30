import type { DioramaDef } from "./types";
import { meadow } from "./meadow";

export type DioramaId = "meadow";

export const DIORAMAS: Record<DioramaId, () => DioramaDef> = {
  meadow,
};

export function getDiorama(id: DioramaId): DioramaDef {
  return DIORAMAS[id]();
}
