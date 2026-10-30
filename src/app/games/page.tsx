import Link from "next/link";
import { Screen } from "@/components/shell/Backdrop";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import { PageHeader } from "@/components/ui/primitives";
import { GAMES, PLANNED } from "./registry";

export default function GamesPage() {
  const ready = new Set(GAMES.map((g) => g.id));
  const upcoming = PLANNED.filter((g) => !ready.has(g.id));

  return (
    <Screen>
      <PageHeader title="Games" />
      <p className="text-sm text-ink-dim">Short rounds that pay Bytes. Each game pays less the more you play it in a day.</p>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Games">
        {GAMES.map((g) => (
          <li key={g.id}>
            <Link href={g.href} className="card tap flex h-full flex-col items-center gap-2 px-3 py-4 text-center hover:bg-white/10">
              <PixelIcon name={g.icon ?? "games"} size={40} />
              <span className="text-base font-extrabold">{g.title}</span>
              <span className="text-xs text-ink-dim">{g.tagline}</span>
              {g.seconds ? <span className="font-pixel text-[10px] text-ink-faint">~{g.seconds}s</span> : null}
            </Link>
          </li>
        ))}
        {upcoming.map((g) => (
          <li key={g.id} className="card flex h-full flex-col items-center gap-2 px-3 py-4 text-center opacity-75" aria-label={`${g.title}, coming soon`}>
            <PixelIcon name={g.icon ?? "games"} size={40} className="opacity-70" />
            <span className="text-base font-extrabold">{g.title}</span>
            <span className="text-xs text-ink-dim">{g.tagline}</span>
            <span className="rounded-md bg-white/10 px-2 py-0.5 font-pixel text-[10px] uppercase tracking-wider">Coming soon</span>
          </li>
        ))}
      </ul>
    </Screen>
  );
}
