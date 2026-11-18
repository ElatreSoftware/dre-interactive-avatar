"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useChatHistory, useSession, useTextChat } from "@/avatar";
import { IconButton } from "@/components/ui/IconButton";
import { SendIcon } from "@/components/ui/icons";
import { MessageBubble } from "./MessageBubble";

export interface TranscriptPanelProps {
  title?: string;
  allowTextInput?: boolean;
}

/**
 * The conversation, as its own region beside the avatar — with the composer at
 * its foot, where a message you type belongs, rather than in the call bar.
 */
export function TranscriptPanel({ title = "Transcript", allowTextInput = true }: TranscriptPanelProps) {
  const messages = useChatHistory();
  const { status } = useSession();
  const { sendMessage, notifyUserActivity } = useTextChat();
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const isLive = status === "listening" || status === "speaking";

  useEffect(() => {
    const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    endRef.current?.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth" });
  }, [messages]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendMessage(draft);
    setDraft("");
  }

  return (
    <section aria-label={title} className="flex min-h-0 flex-1 flex-col bg-brand-50/70">
      <h3 className="shrink-0 border-b border-brand-100 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-brand-400">
        {title}
      </h3>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <p className="pt-8 text-center text-sm text-brand-400">
            Say hello — the avatar is listening.
            <br />
            You can interrupt it any time just by speaking.
          </p>
        ) : (
          <ul aria-label="Conversation transcript" className="flex flex-col gap-3">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
          </ul>
        )}
        <div ref={endRef} />
      </div>

      {allowTextInput ? (
        <form
          onSubmit={handleSubmit}
          className="flex shrink-0 items-center gap-2 border-t border-brand-100 bg-surface px-3 py-3"
        >
          <label className="sr-only" htmlFor="avatar-message">
            Type a message
          </label>
          <input
            id="avatar-message"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              // Keeps the agent from talking over someone mid-sentence.
              notifyUserActivity();
            }}
            placeholder="Type a message…"
            autoComplete="off"
            disabled={!isLive}
            className="min-w-0 flex-1 rounded-full bg-brand-50 px-4 py-2.5 text-sm text-brand-950 ring-1 ring-brand-200 placeholder:text-brand-400 focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-50"
          />
          <IconButton label="Send message" type="submit" disabled={!isLive || !draft.trim()}>
            <SendIcon />
          </IconButton>
        </form>
      ) : null}
    </section>
  );
}
