/**
 * Client-side fetch helpers and the response shapes the screens read.
 * Shapes are type-only imports from the services so the client bundle
 * stays free of server code.
 */

import type { PokemonView } from "@/lib/services/views";
import type { PartyView } from "@/lib/services/party";
import type { BoxView } from "@/lib/services/pc";
import type { TrainerSummary } from "@/lib/services/trainers";
import type { CareOutcome } from "@/lib/services/care";
import type { PurchaseResult } from "@/lib/services/store";
import type { ImportResult } from "@/lib/services/transfer";
import type { StoreItem, CareAction } from "@/lib/sim";
import type { Memories, Pokedex } from "@gotcha/cpkmn";

export type { PokemonView, PartyView, BoxView, TrainerSummary, CareOutcome, PurchaseResult, ImportResult, StoreItem, CareAction };

/**
 * The view may grow a memories and pokedex member later; until the API
 * adds them the journal and pokedex screens show empty states.
 */
export type RichView = PokemonView & { memories?: Memories; pokedex?: Pokedex };

export interface BagEntry {
  itemId: string;
  qty: number;
}

export interface Me {
  id: string;
  username: string;
  name: string;
  bytes: number;
  timezone: string;
  createdAt: string;
  bag: BagEntry[];
  counts: { party: number; pc: number; inTransit: number };
}

export interface StoreResponse {
  bytes: number;
  catalog: StoreItem[];
  bag: BagEntry[];
}

export interface Weather {
  tempF: number;
  code: number;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && typeof init.body === "string" && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(path, { ...init, headers, cache: "no-store" });
  if (!res.ok) {
    let code = "http";
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string; code?: string };
      if (body.error) message = body.error;
      if (body.code) code = body.code;
    } catch {
      // Not JSON; keep the status text.
    }
    throw new ApiError(res.status, code, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(body) });
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: "PUT", body: JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body: JSON.stringify(body) });

export function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Triggers a download of a response body with the server's filename. */
export async function downloadFile(path: string): Promise<string> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string; code?: string };
      if (body.error) message = body.error;
      throw new ApiError(res.status, body.code ?? "http", message);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(res.status, "http", message);
    }
  }
  const disposition = res.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? "pokemon.cpkmn";
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return filename;
}

export async function shareOrDownload(blob: Blob, filename: string, title: string): Promise<"shared" | "downloaded"> {
  const file = new File([blob], filename, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title });
      return "shared";
    } catch {
      // Cancelled or unsupported; fall through to download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}
