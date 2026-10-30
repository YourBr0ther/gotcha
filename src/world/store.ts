/**
 * The store behind `WorldHandle`. React components subscribe for the
 * values that change what is mounted (bundle, diorama); the frame loop reads
 * `state` directly for values that change every frame (time of day). The
 * creature registers a controller for commands that need the scene.
 */

import type { Activity, DioramaId, EmoteKind, PokemonBundle, WorldHandle, WorldState } from "./api";
import { localHours } from "./api";

export interface CreatureController {
  moveTo(spot: string): Promise<boolean>;
  play(activity: Activity): void;
  emote(kind: EmoteKind): void;
  cry(): void;
  cancelMove(): void;
}

type Listener = () => void;

export class WorldStore {
  state: WorldState = {
    bundle: null,
    aspects: [],
    diorama: "meadow",
    activity: "idle",
    timeOfDay: localHours(),
    loadToken: 0,
    focusHeight: 0.9,
  };

  private listeners = new Set<Listener>();
  private creature: CreatureController | null = null;
  private loadWaiters = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();
  private creatureWaiters: Array<(c: CreatureController) => void> = [];

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

  private setDiorama(id: DioramaId): void {
    this.creature?.cancelMove();
    this.set({ diorama: id });
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
  attachCreature(controller: CreatureController, loadToken: number, height: number): void {
    this.creature = controller;
    if (height !== this.state.focusHeight) this.set({ focusHeight: height });
    const waiter = this.loadWaiters.get(loadToken);
    if (waiter) {
      this.loadWaiters.delete(loadToken);
      waiter.resolve();
    }
    const queued = this.creatureWaiters;
    this.creatureWaiters = [];
    for (const fn of queued) fn(controller);
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
}

export function createWorldStore(): WorldStore {
  return new WorldStore();
}
