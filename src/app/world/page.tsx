"use client";

import dynamic from "next/dynamic";

const DevWorld = dynamic(() => import("@/world/dev/DevWorld"), {
  ssr: false,
  loading: () => (
    <div style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", background: "#0b1026", color: "#dfe8ff" }}>
      loading world
    </div>
  ),
});

export default function WorldDevPage() {
  return <DevWorld />;
}
