import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSession, stubMicrophone, stubSessionEndpoint } from "../avatar/fakeSession";

vi.mock("@elatre/liveavatar-web-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof SdkModule>();
  return { ...actual, ElevenLabsAgentSession: FakeSession };
});

import type * as SdkModule from "@elatre/liveavatar-web-sdk";
import { AgentEventsEnum, SessionEvent } from "@elatre/liveavatar-web-sdk";
import { createRef } from "react";
import { InteractiveAvatar } from "@/components/avatar";
import type { AvatarControl, InteractiveAvatarProps } from "@/components/avatar";
import { AvatarProvider } from "@/avatar";

function renderAvatar(props: InteractiveAvatarProps = {}) {
  return render(
    <AvatarProvider config={{ avatarId: "avatar-1" }}>
      <InteractiveAvatar {...props} />
    </AvatarProvider>,
  );
}

/**
 * Open the call stage and bring the stream up.
 *
 * Subtitles are off by default, so this turns them on — most of these tests
 * are about the transcript, not about how it is revealed. The default itself
 * has its own test.
 */
async function openCall(props: InteractiveAvatarProps = {}) {
  renderAvatar(props);
  await userEvent.click(screen.getByRole("button", { name: /start video call/i }));
  await waitFor(() => expect(FakeSession.last?.calls.start).toBe(1));
  const session = FakeSession.last!;
  act(() => session.fire(SessionEvent.SESSION_STREAM_READY));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Listening"));

  const subtitles = screen.queryByRole("button", { name: /show subtitles/i });
  if (subtitles) await userEvent.click(subtitles);
  return session;
}

