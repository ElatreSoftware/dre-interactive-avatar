import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSession, stubSessionEndpoint } from "./fakeSession";

vi.mock("@elatre/liveavatar-web-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof SdkModule>();
  return { ...actual, ElevenLabsAgentSession: FakeSession };
});

import type * as SdkModule from "@elatre/liveavatar-web-sdk";
import {
  AvatarProvider,
  useAvatarActions,
  useMicrophoneDevices,
  useSession,
  useTextChat,
  useVoiceChat,
} from "@/avatar";

function Probe() {
  const { startSession, keepAlive } = useSession();
  const { setDevice } = useVoiceChat();
  const { sendContextualUpdate } = useTextChat();
  const { startListening, stopListening } = useAvatarActions();
  const { devices, selectedDeviceId, selectDevice } = useMicrophoneDevices();

  return (
    <div>
      <span data-testid="devices">{devices.map((d) => d.label).join("|")}</span>
      <span data-testid="selected">{selectedDeviceId ?? ""}</span>
      <button onClick={() => void startSession()}>start</button>
      <button onClick={() => void keepAlive()}>keepalive</button>
      <button onClick={() => void setDevice({ exact: "mic-2" })}>device</button>
      <button onClick={() => void selectDevice("mic-2")}>select</button>
      <button onClick={() => sendContextualUpdate("on the pricing page")}>context</button>
      <button onClick={startListening}>listen</button>
      <button onClick={stopListening}>unlisten</button>
    </div>
  );
}

function renderProbe() {
  return render(
    <AvatarProvider config={{ avatarId: "a" }}>
      <Probe />
    </AvatarProvider>,
  );
}

beforeEach(() => {
  FakeSession.last = null;
  stubSessionEndpoint();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      enumerateDevices: vi.fn().mockResolvedValue([
        { kind: "audioinput", deviceId: "default", label: "Default" },
        { kind: "audioinput", deviceId: "mic-1", label: "Built-in" },
        { kind: "audioinput", deviceId: "mic-2", label: "" },
        { kind: "videoinput", deviceId: "cam-1", label: "Webcam" },
      ]),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

async function connected() {
  renderProbe();
  await userEvent.click(screen.getByText("start"));
  await waitFor(() => expect(FakeSession.last?.calls.start).toBe(1));
  return FakeSession.last!;
}

describe("useSession.keepAlive", () => {
  it("calls through to the session", async () => {
    const session = await connected();
    await userEvent.click(screen.getByText("keepalive"));
    expect(session.calls.keepAlive).toBe(1);
  });

  it("is a no-op with no session", async () => {
    renderProbe();
    await userEvent.click(screen.getByText("keepalive"));
    expect(FakeSession.last).toBeNull();
  });
});

describe("useVoiceChat.setDevice", () => {
  it("forwards the constraint", async () => {
    const session = await connected();
    await userEvent.click(screen.getByText("device"));
    expect(session.calls.devices).toEqual([{ exact: "mic-2" }]);
  });

  it("returns false rather than throwing when there is no session", async () => {
    renderProbe();
    await userEvent.click(screen.getByText("device"));
    expect(FakeSession.last).toBeNull();
  });
});

describe("useTextChat.sendContextualUpdate", () => {
  it("sends silent context", async () => {
    const session = await connected();
    await userEvent.click(screen.getByText("context"));
    expect(session.calls.contextUpdates).toEqual(["on the pricing page"]);
  });

  it("never throws when the vendor rejects it", async () => {
    const session = await connected();
    session.sendError = new Error("closed");
    await userEvent.click(screen.getByText("context"));
    expect(session.calls.contextUpdates).toEqual([]);
  });
});

describe("useAvatarActions listening", () => {
  it("starts and stops listening without throwing", async () => {
    await connected();
    await userEvent.click(screen.getByText("listen"));
    await userEvent.click(screen.getByText("unlisten"));
  });
});

describe("useMicrophoneDevices", () => {
  it("lists audio inputs, dropping the default alias and non-audio devices", async () => {
    renderProbe();
    await waitFor(() =>
      expect(screen.getByTestId("devices")).toHaveTextContent("Built-in|Microphone mic-"),
    );
    expect(screen.getByTestId("devices")).not.toHaveTextContent("Webcam");
    expect(screen.getByTestId("devices")).not.toHaveTextContent("Default");
  });

  it("selects a device only once the switch succeeded", async () => {
    await connected();
    await userEvent.click(screen.getByText("select"));
    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("mic-2"));
  });

  it("does not claim a device when there is no session to switch", async () => {
    renderProbe();
    await userEvent.click(screen.getByText("select"));
    expect(screen.getByTestId("selected")).toHaveTextContent("");
  });

  it("survives an enumeration failure", async () => {
    vi.mocked(navigator.mediaDevices.enumerateDevices).mockRejectedValue(new Error("blocked"));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("devices")).toHaveTextContent(""));
  });
});
