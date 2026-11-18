import { describe, expect, it } from "vitest";
import {
  HOST_SOURCE,
  isHostMessage,
  isWidgetMessage,
  PROTOCOL_VERSION,
  widgetMessage,
  WIDGET_SOURCE,
} from "@/embed/protocol";

const hello = { source: HOST_SOURCE, v: PROTOCOL_VERSION, type: "hello" };

describe("isHostMessage", () => {
  it("accepts a well-formed message", () => {
    expect(isHostMessage(hello)).toBe(true);
    expect(isHostMessage({ ...hello, type: "open" })).toBe(true);
  });

  it.each([
    ["a foreign source", { ...hello, source: "some-other-widget" }],
    ["our own widget source", { ...hello, source: WIDGET_SOURCE }],
    ["a future version", { ...hello, v: PROTOCOL_VERSION + 1 }],
    ["a string version", { ...hello, v: "1" }],
    ["an unknown type", { ...hello, type: "eval" }],
    ["a missing type", { source: HOST_SOURCE, v: PROTOCOL_VERSION }],
    ["null", null],
    ["a string", "hello"],
    ["an array", []],
  ])("rejects %s", (_label, value) => {
    expect(isHostMessage(value)).toBe(false);
  });
});

describe("isWidgetMessage", () => {
  it("accepts what the widget sends", () => {
    expect(isWidgetMessage(widgetMessage("ready"))).toBe(true);
    expect(isWidgetMessage(widgetMessage("resize", { layout: "expanded" }))).toBe(true);
  });

  it("rejects a host message", () => {
    expect(isWidgetMessage(hello)).toBe(false);
  });
});

describe("widgetMessage", () => {
  it("stamps source and version", () => {
    expect(widgetMessage("ready")).toEqual({
      source: WIDGET_SOURCE,
      v: PROTOCOL_VERSION,
      type: "ready",
    });
  });

  it("carries extra fields", () => {
    expect(widgetMessage("error", { message: "boom" })).toMatchObject({
      type: "error",
      message: "boom",
    });
  });
});
