import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The loader is plain ES5 that runs on a customer's page, so it is exercised
 * the way the browser runs it: evaluated with a real `<script>` as
 * `document.currentScript`.
 */
const LOADER = readFileSync("public/embed.js", "utf8");
const WIDGET_ORIGIN = "https://widget.example";

declare global {
  interface Window {
    DreWidget?: { open: () => void; close: () => void; destroy: () => void };
  }
}

function run(attributes: Record<string, string | null> = {}): HTMLScriptElement {
  const script = document.createElement("script");
  script.src = `${WIDGET_ORIGIN}/embed.js`;
  const defaults: Record<string, string | null> = { "data-embed-key": "pk_dre_7f3a91c4" };
  for (const [name, value] of Object.entries({ ...defaults, ...attributes })) {
    if (value !== null) script.setAttribute(name, value);
  }
  document.head.appendChild(script);

  Object.defineProperty(document, "currentScript", { value: script, configurable: true });
  new Function(LOADER)();
  Object.defineProperty(document, "currentScript", { value: null, configurable: true });
  return script;
}

function frame(): HTMLIFrameElement | null {
  return document.querySelector("iframe");
}

/** The widget's half of the conversation. */
function fromWidget(data: unknown, origin = WIDGET_ORIGIN): void {
  const event = new MessageEvent("message", { data, origin });
  Object.defineProperty(event, "source", { value: frame()?.contentWindow });
  window.dispatchEvent(event);
}

function widgetMessage(type: string, extra: Record<string, unknown> = {}) {
  return { source: "dre-widget", v: 1, type, ...extra };
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  delete window.DreWidget;
  window.innerWidth = 1280;
  window.innerHeight = 900;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mounting", () => {
  it("injects exactly one iframe pointing at the embed document", () => {
    run();
    const iframe = frame();
    expect(iframe).not.toBeNull();
    expect(iframe!.src).toBe(
      `${WIDGET_ORIGIN}/embed/pk_dre_7f3a91c4?o=${encodeURIComponent(window.location.origin)}`,
    );
  });

  it("grants the microphone to the frame, without which a call cannot work", () => {
    run();
    expect(frame()!.getAttribute("allow")).toContain("microphone");
    expect(frame()!.getAttribute("allow")).toContain("autoplay");
  });

  it("derives the widget origin from its own script src", () => {
    const script = document.createElement("script");
    script.src = "https://cdn.other.example/embed.js";
    script.setAttribute("data-embed-key", "pk_dre_7f3a91c4");
    document.head.appendChild(script);
    Object.defineProperty(document, "currentScript", { value: script, configurable: true });
    new Function(LOADER)();
    expect(frame()!.src.startsWith("https://cdn.other.example/embed/")).toBe(true);
  });

  it("starts collapsed, at the corner, above the page", () => {
    run();
    const style = frame()!.style;
    expect(style.width).toBe("96px");
    expect(style.height).toBe("96px");
    expect(style.position).toBe("fixed");
    expect(style.bottom).toBe("0px");
    expect(style.right).toBe("0px");
  });

  it("honours data-position", () => {
    run({ "data-position": "bottom-left" });
    expect(frame()!.style.left).toBe("0px");
    expect(frame()!.style.right).toBe("auto");
  });

  it("mounts nothing and says why when the key is missing", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    run({ "data-embed-key": null });
    expect(frame()).toBeNull();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("data-embed-key"));
  });

  it("ignores a second copy of the tag", () => {
    run();
    run();
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
  });
});

describe("resizing", () => {
  it("expands when the widget asks for room", () => {
    run();
    fromWidget(widgetMessage("resize", { layout: "expanded" }));
    expect(frame()!.style.width).toBe("480px");
    expect(frame()!.style.height).toBe("760px");
  });

  it("takes the whole screen on a phone", () => {
    window.innerWidth = 390;
    window.innerHeight = 640;
    run();
    fromWidget(widgetMessage("resize", { layout: "expanded" }));
    expect(frame()!.style.width).toBe("390px");
  });

  it("keeps a desktop panel inside a short viewport", () => {
    window.innerWidth = 1280;
    window.innerHeight = 700;
    run();
    fromWidget(widgetMessage("resize", { layout: "expanded" }));
    // The panel wants 760px tall; a 700px viewport leaves it 32px of margin.
    expect(frame()!.style.height).toBe("668px");
    expect(frame()!.style.width).toBe("480px");
  });

  it("makes room for the permission notice", () => {
    run();
    fromWidget(widgetMessage("resize", { layout: "notice" }));
    expect(frame()!.style.height).toBe("200px");
  });

  it("falls back to collapsed for an unknown layout", () => {
    run();
    fromWidget(widgetMessage("resize", { layout: "enormous" }));
    expect(frame()!.style.width).toBe("96px");
  });

  it("re-measures when the viewport changes", () => {
    run();
    fromWidget(widgetMessage("resize", { layout: "expanded" }));
    window.innerWidth = 360;
    window.innerHeight = 600;
    window.dispatchEvent(new Event("resize"));
    expect(frame()!.style.width).toBe("360px");
  });
});