beforeEach(() => {
  FakeSession.last = null;
  stubSessionEndpoint();
  stubMicrophone("granted");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllGlobals());

describe("InteractiveAvatar", () => {
  it("shows only a small call button until opened", () => {
    renderAvatar();
    expect(screen.getByRole("button", { name: /start video call/i })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks for the microphone before opening the stage", async () => {
    const getUserMedia = stubMicrophone("granted");
    renderAvatar();
    await userEvent.click(screen.getByRole("button", { name: /start video call/i }));

    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
  });

  it("does not open or start a session when permission is refused", async () => {
    stubMicrophone("denied");
    renderAvatar();
    await userEvent.click(screen.getByRole("button", { name: /start video call/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/microphone access is blocked/i);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(FakeSession.last).toBeNull();
  });

  it("explains when there is no microphone at all", async () => {
    stubMicrophone("missing");
    renderAvatar();
    await userEvent.click(screen.getByRole("button", { name: /start video call/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't find a microphone/i);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clears the refusal notice on a retry that succeeds", async () => {
    stubMicrophone("denied");
    renderAvatar();
    const launcher = screen.getByRole("button", { name: /start video call/i });
    await userEvent.click(launcher);
    await screen.findByRole("alert");

    stubMicrophone("granted");
    await userEvent.click(launcher);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("releases the permission track rather than holding the mic open", async () => {
    const stop = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      writable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }),
        enumerateDevices: vi.fn().mockResolvedValue([]),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    renderAvatar();
    await userEvent.click(screen.getByRole("button", { name: /start video call/i }));
    await waitFor(() => expect(stop).toHaveBeenCalled());
  });

  it("opens a centred modal call stage", async () => {
    await openCall();
    const stage = screen.getByRole("dialog", { name: "AI Assistant" });
    expect(stage).toHaveAttribute("aria-modal", "true");
    expect(screen.queryByRole("button", { name: /start video call/i })).not.toBeInTheDocument();
  });

  it("locks background scrolling while open and restores it on close", async () => {
    await openCall();
    expect(document.body.style.overflow).toBe("hidden");

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(document.body.style.overflow).not.toBe("hidden"));
  });

  it("attaches the video once the stream is ready", async () => {
    const session = await openCall();
    expect(screen.getByTestId("avatar-video")).toBeInTheDocument();
    expect(session.calls.attach.length).toBeGreaterThan(0);
  });
});

describe("transcript panel", () => {
  it("is its own labelled region, separate from the video", async () => {
    const session = await openCall();
    const panel = screen.getByRole("region", { name: /transcript/i });

    act(() =>
      session.fire(AgentEventsEnum.USER_TRANSCRIPTION, { event_id: "e", text: "hello there" }),
    );
    const list = within(panel).getByRole("list", { name: /conversation transcript/i });
    expect(within(list).getByText(/hello there/)).toBeInTheDocument();
  });

  it("is off until asked for: the avatar is the point", async () => {
    renderAvatar();
    await userEvent.click(screen.getByRole("button", { name: /start video call/i }));
    await waitFor(() => expect(FakeSession.last?.calls.start).toBe(1));
    act(() => FakeSession.last!.fire(SessionEvent.SESSION_STREAM_READY));

    expect(screen.queryByRole("region", { name: /transcript/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /show subtitles/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("toggles from the call controls", async () => {
    await openCall();
    const hide = screen.getByRole("button", { name: /hide subtitles/i });
    expect(hide).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(hide);
    expect(screen.queryByRole("region", { name: /transcript/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /show subtitles/i }));
    expect(screen.getByRole("region", { name: /transcript/i })).toBeInTheDocument();
  });

  it("is omitted entirely when disabled", async () => {
    await openCall({ showTranscript: false });
    expect(screen.queryByRole("region", { name: /transcript/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /subtitles/i })).not.toBeInTheDocument();
  });

  // The reported bug: a typed message was sent and answered, but never shown.
  it("shows a typed message in the transcript straight away", async () => {
    const session = await openCall();
    const input = screen.getByLabelText(/type a message/i);

    await userEvent.type(input, "hello from the keyboard");
    await userEvent.click(screen.getByRole("button", { name: /send message/i }));

    const panel = screen.getByRole("region", { name: /transcript/i });
    expect(within(panel).getByText(/hello from the keyboard/)).toBeInTheDocument();
    expect(session.calls.userMessages).toEqual(["hello from the keyboard"]);
    expect(input).toHaveValue("");
  });

  it("keeps the composer in the transcript panel, not the call bar", async () => {
    await openCall();
    const panel = screen.getByRole("region", { name: /transcript/i });
    expect(within(panel).getByLabelText(/type a message/i)).toBeInTheDocument();
  });

  it("marks an interrupted turn and shows the text actually spoken", async () => {
    const session = await openCall();
    act(() => {
      session.fire(AgentEventsEnum.AVATAR_SPEAK_STARTED, { event_id: "u1" });
      session.fire(AgentEventsEnum.AVATAR_TRANSCRIPTION_CHUNK, {
        event_id: "e",
        text: "Once upon a time there was",
      });
      session.fire(AgentEventsEnum.ELEVENLABS_AGENT_EVENT, {
        event_id: "e2",
        elevenlabs_event_type: "interruption",
        data: {},
      });
      session.fire(AgentEventsEnum.ELEVENLABS_AGENT_EVENT, {
        event_id: "e3",
        elevenlabs_event_type: "agent_response_correction",
        data: { corrected_agent_response: "Once upon a time" },
      });
    });

    const panel = screen.getByRole("region", { name: /transcript/i });
    expect(within(panel).getByText(/^Once upon a time$/)).toBeInTheDocument();
    expect(within(panel).getByText(/interrupted/i)).toBeInTheDocument();
  });

  it("signals user activity while typing", async () => {
    const session = await openCall();
    await userEvent.type(screen.getByLabelText(/type a message/i), "hi");
    expect(session.calls.userActivity).toBeGreaterThan(0);
  });

  it("will not send a blank message", async () => {
    await openCall();
    await userEvent.type(screen.getByLabelText(/type a message/i), "   ");
    expect(screen.getByRole("button", { name: /send message/i })).toBeDisabled();
  });
});

describe("call controls", () => {
  it("enables the stop button only while the avatar is speaking", async () => {
    const session = await openCall();
    const stop = screen.getByRole("button", { name: /stop the avatar talking/i });
    expect(stop).toBeDisabled();

    act(() => session.fire(AgentEventsEnum.AVATAR_SPEAK_STARTED, { event_id: "u1" }));
    expect(stop).toBeEnabled();

    await userEvent.click(stop);
    expect(session.calls.interrupt).toBe(1);
  });

  it("toggles the microphone and relabels the button", async () => {
    const session = await openCall();
    await userEvent.click(screen.getByRole("button", { name: /mute microphone/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /unmute microphone/i })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(session.calls.mute).toBe(1);
  });

  it("asks before ending, rather than ending on one tap", async () => {
    const session = await openCall();
    await userEvent.click(screen.getByRole("button", { name: /end conversation/i }));

    expect(screen.getByRole("dialog", { name: /end this call/i })).toBeInTheDocument();
    expect(session.calls.stop).toBe(0);
  });

  it("ends the call and puts the widget away", async () => {
    const session = await openCall();
    await userEvent.click(screen.getByRole("button", { name: /end conversation/i }));
    await userEvent.click(screen.getByRole("button", { name: /^end call$/i }));

    await waitFor(() => expect(session.calls.stop).toBe(1));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /start video call/i })).toBeInTheDocument(),
    );
  });

  it("offers exactly two answers, with the safe one focused", async () => {
    await openCall();
    await userEvent.click(screen.getByRole("button", { name: /end conversation/i }));

    const prompt = screen.getByRole("dialog", { name: /end this call/i });
    expect(within(prompt).getAllByRole("button")).toHaveLength(2);
    expect(within(prompt).getByRole("button", { name: /keep talking/i })).toHaveFocus();
  });

  it("is the only way out: there is no second close control", async () => {
    await openCall();
    expect(screen.queryByRole("button", { name: /close/i })).not.toBeInTheDocument();
  });

  it("keeps talking when the confirmation is dismissed", async () => {
    const session = await openCall();
    await userEvent.click(screen.getByRole("button", { name: /end conversation/i }));
    await userEvent.click(screen.getByRole("button", { name: /keep talking/i }));

    expect(screen.queryByRole("dialog", { name: /end this call/i })).not.toBeInTheDocument();
    expect(session.calls.stop).toBe(0);
    expect(screen.getByRole("button", { name: /end conversation/i })).toBeInTheDocument();
  });

  it("backs out of the confirmation on Escape, rather than closing the call", async () => {
    const session = await openCall();
    await userEvent.click(screen.getByRole("button", { name: /end conversation/i }));
    await userEvent.keyboard("{Escape}");

    // Reaching for "never mind" must not do the thing being confirmed.
    expect(screen.queryByRole("dialog", { name: /end this call/i })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "AI Assistant" })).toBeInTheDocument();
    expect(session.calls.stop).toBe(0);
  });

  it("closes on Escape and releases the session", async () => {
    const session = await openCall();
    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(session.calls.stop).toBe(1);
  });

  it("gives every control an accessible name", async () => {
    await openCall();
    for (const name of [
      /mute microphone/i,
      /stop the avatar talking/i,
      /hide subtitles/i,
      /send message/i,
      /end conversation/i,
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });
});

describe("status and errors", () => {
  it("reflects speaking and listening", async () => {
    const session = await openCall();
    const status = screen.getByRole("status");

    act(() => session.fire(AgentEventsEnum.AVATAR_SPEAK_STARTED, { event_id: "u1" }));
    expect(status).toHaveTextContent("Speaking");

    act(() => session.fire(AgentEventsEnum.AVATAR_SPEAK_ENDED, { event_id: "u1" }));
    expect(status).toHaveTextContent("Listening");
  });

  it("says when it is listening to the user specifically", async () => {
    const session = await openCall();
    act(() => session.fire(AgentEventsEnum.USER_SPEAK_STARTED, { event_id: "e" }));
    expect(screen.getByRole("status")).toHaveTextContent(/listening to you/i);
  });

  it("offers a retry on a retryable failure, with no vendor jargon", async () => {
    const session = await openCall();
    act(() =>
      session.fire(AgentEventsEnum.SESSION_STOPPED, {
        event_id: "e",
        stop_reason: "IDLE_TIMEOUT",
      }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/heygen|livekit|elevenlabs/i);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("offers no retry when the failure is terminal", async () => {
    const session = await openCall();
    act(() =>
      session.fire(AgentEventsEnum.SESSION_STOPPED, { event_id: "e", stop_reason: "NO_CREDITS" }),
    );

    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("announces connection quality for screen readers", async () => {
    const session = await openCall();
    act(() => session.fire(SessionEvent.SESSION_CONNECTION_QUALITY_CHANGED, "BAD"));
    expect(screen.getByText(/connection is poor/i)).toBeInTheDocument();
  });
});

describe("the embedder's control handle", () => {
  function renderWithControl() {
    const control = createRef<AvatarControl>();
    const onLayoutChange = vi.fn();
    render(
      <AvatarProvider config={{ avatarId: "avatar-1" }}>
        <InteractiveAvatar controlRef={control} onLayoutChange={onLayoutChange} />
      </AvatarProvider>,
    );
    return { control, onLayoutChange };
  }

  it("opens the call when the host page asks", async () => {
    const { control } = renderWithControl();
    act(() => control.current!.open());
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  });

  it("still asks for the microphone first — there is no back door", async () => {
    stubMicrophone("denied");
    const { control } = renderWithControl();
    act(() => control.current!.open());

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(FakeSession.last).toBeNull();
  });

  it("closes the call when the host page asks", async () => {
    const { control } = renderWithControl();
    act(() => control.current!.open());
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    act(() => control.current!.close());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("reports the room it needs, including for the permission notice", async () => {
    const { control, onLayoutChange } = renderWithControl();
    expect(onLayoutChange).toHaveBeenLastCalledWith("collapsed");

    act(() => control.current!.open());
    await waitFor(() => expect(onLayoutChange).toHaveBeenLastCalledWith("expanded"));

    act(() => control.current!.close());
    await waitFor(() => expect(onLayoutChange).toHaveBeenLastCalledWith("collapsed"));
  });

  it("asks for notice-sized room when permission is refused", async () => {
    stubMicrophone("denied");
    const { control, onLayoutChange } = renderWithControl();
    act(() => control.current!.open());
    await waitFor(() => expect(onLayoutChange).toHaveBeenLastCalledWith("notice"));
  });
});

describe("the transcript toggle", () => {
  /**
   * The panel used to be `hidden md:flex`, so in a 440px-wide embed the button
   * toggled state that nothing rendered: it looked broken and was.
   * jsdom has no layout, so the guard is that no responsive-hiding class is
   * what stands between the button and the panel.
   */
  function transcriptAside(): HTMLElement | null {
    return document.querySelector("aside");
  }

  it("shows the transcript at any width, not only on a wide screen", async () => {
    await openCall();

    const aside = transcriptAside();
    expect(aside).not.toBeNull();
    expect(aside!.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    expect(screen.getByRole("region", { name: /transcript/i })).toBeInTheDocument();
  });

  it("hides and shows it again when the button is clicked", async () => {
    await openCall();
    const toggle = screen.getByRole("button", { name: /hide subtitles/i });

    await userEvent.click(toggle);
    expect(screen.queryByRole("region", { name: /transcript/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /show subtitles/i }));
    expect(screen.getByRole("region", { name: /transcript/i })).toBeInTheDocument();
  });

  it("reports its state to assistive technology", async () => {
    await openCall();
    const toggle = screen.getByRole("button", { name: /hide subtitles/i });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(toggle);
    expect(screen.getByRole("button", { name: /show subtitles/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});

describe("the stage has no scrim", () => {
  /**
   * The widget is normally inside an iframe sized to the panel, where a
   * tinted backdrop reads as a grey border drawn around the call rather than
   * as the page behind it, dimmed.
   */
  it("draws no tinted backdrop behind the panel", async () => {
    await openCall();
    const backdrop = screen.getByRole("dialog").parentElement!;
    expect(backdrop.className).not.toMatch(/bg-brand-950\/50|backdrop-blur/);
  });

  it("insets the panel evenly, so the rounded corners are not clipped", async () => {
    await openCall();
    const backdrop = screen.getByRole("dialog").parentElement!;
    // Even padding on all four sides, not a one-sided margin.
    expect(backdrop.className).toMatch(/(^|\s)p-4(\s|$)/);
    expect(screen.getByRole("dialog").className).toMatch(/rounded-3xl/);
  });
});
