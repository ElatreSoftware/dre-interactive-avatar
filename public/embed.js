/**
 * The avatar widget loader.
 *
 *   <script src="https://widget.example/embed.js" data-embed-key="pk_..." async></script>
 *
 * This file runs on someone else's page, so it holds two rules above all
 * others: never throw, and never touch anything it did not create. A customer
 * whose checkout breaks will not care which script was at fault.
 */
(function () {
  "use strict";

  var WIDGET_SOURCE = "dre-widget";
  var HOST_SOURCE = "dre-host";
  var VERSION = 1;

  var LAYOUTS = {
    collapsed: { width: 96, height: 96 },
    notice: { width: 320, height: 200 },
    // Larger than it needs to be for layout. LiveKit's adaptive streaming
    // picks a simulcast layer from the rendered size of the video element, so
    // a bigger frame is literally a sharper picture.
    expanded: { width: 480, height: 760 },
  };

  var script = document.currentScript;
  // `async` without `currentScript` means we cannot find our own config.
  // Nothing to do but leave the page alone.
  if (!script) return;

  var embedKey = script.getAttribute("data-embed-key");
  if (!embedKey) {
    console.error("[avatar-widget] missing data-embed-key on the script tag");
    return;
  }

  var position = script.getAttribute("data-position") || "bottom-right";
  var userId = script.getAttribute("data-user-id") || null;

  // The host that served this file is the host that serves the widget, so
  // there is no origin to configure and copying the tag to staging just works.
  var widgetOrigin;
  try {
    widgetOrigin = new URL(script.src).origin;
  } catch (error) {
    console.error("[avatar-widget] could not resolve the widget origin", error);
    return;
  }

  // Already mounted: a second copy of the tag is a no-op, not a second widget.
  if (window.DreWidget) return;

  var iframe = document.createElement("iframe");
  var currentLayout = "collapsed";
  var isReady = false;
  var queued = [];

  function placeInCorner(style) {
    var vertical = position.indexOf("top") === 0 ? "top" : "bottom";
    var horizontal = position.indexOf("left") > -1 ? "left" : "right";
    style[vertical] = "0px";
    style[horizontal] = "0px";
    style[vertical === "top" ? "bottom" : "top"] = "auto";
    style[horizontal === "left" ? "right" : "left"] = "auto";
  }

  function applyLayout(layout) {
    currentLayout = LAYOUTS[layout] ? layout : "collapsed";
    var size = LAYOUTS[currentLayout];
    var width = size.width;
    var height = size.height;

    if (currentLayout === "expanded") {
      var viewportWidth = window.innerWidth || width;
      var viewportHeight = window.innerHeight || height;
      // Below 640px there is no room for a floating panel; take the screen.
      width = viewportWidth < 640 ? viewportWidth : Math.min(width, viewportWidth - 32);
      height = viewportHeight < 640 ? viewportHeight : Math.min(height, viewportHeight - 32);
    }

    iframe.style.width = width + "px";
    iframe.style.height = height + "px";
  }

  function send(message) {
    if (!iframe.contentWindow) return;
    iframe.contentWindow.postMessage(message, widgetOrigin);
  }

  /**
   * Said on the frame's `load` and again whenever the widget announces itself.
   *
   * Those two race: `load` can fire before React has mounted a listener
   * inside, in which case the first hello is shouted into an empty room. The
   * widget's `ready` is an announcement, not an answer — it is never sent in
   * reply to a hello — so greeting again here cannot start a ping-pong.
   */
  function greet() {
    var hello = { source: HOST_SOURCE, v: VERSION, type: "hello" };
    if (userId) hello.userId = userId;
    // The widget's own `window.innerWidth` is the size of its 96px frame, so
    // left to itself it would record every desktop visitor as a phone.
    hello.viewport = { width: window.innerWidth, height: window.innerHeight };
    send(hello);
  }

  function handleMessage(event) {
    if (event.origin !== widgetOrigin) return;
    if (!iframe.contentWindow || event.source !== iframe.contentWindow) return;

    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.source !== WIDGET_SOURCE || data.v !== VERSION) return;

    switch (data.type) {
      case "ready":
        // It has a listener now; whatever we said at `load` may have been
        // said to nobody.
        greet();
        break;
    }

    switch (data.type) {
      case "ready":
        isReady = true;
        while (queued.length) send(queued.shift());
        break;
      case "resize":
        applyLayout(data.layout);
        break;
      case "error":
        console.warn("[avatar-widget] " + String(data.message));
        break;
    }
  }

  function onViewportResize() {
    applyLayout(currentLayout);
  }

  function request(type) {
    var message = { source: HOST_SOURCE, v: VERSION, type: type };
    if (isReady) send(message);
    else queued.push(message);
  }

  function mount() {
    iframe.src =
      widgetOrigin +
      "/embed/" +
      encodeURIComponent(embedKey) +
      "?o=" +
      encodeURIComponent(window.location.origin);
    iframe.title = "Avatar assistant";
    // Without this, a cross-origin frame gets no microphone — and the failure
    // looks exactly like the visitor clicking "Block".
    iframe.setAttribute("allow", "microphone; autoplay; clipboard-write");
    iframe.setAttribute("frameborder", "0");
    iframe.setAttribute("scrolling", "no");

    var style = iframe.style;
    style.position = "fixed";
    style.border = "0";
    style.zIndex = "2147483000";
    style.background = "transparent";
    style.colorScheme = "normal";
    style.transition =
      "width 220ms cubic-bezier(0.22,1,0.36,1), height 220ms cubic-bezier(0.22,1,0.36,1)";
    placeInCorner(style);
    applyLayout("collapsed");

    iframe.addEventListener("load", greet);
    document.body.appendChild(iframe);
  }

  function destroy() {
    window.removeEventListener("message", handleMessage);
    window.removeEventListener("resize", onViewportResize);
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    try {
      delete window.DreWidget;
    } catch {
      window.DreWidget = undefined;
    }
  }

  try {
    window.addEventListener("message", handleMessage);
    window.addEventListener("resize", onViewportResize);

    if (document.body) mount();
    else document.addEventListener("DOMContentLoaded", mount);

    window.DreWidget = {
      open: function () {
        request("open");
      },
      close: function () {
        request("close");
      },
      destroy: destroy,
    };
  } catch (error) {
    // An exception here is an exception on the customer's page.
    console.error("[avatar-widget] failed to mount", error);
  }
})();
