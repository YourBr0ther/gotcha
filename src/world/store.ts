/**
 * The store behind `WorldHandle`. React components subscribe for the
 * values that change what is mounted (bundle, diorama); the frame loop reads
 * `state` directly for values that change every frame (time of day). The
 * creature registers a controller for commands that need the scene.
 */

import type { Activity, DioramaId, EmoteKind, PokemonBundle, WorldHandle, WorldState } from "./api";
import { localHours } from "./api";
import { createLighting, type Lighting } from "./lighting";

export interface CreatureController {
  moveTo(spot: string): Promise<boolean>;
  play(activity: Activity): void;
  emote(kind: EmoteKind): void;
  cry(): void;
  cancelMove(): void;
}

type Listener = () => void;

/** How long the overlay takes to cover the scene, then to clear again. */
export const FADE_MS = 220;

export class WorldStore {
  state: WorldState = {
    bundle: null,
    aspects: [],
    diorama: "meadow",
    activity: "idle",
    timeOfDay: localHours(),
    loadToken: 0,
    attachedToken: 0,
    shownToken: 0,
    focusHeight: 0.9,
    focus: null,
    fading: false,
    ambient: true,
    depth: true,
  };

  /** The light rig as applied this frame; written by DayNight, read by water and grass. */
  readonly lighting: Lighting = createLighting();

  private listeners = new Set<Listener>();
  private creature: CreatureController | null = null;
  private loadWaiters = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();
  private creatureWaiters: Array<(c: CreatureController) => void> = [];
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingDiorama: DioramaId | null = null;

  readonly handle: WorldHandle = {
    setPokemon: (bundle, aspects = []) => this.setPokemon(bundle, aspects),
    setDiorama: (id) => this.setDiorama(id),
    play: (activity) => this.play(activity),
    emote: (kind) => this.withCreature((c) => c.emote(kind)),
    cry: () => this.withCreature((c) => c.cry()),
    moveTo: (spot) => this.moveTo(spot),
    setTimeOfDay: (hours) => {
      this.state = { ...this.state, timeOfDay: ((hours % 24) + 24) % 24 };
    },
    setAmbient: (enabled) => {
      if (enabled !== this.state.ambient) this.set({ ambient: enabled });
    },
  };

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): WorldState => this.state;

  private emit(): void {
    for (const l of this.listeners) l();
  }

  private set(patch: Partial<WorldState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private setPokemon(bundle: PokemonBundle, aspects: string[]): Promise<void> {
    const loadToken = this.state.loadToken + 1;
    const promise = new Promise<void>((resolve, reject) => {
      this.loadWaiters.set(loadToken, { resolve, reject });
    });
    this.set({ bundle, aspects, loadToken, activity: "idle" });
    return promise;
  }

  /**
   * Cover the scene, swap it while covered, uncover. A second call during
   * the fade just changes which scene appears when the overlay lifts.
   */
  private setDiorama(id: DioramaId): void {
    if (id === this.state.diorama && !this.pendingDiorama) return;
    this.pendingDiorama = id;
    if (this.fadeTimer) return;
    this.creature?.cancelMove();
    this.set({ fading: true });
    this.fadeTimer = setTimeout(() => {
      const next = this.pendingDiorama ?? this.state.diorama;
      this.pendingDiorama = null;
      this.set({ diorama: next });
      this.fadeTimer = setTimeout(() => {
        this.fadeTimer = null;
        this.set({ fading: false });
      }, FADE_MS);
    }, FADE_MS);
  }

  private play(activity: Activity): void {
    this.state = { ...this.state, activity };
    this.creature?.play(activity);
  }

  private moveTo(spot: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.withCreature((c) => {
        c.moveTo(spot).then(resolve);
      });
    });
  }

  private withCreature(fn: (c: CreatureController) => void): void {
    if (this.creature) fn(this.creature);
    else this.creatureWaiters.push(fn);
  }

  /** Called by the creature once its model is in the scene. */
  attachCreature(controller: CreatureController, loadToken: number, height: number, focus: { x: number; y: number; z: number } | null = null): void {
    this.creature = controller;
    const f = this.state.focus;
    const attachedToken = Math.max(this.state.attachedToken, loadToken);
    if (attachedToken !== this.state.attachedToken || height !== this.state.focusHeight || focus?.x !== f?.x || focus?.y !== f?.y || focus?.z !== f?.z) {
      this.set({ attachedToken, focusHeight: height, focus });
    }
    const waiter = this.loadWaiters.get(loadToken);
    if (waiter) {
      this.loadWaiters.delete(loadToken);
      waiter.resolve();
    }
    const queued = this.creatureWaiters;
    this.creatureWaiters = [];
    for (const fn of queued) fn(controller);
  }

  /** Called by the creature on its first rendered frame. */
  markShown(loadToken: number): void {
    if (loadToken === this.state.loadToken && loadToken !== this.state.shownToken) this.set({ shownToken: loadToken });
  }

  failLoad(loadToken: number, error: Error): void {
    const waiter = this.loadWaiters.get(loadToken);
    if (waiter) {
      this.loadWaiters.delete(loadToken);
      waiter.reject(error);
    }
  }

  detachCreature(controller: CreatureController): void {
    if (this.creature === controller) this.creature = null;
  }

  setDepth(enabled: boolean): void {
    if (enabled !== this.state.depth) this.set({ depth: enabled });
  }

  dispose(): void {
    if (this.fadeTimer) clearTimeout(this.fadeTimer);
    this.fadeTimer = null;
  }
}

export function createWorldStore(): WorldStore {
  return new WorldStore();
}
