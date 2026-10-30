import { ServiceError } from "@/lib/services/errors";
import { CPKMN_CONTENT_TYPE, importPokemon } from "@/lib/services/transfer";
import { json, withTrainer } from "../../_lib/handler";

const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

/** Multipart upload with a `file` field, or the raw .cpkmn bytes as the body. */
export const POST = withTrainer(async (request, { db, trainer, now }) => {
  const contentType = request.headers.get("content-type") ?? "";
  let bytes: Uint8Array;
  if (contentType.startsWith("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) throw new ServiceError("bad_request", "multipart body needs a `file` field");
    if (file.size > MAX_IMPORT_BYTES) throw new ServiceError("bad_request", "file is too large");
    bytes = new Uint8Array(await file.arrayBuffer());
  } else if (contentType.startsWith(CPKMN_CONTENT_TYPE) || contentType.startsWith("application/octet-stream") || contentType.startsWith("application/zip")) {
    const buffer = await request.arrayBuffer();
    if (buffer.byteLength > MAX_IMPORT_BYTES) throw new ServiceError("bad_request", "file is too large");
    bytes = new Uint8Array(buffer);
  } else {
    throw new ServiceError("bad_request", `send multipart/form-data with a file field or a ${CPKMN_CONTENT_TYPE} body`);
  }
  if (bytes.byteLength === 0) throw new ServiceError("bad_request", "the file is empty");
  const result = await importPokemon(db, trainer, bytes, now);
  return json(result, { status: result.outcome === "new" ? 201 : 200 });
});
