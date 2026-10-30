import { describe, expect, it } from "vitest";
import { createLighting, daylight, lightingAt } from "./lighting";

describe("lightingAt", () => {
  const at = (hours: number) => lightingAt(hours, createLighting());

  it("gives a golden, low sun in the morning with long shadows from the right", () => {
    const l = at(8);
    expect(l.sunColor.r).toBeGreaterThan(l.sunColor.b);
    expect(l.elevation).toBeGreaterThan(15);
    expect(l.elevation).toBeLessThan(40);
    expect(l.sunDir.x).toBeGreaterThan(0.3);
    expect(l.sunDir.y).toBeGreaterThan(0);
    expect(l.sunIntensity).toBeGreaterThan(2);
    expect(l.daylight).toBe(1);
  });

  it("is brightest and highest at noon with a warm white sun", () => {
    const l = at(12);
    expect(l.elevation).toBeGreaterThan(55);
    expect(Math.abs(l.sunDir.x)).toBeLessThan(0.05);
    expect(l.sunIntensity).toBeGreaterThanOrEqual(at(8).sunIntensity);
    expect(l.sunIntensity).toBeGreaterThanOrEqual(at(18).sunIntensity);
    // Linear channels: the 0xcf blue of a warm white reads as 0.62 once converted from sRGB.
    expect(Math.min(l.sunColor.r, l.sunColor.g, l.sunColor.b)).toBeGreaterThan(0.55);
    expect(l.sunColor.r).toBeGreaterThanOrEqual(l.sunColor.b);
    expect(l.disc).toBe(1);
  });

  it("turns orange and drops to the left horizon at dusk", () => {
    const l = at(18);
    expect(l.sunColor.r).toBeGreaterThan(l.sunColor.g);
    expect(l.sunColor.g).toBeGreaterThan(l.sunColor.b);
    expect(l.elevation).toBeLessThan(12);
    expect(l.sunDir.x).toBeLessThan(-0.3);
    expect(l.skyHorizon.r).toBeGreaterThan(l.skyHorizon.b);
    expect(l.exposure).toBeLessThan(at(12).exposure + 0.01);
  });

  it("keeps a cool, dim, readable key light at night", () => {
    const l = at(23);
    expect(l.sunColor.b).toBeGreaterThan(l.sunColor.r);
    expect(l.sunIntensity).toBeGreaterThan(0.3);
    expect(l.sunIntensity).toBeLessThan(1);
    expect(l.hemiIntensity).toBeGreaterThan(0.3);
    expect(l.exposure).toBeGreaterThan(0.6);
    expect(l.exposure).toBeLessThan(at(12).exposure);
    expect(l.skyTop.b).toBeGreaterThan(l.skyTop.r);
    expect(l.daylight).toBe(0);
    // The moon still leans toward the camera so the subject's face is lit.
    expect(l.sunDir.z).toBeGreaterThan(0);
  });

  it("scales the sun and hemisphere by the scene's rig and takes a fixed sky", () => {
    const base = at(12);
    const l = lightingAt(12, createLighting(), { sun: 0.5, hemi: 2, fogNear: 7, fogFar: 24, sky: 0x06070d, fog: 0x0b0e1a });
    expect(l.sunIntensity).toBeCloseTo(base.sunIntensity * 0.5, 5);
    expect(l.hemiIntensity).toBeCloseTo(base.hemiIntensity * 2, 5);
    expect(l.skyTop.getHex()).toBe(0x06070d);
    expect(l.fog.getHex()).toBe(0x0b0e1a);
    expect(l.disc).toBe(0);
    expect(l.fogNear).toBe(7);
  });

  it("is continuous across midnight and wraps hours", () => {
    const a = at(23.99);
    const b = at(0.01);
    expect(Math.abs(a.sunIntensity - b.sunIntensity)).toBeLessThan(0.01);
    expect(at(25).sunIntensity).toBeCloseTo(at(1).sunIntensity, 5);
  });
});

describe("daylight", () => {
  it("is dark at night, full by mid-morning, fading through dusk", () => {
    expect(daylight(2)).toBe(0);
    expect(daylight(12)).toBe(1);
    expect(daylight(19)).toBeGreaterThan(0);
    expect(daylight(19)).toBeLessThan(1);
    expect(daylight(23)).toBe(0);
  });
});
