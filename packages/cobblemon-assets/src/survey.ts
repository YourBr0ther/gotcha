// Walks every animation file, poser and Molang script in the jar and reports
// the query variables, functions and syntax they use. The output is
// MOLANG_SURVEY.md, the brief for the renderer's interpreter.

import type { JarReader } from "./jar.js";
import { PREFIX } from "./catalog.js";
import { isMolangExpression, scanMolang, scanOperators, walkStrings } from "./molang.js";

export interface SurveyEntry {
  count: number;
  files: Set<string>;
  example: string;
  exampleFile: string;
  call: boolean;
  /** Where the reference appears: keyframe, timeline, clip header, effect script, poser, script. */
  contexts: Set<string>;
}

export interface SurveyCategory {
  title: string;
  description: string;
  files: number;
  expressions: number;
  refs: Map<string, SurveyEntry>;
  operators: Map<string, SurveyEntry>;
  /** Spellings seen for each canonical name, e.g. `query.anim_time` for `q.anim_time`. */
  spellings: Map<string, Set<string>>;
}

export interface Survey {
  cobblemonVersion: string;
  categories: SurveyCategory[];
  /** Keyframe counts across pokemon animations: plain numbers versus Molang strings. */
  keyframes: { numeric: number; molang: number; clips: number; clipsWithMolang: number };
  /** Animation JSON keys whose string values are not Molang (enums, names). */
  otherStringKeys: Map<string, { count: number; example: string }>;
}

const BEDROCK = "assets/cobblemon/bedrock/";
/** Keys in animation JSON whose string values are expressions, as opposed to enum-like names. */
const EXPRESSION_KEYS = new Map<string, string>([
  ["rotation", "keyframe"],
  ["position", "keyframe"],
  ["scale", "keyframe"],
  ["pre", "keyframe"],
  ["post", "keyframe"],
  ["timeline", "timeline"],
  ["pre_effect_script", "effect script"],
  ["anim_time_update", "clip header"],
  ["blend_weight", "clip header"],
  ["start_delay", "clip header"],
  ["loop_delay", "clip header"],
]);
const ENUM_KEYS = new Set(["lerp_mode", "effect", "locator", "loop", "format_version", "relative_to", "rotation_mode", "bind_pose_rotation", "bind_pose_position"]);

function category(title: string, description: string): SurveyCategory {
  return { title, description, files: 0, expressions: 0, refs: new Map(), operators: new Map(), spellings: new Map() };
}

function record(map: Map<string, SurveyEntry>, key: string, example: string, file: string, context: string, call = false): void {
  const entry = map.get(key);
  if (entry) {
    entry.count++;
    entry.files.add(file);
    entry.contexts.add(context);
    entry.call ||= call;
  } else {
    map.set(key, { count: 1, files: new Set([file]), example: example.slice(0, 160), exampleFile: file, call, contexts: new Set([context]) });
  }
}

/** The statement of a multi-statement script that mentions `needle`, so examples stay short. */
function statementWith(expr: string, needle: string): string {
  if (!expr.includes(";")) return expr;
  const statement = expr.split(/;\s*/).find((s) => s.includes(needle));
  return statement ? `${statement.trim()};` : expr;
}

function addExpression(cat: SurveyCategory, expr: string, file: string, context: string): void {
  cat.expressions++;
  for (const ref of scanMolang(expr)) {
    record(cat.refs, ref.canonical, statementWith(expr, ref.raw), file, context, ref.call);
    const spellings = cat.spellings.get(ref.canonical) ?? new Set<string>();
    spellings.add(ref.raw);
    cat.spellings.set(ref.canonical, spellings);
  }
  for (const op of scanOperators(expr)) record(cat.operators, op, expr, file, context);
}

