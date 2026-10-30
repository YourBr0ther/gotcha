import { keyFile } from "@/lib/services/transfer";

/** This install's signing public key, in the shape other installs paste into their known keys. */
export async function GET(): Promise<Response> {
  return Response.json(await keyFile(), { headers: { "Cache-Control": "public, max-age=3600" } });
}
