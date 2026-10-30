"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Screen } from "@/components/shell/Backdrop";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import { Button, BytesPill, PageHeader, SkeletonCard } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { errorText, get, post, type PurchaseResult, type StoreResponse } from "@/components/lib/api";
import { CATEGORY_LABEL, CATEGORY_ORDER, describeEffects, itemGlyph, type Category } from "@/components/lib/items";

export default function StorePage() {
  const { toast } = useToast();
  const [store, setStore] = useState<StoreResponse | null>(null);
  const [category, setCategory] = useState<Category>("berry");
  const [buying, setBuying] = useState<string | null>(null);

  const load = useCallback(() => get<StoreResponse>("/api/store").then(setStore).catch((e) => toast(errorText(e), "error")), [toast]);
  useEffect(() => {
    load();
  }, [load]);

  const bagQty = useMemo(() => new Map((store?.bag ?? []).map((b) => [b.itemId, b.qty])), [store]);
  const items = useMemo(() => (store?.catalog ?? []).filter((i) => i.category === category), [store, category]);

  const buy = async (itemId: string) => {
    if (buying || !store) return;
    setBuying(itemId);
    try {
      const r = await post<PurchaseResult>("/api/store", { itemId, qty: 1 });
      setStore({ ...store, bytes: r.balance, bag: r.bag });
      toast(`Bought ${r.item.name}`, "success");
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBuying(null);
    }
  };

  return (
    <Screen>
      <PageHeader title="Store" aside={<BytesPill bytes={store?.bytes} />} />
      <div className="scroll-thin -mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Categories">
        {CATEGORY_ORDER.map((c) => (
          <button
            key={c}
            role="tab"
            aria-selected={category === c}
            onClick={() => setCategory(c)}
            className={`shrink-0 rounded-full px-4 text-sm font-bold transition ${category === c ? "bg-white text-black" : "card text-ink-dim hover:text-ink"}`}
          >
            {CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>
      {!store ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : (
        <ul className="flex flex-col gap-2" aria-label={CATEGORY_LABEL[category]}>
          {items.map((item) => {
            const glyph = itemGlyph(item);
            const owned = bagQty.get(item.id) ?? 0;
            const poor = store.bytes < item.price;
            return (
              <li key={item.id} className="card flex items-center gap-3 px-3 py-2.5">
                <PixelIcon name={glyph.name} tint={glyph.tint} size={40} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-base font-extrabold">{item.name}</span>
                  <span className="truncate text-xs text-ink-dim">{describeEffects(item) || CATEGORY_LABEL[item.category]}</span>
                  {owned ? <span className="font-pixel text-[10px] text-ink-faint">in bag x{owned}</span> : null}
                </div>
                <Button variant={poor ? "ghost" : "primary"} disabled={buying === item.id || poor} onClick={() => void buy(item.id)} aria-label={`Buy ${item.name} for ${item.price} Bytes`} className="flex-col gap-0 px-3 leading-tight">
                  <span className="font-pixel text-sm">{item.price}</span>
                  <span className="text-[10px] font-bold uppercase">Bytes</span>
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {store && store.bytes === 0 ? <p className="text-center text-xs text-ink-faint">Bytes come from daily care and mini-games. No way to buy them, on purpose.</p> : null}
    </Screen>
  );
}
