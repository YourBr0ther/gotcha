/** Per-device preferences in localStorage. Every read tolerates a missing or blocked store. */

const LOW_POWER = "gotcha.lowPower";

/** Hides the ambient wild pokemon and other extras on a slow phone. */
export function readLowPower(): boolean {
  try {
    return localStorage.getItem(LOW_POWER) === "1";
  } catch {
    return false;
  }
}

export function writeLowPower(on: boolean): void {
  try {
    localStorage.setItem(LOW_POWER, on ? "1" : "0");
  } catch {
    // Private mode; the setting lasts for the session only.
  }
}