describe("message hygiene", () => {
  it.each([
    ["a foreign origin", widgetMessage("resize", { layout: "expanded" }), "https://attacker.example"],
    ["a foreign source tag", { source: "evil", v: 1, type: "resize", layout: "expanded" }, WIDGET_ORIGIN],
    ["a future version", { source: "dre-widget", v: 2, type: "resize", layout: "expanded" }, WIDGET_ORIGIN],
    ["a string payload", "resize", WIDGET_ORIGIN],
    ["null", null, WIDGET_ORIGIN],
  ])("ignores %s", (_label, data, origin) => {
    run();
    fromWidget(data, origin as string);
    expect(frame()!.style.width).toBe("96px");
  });
});

describe("the host API", () => {
  it("exposes open, close and destroy", () => {
    run();
    expect(typeof window.DreWidget?.open).toBe("function");
    expect(typeof window.DreWidget?.close).toBe("function");
    expect(typeof window.DreWidget?.destroy).toBe("function");
  });

  it("queues requests made before the widget is ready, then sends them", () => {
    run();
    const post = vi.fn();
    Object.defineProperty(frame()!, "contentWindow", {
      value: { postMessage: post },
      configurable: true,
    });

    window.DreWidget!.open();
    expect(post).not.toHaveBeenCalled();

    fromWidget(widgetMessage("ready"));
    expect(post).toHaveBeenCalledWith(
      { source: "dre-host", v: 1, type: "open" },
      WIDGET_ORIGIN,
    );
  });

  it("removes the frame and itself on destroy", () => {
    run();
    window.DreWidget!.destroy();
    expect(frame()).toBeNull();
    expect(window.DreWidget).toBeUndefined();
  });

  it("relays a widget error to the console rather than throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    run();
    fromWidget(widgetMessage("error", { message: "mic blocked" }));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("mic blocked"));
  });
});

describe("the handshake race", () => {
  /**
   * The frame's `load` event and React mounting inside it race, and either can
   * win. Both orderings must end with exactly one hello.
   */
  it("greets when the widget announces itself", () => {
    run();
    const post = vi.fn();
    Object.defineProperty(frame()!, "contentWindow", {
      value: { postMessage: post },
      configurable: true,
    });

    fromWidget(widgetMessage("ready"));
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ type: "hello" }),
      WIDGET_ORIGIN,
    );
    expect(post.mock.calls.filter((call) => call[0].type === "hello")).toHaveLength(1);
  });

  it("greets again whenever the widget announces itself", () => {
    run();
    const post = vi.fn();
    Object.defineProperty(frame()!, "contentWindow", {
      value: { postMessage: post },
      configurable: true,
    });

    // The hello sent on `load` is usually said before React has mounted a
    // listener inside the frame, so a second `ready` must be answered too.
    fromWidget(widgetMessage("ready"));
    fromWidget(widgetMessage("ready"));
    expect(post.mock.calls.filter((call) => call[0].type === "hello")).toHaveLength(2);
  });

  it("does not greet in response to anything but ready", () => {
    run();
    const post = vi.fn();
    Object.defineProperty(frame()!, "contentWindow", {
      value: { postMessage: post },
      configurable: true,
    });

    fromWidget(widgetMessage("resize", { layout: "collapsed" }));
    fromWidget(widgetMessage("error", { message: "x" }));
    expect(post).not.toHaveBeenCalled();
  });

  it("tells the widget how big the host page is", () => {
    window.innerWidth = 1440;
    window.innerHeight = 900;
    run();
    const post = vi.fn();
    Object.defineProperty(frame()!, "contentWindow", {
      value: { postMessage: post },
      configurable: true,
    });

    fromWidget(widgetMessage("ready"));
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ viewport: { width: 1440, height: 900 } }),
      WIDGET_ORIGIN,
    );
  });

  it("passes the embedder's user id along with the greeting", () => {
    run({ "data-user-id": "customer-42" });
    const post = vi.fn();
    Object.defineProperty(frame()!, "contentWindow", {
      value: { postMessage: post },
      configurable: true,
    });

    fromWidget(widgetMessage("ready"));
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ type: "hello", userId: "customer-42" }),
      WIDGET_ORIGIN,
    );
  });
});