export function runSurvey(jar: JarReader, cobblemonVersion: string): Survey {
  const pokemonAnimations = category("Pokemon animations", `Keyframe values, timelines and effect scripts in \`${PREFIX.animations}**/*.animation.json\`.`);
  const otherAnimations = category("Other animations", "Animation files elsewhere under `assets/cobblemon/bedrock/` (poke balls, fossils, NPCs, blocks, generic). Not needed for pokemon but listed so nothing is a surprise.");
  const pokemonPosers = category("Pokemon posers", `Pose animation lists, quirks, conditions and the top-level \`animations\` map in \`${PREFIX.posers}**/*.json\`. These are evaluated once per pose change rather than per frame, and most of them are calls into Cobblemon's own animation functions rather than Bedrock Molang.`);
  const otherPosers = category("Other posers", "Posers under `bedrock/npcs`, `bedrock/fossils`, `bedrock/generic`, `bedrock/block_entities`.");
  const scripts = category("Molang scripts", `Files under \`${PREFIX.molang}\`. These drive entity AI and NPC dialogue on the server, not rendering.`);
  const keyframes = { numeric: 0, molang: 0, clips: 0, clipsWithMolang: 0 };
  const otherStringKeys = new Map<string, { count: number; example: string }>();

  for (const name of jar.names(BEDROCK)) {
    if (name.endsWith(".animation.json")) {
      const isPokemon = name.startsWith(PREFIX.animations);
      const cat = isPokemon ? pokemonAnimations : otherAnimations;
      cat.files++;
      const json = jar.readJson<{ animations?: Record<string, { bones?: unknown }> }>(name);
      if (isPokemon) {
        for (const clip of Object.values(json.animations ?? {})) {
          keyframes.clips++;
          let molang = 0;
          walkKeyframes(clip.bones, (value) => {
            if (typeof value === "number") keyframes.numeric++;
            else if (typeof value === "string" && isMolangExpression(value)) molang++;
            else keyframes.numeric++;
          });
          keyframes.molang += molang;
          if (molang > 0) keyframes.clipsWithMolang++;
        }
      }
      walkStrings(json, (text, path) => {
        const key = path.findLast((p) => !/^[\d.]+$/.test(p)) ?? "";
        const context = EXPRESSION_KEYS.get(key);
        if (context !== undefined) {
          if (isMolangExpression(text)) addExpression(cat, text, name, context);
        } else if (!ENUM_KEYS.has(key) || !isPokemon) {
          if (ENUM_KEYS.has(key)) return;
          const entry = otherStringKeys.get(key) ?? { count: 0, example: text.slice(0, 80) };
          entry.count++;
          otherStringKeys.set(key, entry);
        }
      });
    } else if (name.includes("/posers/") && name.endsWith(".json")) {
      const cat = name.startsWith(PREFIX.posers) ? pokemonPosers : otherPosers;
      cat.files++;
      const json = jar.readJson<unknown>(name);
      walkStrings(json, (text, path) => {
        const key = path.find((p) => p === "animations" || p === "quirks" || p === "condition" || p === "namedAnimations" || p === "transitions");
        if (key && isMolangExpression(text)) addExpression(cat, text, name, key === "condition" ? "pose condition" : "pose animation");
      });
    }
  }

  for (const name of jar.names(PREFIX.molang)) {
    if (!name.endsWith(".molang")) continue;
    scripts.files++;
    addExpression(scripts, jar.readText(name), name, "script");
  }

  return {
    cobblemonVersion,
    categories: [pokemonAnimations, pokemonPosers, scripts, otherAnimations, otherPosers],
    keyframes,
    otherStringKeys,
  };
}

/** Visits every leaf value of a bones block: arrays of 3, keyed-by-time objects, pre/post. */
function walkKeyframes(bones: unknown, visit: (value: unknown) => void): void {
  if (!bones || typeof bones !== "object") return;
  for (const bone of Object.values(bones as Record<string, unknown>)) {
    if (!bone || typeof bone !== "object") continue;
    for (const channel of ["rotation", "position", "scale"]) {
      const value = (bone as Record<string, unknown>)[channel];
      if (value === undefined) continue;
      leaves(value, visit);
    }
  }
}

function leaves(value: unknown, visit: (value: unknown) => void): void {
  if (Array.isArray(value)) value.forEach((v) => leaves(v, visit));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === "lerp_mode") continue;
      leaves(child, visit);
    }
  } else visit(value);
}

