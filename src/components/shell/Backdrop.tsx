/**
 * A blurred still of the diorama behind the non-world screens. The image
 * is rendered once from the world into public/bg/diorama.jpg; the gradient
 * under it shows when the file is missing.
 */
export function Backdrop() {
  return (
    <div aria-hidden="true" className="fixed inset-0 -z-10 overflow-hidden bg-[#1b2a1c]">
      <div
        className="absolute -inset-6 bg-cover bg-center"
        style={{
          backgroundImage: "url(/bg/diorama.jpg), linear-gradient(180deg, #5fa8e0 0%, #87c9a2 40%, #3f7a3a 70%, #28491f 100%)",
          filter: "blur(14px) saturate(1.1)",
          transform: "scale(1.04)",
        }}
      />
      <div className="absolute inset-0 bg-black/35" />
    </div>
  );
}

/** Page frame for the card screens: safe-area padding and a centred column. */
export function Screen({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <>
      <Backdrop />
      <div
        className={`mx-auto flex w-full flex-col gap-3 px-4 ${wide ? "max-w-5xl" : "max-w-2xl"}`}
        style={{ paddingTop: "calc(var(--spacing-safe-top) + 16px)", paddingBottom: 24 }}
      >
        {children}
      </div>
    </>
  );
}
