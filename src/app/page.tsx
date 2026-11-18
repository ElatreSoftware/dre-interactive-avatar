import { headers } from "next/headers";
import { InteractiveAvatar } from "@/components/avatar";
import { AvatarProvider } from "@/avatar";
import { signGrant } from "@/embed/grant";
import { INTERNAL_EMBED_KEY } from "@/embed/registry";
import { originFromHeaders } from "@/embed/requestOrigin";
import { getGrantSecret } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * The first-party page.
 *
 * It embeds with a reserved key and a grant of its own, so the session route
 * has one authorisation path rather than an "embedded" branch and a
 * "not embedded" branch — the second of which would be the under-tested one.
 */
export default async function HomePage() {
  const avatarId = process.env.NEXT_PUBLIC_AVATAR_ID ?? "";

  const headerList = await headers();
  // Must match what the session route computes, or this page cannot start a
  // call behind a TLS-terminating proxy — see src/embed/requestOrigin.ts.
  const selfOrigin = originFromHeaders(headerList) ?? "http://localhost:3000";
  const grant = signGrant(
    { embedKey: INTERNAL_EMBED_KEY, parentOrigin: selfOrigin },
    getGrantSecret(),
  );

  return (
    <main className="min-h-dvh">
      {/* The widget is the whole page: a corner button that opens the call. */}
      <AvatarProvider
        config={{
          avatarId,
          embedKey: INTERNAL_EMBED_KEY,
          grant,
          greetingPrompt: "Hello",
        }}
      >
        <InteractiveAvatar title="Dr E" />
      </AvatarProvider>
    </main>
  );
}
