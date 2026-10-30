import { notFound } from "next/navigation";
import { Suspense } from "react";
import { findManifest, MANIFESTS } from "@/games/manifests";
import { GamePlayer } from "./GamePlayer";

/** Every game is known up front, so the route prerenders without a fallback shell. */
export function generateStaticParams() {
  return MANIFESTS.map((m) => ({ id: m.id }));
}

/** The id read and the player (which reads ?demo and ?seed) both sit under Suspense, as this Next asks for route data. */
export default function GamePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={null}>
      <Loaded params={params} />
    </Suspense>
  );
}

async function Loaded({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const manifest = findManifest(id);
  if (!manifest) notFound();
  return <GamePlayer manifest={manifest} />;
}
