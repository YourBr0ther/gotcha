export function titleCase(id: string): string {
  return id
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** First letter up, the rest as written: "under the weather" to "Under the weather". */
export function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function genderGlyph(gender: string): { glyph: string; label: string; className: string } {
  if (gender === "female") return { glyph: "♀", label: "female", className: "text-[#ff7ad9]" };
  if (gender === "male") return { glyph: "♂", label: "male", className: "text-[#6fb6ff]" };
  return { glyph: "—", label: "genderless", className: "text-ink-faint" };
}

export function clockParts(now: Date): { time: string; date: string } {
  const time = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const date = now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  return { time, date };
}

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = now - Date.parse(iso);
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export const MOOD_FACE: Record<string, string> = {
  joyful: "beaming",
  happy: "happy",
  content: "content",
  glum: "glum",
  miserable: "miserable",
  asleep: "asleep",
  sick: "under the weather",
  hungry: "hungry",
  tired: "tired",
  grubby: "grubby",
  bored: "bored",
  lonely: "lonely",
  sleepy: "sleepy",
};