export function formatSurvey(survey: Survey): string {
  const out: string[] = [];
  out.push("# Molang survey");
  out.push("");
  out.push(`Generated by \`pnpm exec tsx packages/cobblemon-assets/src/cli.ts survey\` from Cobblemon ${survey.cobblemonVersion}. Every distinct Molang query variable, function and operator used in the jar, with how often it appears, how many files use it and one example. Counts are occurrences, so an expression that reads \`q.anim_time\` twice counts twice.`);
  out.push("");
  const k = survey.keyframes;
  out.push("## What the renderer's interpreter needs");
  out.push("");
  out.push("Derived from the pokemon animation files below. Pose selection in the posers is Cobblemon's own function set (`q.bedrock`, `q.look`, `q.biped_walk`...) and is a different job from evaluating keyframes; see that section.");
  out.push("");
  const anim = survey.categories[0];
  const inContext = (ctx: string, prefix: string): string[] =>
    [...anim.refs].filter(([name, e]) => name.startsWith(prefix) && e.contexts.has(ctx)).sort((a, b) => b[1].count - a[1].count).map(([name, e]) => `${code(name)} (${e.count})`);
  out.push(`- Keyframes read ${inContext("keyframe", "q.").join(", ")}; ${inContext("keyframe", "v.").length ? "variables " + inContext("keyframe", "v.").join(", ") + "; " : ""}math: ${inContext("keyframe", "math.").join(", ")}.`);
  const kfOps = [...anim.operators].filter(([, e]) => e.contexts.has("keyframe")).sort((a, b) => b[1].count - a[1].count).map(([n, e]) => `${n} (${e.count})`);
  out.push(`- Keyframe syntax: ${kfOps.join(", ")}.`);
  const tl = [...anim.refs].filter(([, e]) => e.contexts.has("timeline") || e.contexts.has("effect script") || e.contexts.has("clip header")).map(([name, e]) => `${code(name)} (${[...e.contexts].join(", ")})`);
  out.push(`- Outside keyframes (timelines, effect scripts, clip headers): ${tl.length ? tl.join(", ") : "nothing"}. Timelines are side-effect statements (\`q.sound\`), not values.`);
  out.push("- Unknown names should fall back to 0 and the keyframe's static value, and log once, per the design decision log.");
  out.push("");
  out.push("## Keyframes at a glance");
  out.push("");
  out.push(`- ${k.clips} pokemon clips; ${k.clipsWithMolang} of them (${pct(k.clipsWithMolang, k.clips)}) contain at least one Molang keyframe.`);
  out.push(`- ${(k.numeric + k.molang).toLocaleString("en-US")} keyframe components; ${k.molang.toLocaleString("en-US")} (${pct(k.molang, k.numeric + k.molang)}) are Molang strings, the rest plain numbers.`);
  out.push("");
  for (const cat of survey.categories) {
    out.push(`## ${cat.title}`);
    out.push("");
    out.push(cat.description);
    out.push("");
    out.push(`${cat.files} files, ${cat.expressions.toLocaleString("en-US")} expressions.`);
    out.push("");
    if (cat.refs.size === 0) {
      out.push("No Molang references.");
      out.push("");
      continue;
    }
    for (const [namespace, label] of [["q.", "Query variables and functions"], ["math.", "Math functions"], ["v.", "Variables (`v.` / `variable.`)"], ["t.", "Temporaries (`t.` / `temp.`)"], ["c.", "Context (`c.` / `context.`)"]] as const) {
      const rows = [...cat.refs].filter(([name]) => name.startsWith(namespace)).sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
      if (rows.length === 0) continue;
      out.push(`### ${label}`);
      out.push("");
      out.push("| name | kind | uses | files | where | example |");
      out.push("|---|---|---:|---:|---|---|");
      for (const [name, entry] of rows) {
        const spellings = [...(cat.spellings.get(name) ?? [])].filter((s) => s !== name);
        const shown = spellings.length ? `${code(name)} (also ${spellings.map(code).join(", ")})` : code(name);
        out.push(`| ${shown} | ${entry.call ? "function" : "variable"} | ${entry.count} | ${entry.files.size} | ${[...entry.contexts].sort().join(", ")} | ${code(entry.example)} |`);
      }
      out.push("");
    }
    const ops = [...cat.operators].sort((a, b) => b[1].count - a[1].count);
    out.push("### Syntax");
    out.push("");
    out.push("| construct | expressions | files | example |");
    out.push("|---|---:|---:|---|");
    for (const [name, entry] of ops) out.push(`| ${name} | ${entry.count} | ${entry.files.size} | ${code(entry.example)} |`);
    out.push("");
  }
  out.push("## Animation JSON string keys that are not Molang");
  out.push("");
  out.push("Seen while walking the animation files. These are names or enum values and need no evaluation.");
  out.push("");
  out.push("| key | count | example |");
  out.push("|---|---:|---|");
  for (const [key, entry] of [...survey.otherStringKeys].sort((a, b) => b[1].count - a[1].count)) {
    out.push(`| ${code(key)} | ${entry.count} | ${code(entry.example)} |`);
  }
  out.push("");
  return out.join("\n");
}

function pct(n: number, total: number): string {
  return total === 0 ? "0%" : `${((100 * n) / total).toFixed(1)}%`;
}

function code(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const fence = cleaned.includes("`") ? "``" : "`";
  return `${fence}${cleaned.replace(/\|/g, "\\|")}${fence}`;
}
