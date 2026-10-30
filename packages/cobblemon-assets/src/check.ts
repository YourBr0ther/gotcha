// Prints what the renderer will see for one extracted species: clips, poses,
// aspects and texture variants, read back from the cache folder.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Manifest, type ManifestTexture, ManifestSchema, textureFiles } from "./manifest.js";

export async function readManifest(outDir: string, species: string): Promise<Manifest> {
  let raw: string;
  try {
    raw = await readFile(join(outDir, species, "manifest.json"), "utf8");
  } catch {
    throw new Error(`${species} is not in ${outDir}; run \`pnpm assets:extract\` first`);
  }
  return ManifestSchema.parse(JSON.parse(raw));
}

export function formatCheck(manifest: Manifest): string {
  const lines: string[] = [];
  lines.push(`${manifest.name} (#${manifest.dex}, ${manifest.species}) from Cobblemon ${manifest.cobblemonVersion}`);

  lines.push("");
  lines.push("models");
  for (const [id, path] of Object.entries(manifest.models)) lines.push(`  ${id}  ${path}`);

  lines.push("");
  lines.push("clips");
  for (const [group, anim] of Object.entries(manifest.animations)) {
    lines.push(`  ${group}  ${anim.file}`);
    for (const [name, clip] of Object.entries(anim.clips)) {
      const bits = [
        clip.length !== undefined ? `${clip.length}s` : "static",
        clip.loop === true ? "loop" : clip.loop ? String(clip.loop) : "once",
        `${clip.bones} bones`,
      ];
      if (clip.molang > 0) bits.push(`${clip.molang} molang`);
      if (clip.soundEffects?.length) bits.push(`sound ${clip.soundEffects.join(",")}`);
      lines.push(`    ${name.padEnd(22)} ${bits.join(", ")}`);
    }
  }

  lines.push("");
  lines.push("poses");
  for (const [id, poser] of Object.entries(manifest.posers)) {
    lines.push(`  ${id}  ${poser.synthesized ? "(synthesized from clip names; Cobblemon ships this poser as code)" : poser.file}${poser.rootBone ? `  root ${poser.rootBone}` : ""}`);
    for (const [name, expr] of Object.entries(poser.animations)) lines.push(`    ${name.padEnd(22)} ${expr}`);
    for (const [name, pose] of Object.entries(poser.poses)) {
      const flags: string[] = [];
      if (pose.isBattle) flags.push("battle");
      if (pose.isTouchingWater) flags.push("in water");
      if (pose.isUnderWater) flags.push("under water");
      if (pose.condition) flags.push(`if ${pose.condition}`);
      lines.push(`    ${name.padEnd(22)} [${pose.poseTypes.join(" ")}]${flags.length ? "  " + flags.join(", ") : ""}`);
      for (const expr of pose.animations) lines.push(typeof expr === "string" ? `      ${expr}` : `      ${expr.animation}${expr.condition ? `  if ${expr.condition}` : ""}`);
      for (const expr of pose.quirks) lines.push(`      quirk ${expr}`);
    }
    if (poser.unresolvedClips.length > 0) lines.push(`    unresolved clips: ${poser.unresolvedClips.join(", ")}`);
  }

  lines.push("");
  lines.push(`aspects  ${manifest.aspects.length ? manifest.aspects.join(", ") : "(none)"}`);
  if (manifest.forms.length > 0) {
    lines.push(`forms    ${manifest.forms.map((f) => `${f.name}${f.aspects.length ? ` [${f.aspects.join(" ")}]` : ""}`).join(", ")}`);
  }

  lines.push("");
  lines.push("variations (in order; a variation applies when all its aspects are present)");
  for (const v of manifest.variations) {
    const parts: string[] = [];
    if (v.model) parts.push(`model ${v.model}`);
    if (v.poser) parts.push(`poser ${v.poser}`);
    if (v.texture) parts.push(`texture ${describeTexture(v.texture)}`);
    for (const layer of v.layers ?? []) {
      const tags = [layer.emissive ? "emissive" : "", layer.translucent ? "translucent" : ""].filter(Boolean);
      parts.push(`layer ${layer.name ?? "?"} ${layer.texture ? describeTexture(layer.texture) : "(none)"}${tags.length ? ` (${tags.join(", ")})` : ""}`);
    }
    lines.push(`  ${v.aspects.length ? v.aspects.join("+") : "base"}: ${parts.join("; ")}`);
  }

  lines.push("");
  lines.push("textures");
  const used = new Map<string, string[]>();
  for (const v of manifest.variations) {
    const label = v.aspects.length ? v.aspects.join("+") : "base";
    for (const file of textureFiles(v.texture)) used.set(file, [...(used.get(file) ?? []), label]);
    for (const layer of v.layers ?? []) for (const file of textureFiles(layer.texture)) used.set(file, [...(used.get(file) ?? []), `${label} layer`]);
  }
  for (const [name, path] of Object.entries(manifest.textures)) {
    const by = used.get(path);
    lines.push(`  ${name.padEnd(32)} ${by ? by.join(", ") : "unreferenced"}`);
  }

  lines.push("");
  lines.push("sounds");
  const sounds = Object.entries(manifest.sounds);
  if (sounds.length === 0) lines.push("  (none)");
  for (const [kind, sound] of sounds) {
    lines.push(`  ${kind.padEnd(10)} ${sound.file}  ${sound.event}${sound.volume !== undefined ? `  volume ${sound.volume}` : ""}`);
  }

  lines.push("");
  const files = manifest.files;
  lines.push(`files    species.json${files.dex ? ", dex.json" : ""}${files.spawn ? ", spawn.json" : ""}${files.license ? ", license" : ""}, ${files.resolvers.length} resolver(s)`);
  const dexLines = Object.keys(manifest.pokedex).filter((k) => k.endsWith(".desc")).length;
  lines.push(`pokedex  ${dexLines} line(s)`);
  return lines.join("\n");
}

function describeTexture(texture: ManifestTexture): string {
  if (typeof texture === "string") return texture;
  return `animated ${texture.fps}fps [${texture.frames.join(", ")}]${texture.loop === false ? " once" : ""}`;
}
