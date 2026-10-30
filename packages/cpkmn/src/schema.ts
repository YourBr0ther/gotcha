/**
 * Schema validation for every member, against the `$defs` entries of
 * `schema/cpkmn.schema.json`. The schema is the contract made checkable; the
 * known-key list for unknown-key preservation is read from the same file so
 * there is one place to add a field.
 */
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "../schema/cpkmn.schema.json";

export type SchemaDef =
  | "manifest"
  | "identity"
  | "stats"
  | "state"
  | "personality"
  | "episodicEvent"
  | "relationships"
  | "pokedex"
  | "inventory"
  | "history"
  | "trade";

const SCHEMA_ID: string = schema.$id;

let ajv: Ajv2020 | undefined;
const validators = new Map<SchemaDef, ValidateFunction>();

function instance(): Ajv2020 {
  if (!ajv) {
    ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, strictRequired: false });
    addFormats(ajv);
    ajv.addSchema(schema);
  }
  return ajv;
}

export function validator(def: SchemaDef): ValidateFunction {
  let v = validators.get(def);
  if (!v) {
    v = instance().getSchema(`${SCHEMA_ID}#/$defs/${def}`);
    if (!v) throw new Error(`schema has no $defs.${def}`);
    validators.set(def, v);
  }
  return v;
}

export interface SchemaFailure {
  path: string;
  message: string;
}

/** Returns [] when the value is valid. */
export function validate(def: SchemaDef, value: unknown): SchemaFailure[] {
  const v = validator(def);
  if (v(value)) return [];
  return (v.errors ?? []).map(describe);
}

function describe(error: ErrorObject): SchemaFailure {
  const path =
    error.keyword === "required"
      ? `${error.instancePath}/${String(error.params.missingProperty)}`
      : error.instancePath || "/";
  const detail =
    error.keyword === "additionalProperties"
      ? `${error.message} (${String(error.params.additionalProperty)})`
      : error.keyword === "enum"
        ? `${error.message}: ${JSON.stringify(error.params.allowedValues)}`
        : (error.message ?? error.keyword);
  return { path, message: detail };
}

export function formatFailures(failures: SchemaFailure[]): string {
  return failures.map((f) => `${f.path} ${f.message}`).join("; ");
}

/** Top-level property names the schema declares for a member. */
export function knownKeys(def: SchemaDef): ReadonlySet<string> {
  const defs = schema.$defs as Record<string, { properties?: Record<string, unknown> }>;
  return new Set(Object.keys(defs[def]?.properties ?? {}));
}

export { schema as cpkmnSchema };
