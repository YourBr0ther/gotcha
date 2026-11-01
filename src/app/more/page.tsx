"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Screen } from "@/components/shell/Backdrop";
import { PixelIcon, type PixelIconName } from "@/components/pixel/PixelIcon";
import { BytesPill, PageHeader, Skeleton } from "@/components/ui/primitives";
import { get, type Me } from "@/components/lib/api";

const LINKS: Array<{ href: string; label: string; text: string; icon: PixelIconName }> = [
  { href: "/neighborhood", label: "Neighborhood", text: "Everyone's pokemon at home", icon: "tree" },
  { href: "/pokedex", label: "Pokedex", text: "Every species you have met", icon: "pokeball" },
  { href: "/journal", label: "Journal", text: "What your pokemon remembers", icon: "book" },
  { href: "/settings", label: "Settings", text: "Timezone and the install", icon: "stone" },
];

export default function MorePage() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    get<Me>("/api/me").then(setMe).catch(() => undefined);
  }, []);

  return (
    <Screen>
      <PageHeader title="More" />
      <section className="card flex items-center gap-3 px-3 py-3" aria-label="Trainer">
        <PixelIcon name="pokeball" size={40} />
        <div className="flex flex-1 flex-col">
          {me ? (
            <>
              <span className="text-base font-extrabold">{me.name}</span>
              <span className="text-xs text-ink-dim">
                {me.counts.party} in party, {me.counts.pc} in the PC{me.counts.inTransit ? `, ${me.counts.inTransit} out for trade` : ""}
              </span>
            </>
          ) : (
            <>
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-1 h-3 w-40" />
            </>
          )}
        </div>
        <BytesPill bytes={me?.bytes} />
      </section>
      <ul className="flex flex-col gap-2">
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="card tap flex items-center gap-3 px-3 py-3 hover:bg-white/10">
              <PixelIcon name={l.icon} size={32} />
              <span className="flex flex-1 flex-col">
                <span className="text-base font-extrabold">{l.label}</span>
                <span className="text-xs text-ink-dim">{l.text}</span>
              </span>
              <PixelIcon name="arrowRight" size={18} className="text-ink-faint" />
            </Link>
          </li>
        ))}
      </ul>
    </Screen>
  );
}
