import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Avatar widget",
  // An embedded document has nothing to offer a search engine, and being
  // indexed separately from its host page is actively unhelpful.
  robots: { index: false, follow: false },
};

/**
 * The embed document is painted onto someone else's page, so it owns no
 * background of its own — see the `[data-embed-root]` rule in globals.css.
 */
export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return <div data-embed-root>{children}</div>;
}
