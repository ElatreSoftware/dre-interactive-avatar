import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// jsdom does not implement these; the widget touches both.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

// jsdom has no media stack, so play() throws "Not implemented" and floods
// stderr. The transport calls it deliberately to nudge autoplay.
HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
HTMLMediaElement.prototype.pause = vi.fn();

// jsdom has no media devices. Tests that care override this per case.
if (!navigator.mediaDevices) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    writable: true,
    value: {},
  });
}
