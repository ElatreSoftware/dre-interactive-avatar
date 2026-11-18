// Change the video endpoint here. This is the only URL file the SDK reads.
// Leave proxyOrigin empty to call LiveAvatar directly.
// Set it to your Nginx origin, with no path, to send API, session WebSocket,
// and LiveKit signaling through that server.
const proxyOrigin = "https://avatar.dr-e.com";
const providerApiUrl = "";
const apiPrefix = "/liveavatar";
const wsPrefix = "/liveavatar-ws";
const livekitPrefix = "/livekit";
const livekitUrl = "wss://avatar.dr-e.com/livekit";

function stripTrailingSlash(value) {
    return String(value).replace(/\/+$/, "");
}
function readEnv(names) {
    try {
        const env = typeof process !== "undefined" && process.env ? process.env : undefined;
        if (!env) {
            return undefined;
        }
        for (const name of names) {
            const value = env[name];
            if (typeof value === "string" && value.trim()) {
                return value.trim();
            }
        }
    }
    catch (_error) {
        return undefined;
    }
    return undefined;
}
function readRuntimeConfig() {
    try {
        const runtime = globalThis.__ELATRE_LIVEAVATAR__;
        if (runtime && typeof runtime === "object") {
            return runtime;
        }
    }
    catch (_error) {
        return {};
    }
    return {};
}
function configuredString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function resolveProxyOrigin(override) {
    return stripTrailingSlash(configuredString(override) ||
        configuredString(readRuntimeConfig().proxyOrigin) ||
        readEnv(["LIVEAVATAR_PROXY_ORIGIN", "ELATRE_LIVEAVATAR_PROXY_ORIGIN"]) ||
        configuredString(proxyOrigin) ||
        "");
}
function resolveApiUrl(override, proxyOriginOverride) {
    const explicit = configuredString(override) ||
        configuredString(readRuntimeConfig().apiUrl) ||
        readEnv(["LIVEAVATAR_API_URL", "ELATRE_LIVEAVATAR_API_URL"]);
    if (explicit) {
        return stripTrailingSlash(explicit);
    }
    const origin = resolveProxyOrigin(proxyOriginOverride);
    if (origin) {
        return `${origin}${apiPrefix}`;
    }
    return stripTrailingSlash(providerApiUrl);
}
function websocketProtocol(proxyProtocol) {
    if (proxyProtocol === "wss:" || proxyProtocol === "ws:") {
        return proxyProtocol;
    }
    if (proxyProtocol === "http:") {
        return "ws:";
    }
    return "wss:";
}
function resolveWebSocketUrl(providerUrl, overrideBase, proxyOriginOverride) {
    if (!providerUrl) {
        return providerUrl;
    }
    const origin = resolveProxyOrigin(proxyOriginOverride);
    const base = configuredString(overrideBase) ||
        configuredString(readRuntimeConfig().wsUrl) ||
        readEnv(["LIVEAVATAR_WS_URL", "ELATRE_LIVEAVATAR_WS_URL"]) ||
        (origin ? `${origin}${wsPrefix}` : "");
    if (!base) {
        return providerUrl;
    }
    let parsed;
    let proxy;
    try {
        parsed = new URL(providerUrl);
        proxy = new URL(base);
    }
    catch (_error) {
        return providerUrl;
    }
    const prefix = proxy.pathname === "/" ? "" : proxy.pathname.replace(/\/$/, "");
    const path = `${prefix}${parsed.pathname}`.replace(/\/{2,}/g, "/");
    console.log(livekitUrl);
    console.log(parsed.search);
    console.log(parsed.hash);
    console.log(`${livekitUrl}${parsed.search}${parsed.hash}`);
    return `${livekitUrl}${parsed.search}${parsed.hash}`;
}
function resolveLiveKitUrl(providerUrl, overrideBase, proxyOriginOverride) {
    if (!providerUrl) {
        return providerUrl;
    }
    const origin = resolveProxyOrigin(proxyOriginOverride);
    const base = configuredString(overrideBase) ||
        configuredString(readRuntimeConfig().livekitUrl) ||
        readEnv(["LIVEAVATAR_LIVEKIT_URL", "ELATRE_LIVEAVATAR_LIVEKIT_URL"]) ||
        (origin ? `${origin}${livekitPrefix}` : "");
    if (!base) {
        return providerUrl;
    }
    let parsed;
    let proxy;
    try {
        parsed = new URL(providerUrl);
        proxy = new URL(base);
    }
    catch (_error) {
        return providerUrl;
    }
    const prefix = proxy.pathname === "/" ? "" : proxy.pathname.replace(/\/$/, "");
    return `${websocketProtocol(proxy.protocol)}//${proxy.host}${prefix}/${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
}

module.exports = {
    proxyOrigin,
    providerApiUrl,
    apiPrefix,
    wsPrefix,
    livekitPrefix,
    resolveProxyOrigin,
    resolveApiUrl,
    resolveWebSocketUrl,
    resolveLiveKitUrl,
};
