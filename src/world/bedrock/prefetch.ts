/**
 * Image prefetch for creature textures, kept free of three so the bundle
 * loader (which the app imports directly) can start the fetch the moment
 * the manifest names the file, in parallel with the model and animation
 * JSON. The texture loader then takes the decoded image instead of
 * starting its own request behind the scene's first render.
 *
 * Decoding goes through `createImageBitmap` where it exists (off the main
 * thread) and an `<img>` otherwise. The result is drawn onto a canvas by
 * the caller, so the orientation options of ImageBitmap never matter.
 */

export type PrefetchedImage = ImageBitmap | HTMLImageElement;

const pending = new Map<string, Promise<PrefetchedImage>>();

function decodeWithImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image decode failed"));
    };
    img.src = url;
  });
}

async function fetchAndDecode(url: string): Promise<PrefetchedImage> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  const blob = await res.blob();
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Some browsers refuse certain PNGs here; the img path still works.
    }
  }
  return decodeWithImage(blob);
}

/** Start (or join) the fetch and decode of one image URL. */
export function prefetchImage(url: string): Promise<PrefetchedImage> {
  let p = pending.get(url);
  if (!p) {
    p = fetchAndDecode(url);
    // A failed prefetch is forgotten so the texture loader can try again.
    p.catch(() => pending.delete(url));
    pending.set(url, p);
  }
  return p;
}

/** The prefetched image for a URL, removed from the table, or undefined. */
export function takePrefetchedImage(url: string): Promise<PrefetchedImage> | undefined {
  const p = pending.get(url);
  if (p) pending.delete(url);
  return p;
}

/** Drop everything in flight; for tests. */
export function resetPrefetch(): void {
  pending.clear();
}
