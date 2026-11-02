import Link from "next/link";
import { Screen } from "@/components/shell/Backdrop";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import { PageHeader } from "@/components/ui/primitives";
import { GAMES } from "./registry";

export default function GamesPage() {
  return (
    <Screen>
      <PageHeader title="Games" back="/" />
      <p className="text-sm text-ink-dim">Quick rounds with your pokemon. They earn Bytes, and the first few each day pay best.</p>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Games">
        {GAMES.map((g) => (
          <li key={g.id}>
            <Link href={g.href} className="card tap flex h-full flex-col items-center gap-2 px-3 py-4 text-center hover:bg-white/10">
              <PixelIcon name={g.icon ?? "games"} size={40} />
              <span className="flex min-h-10 items-center text-base font-extrabold leading-tight">{g.title}</span>
              <span className="flex-1 text-xs text-ink-dim">{g.tagline}</span>
              {g.seconds ? <span className="font-pixel text-[10px] text-ink-faint">~{g.seconds}s</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </Screen>
  );
}
