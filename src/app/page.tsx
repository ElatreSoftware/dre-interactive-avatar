import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "401 Unauthorized",
  robots: { index: false, follow: false },
};

/**
 * A fallback, and only that.
 *
 * `src/proxy.ts` answers `/` with a real 401 before this renders, because a
 * page cannot set a status code. This exists so the message is still right if
 * the proxy is ever bypassed — a 200 would be worse than useless, but a blank
 * screen would be worse still.
 */
export default function HomePage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-brand-950 p-8 text-center text-white">
      <div className="max-w-[36ch]">
        <h1 className="mb-2 text-xl font-semibold">You are unauthorized to access</h1>
      </div>
    </main>
  );
}
