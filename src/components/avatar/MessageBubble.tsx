"use client";

import clsx from "clsx";
import { MessageSender, type AvatarMessage } from "@/avatar";

export function MessageBubble({ message }: { message: AvatarMessage }) {
  const isUser = message.sender === MessageSender.USER;

  return (
    <li
      data-role={message.sender}
      data-partial={message.isPartial || undefined}
      data-interrupted={message.wasInterrupted || undefined}
      data-typed={message.isTyped || undefined}
      className={clsx("flex flex-col gap-1", isUser ? "items-end" : "items-start")}
    >
      <div
        className={clsx(
          "max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
          isUser
            ? "rounded-br-md bg-brand-950 text-white"
            : "rounded-bl-md bg-white text-brand-900 ring-1 ring-brand-100",
          message.isPartial && "opacity-80",
        )}
      >
        <span className="sr-only">{isUser ? "You said: " : "Avatar said: "}</span>
        {message.message}
      </div>

      {message.wasInterrupted ? (
        <span className="px-1 text-[11px] font-medium text-brand-400">Interrupted</span>
      ) : null}
    </li>
  );
}
