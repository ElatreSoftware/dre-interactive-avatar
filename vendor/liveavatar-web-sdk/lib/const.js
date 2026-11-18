import endpoint from "./endpoint.config.cjs";

export const LIVEKIT_COMMAND_CHANNEL_TOPIC = "agent-control";
export const LIVEKIT_SERVER_RESPONSE_CHANNEL_TOPIC = "agent-response";
export const PROVIDER_API_URL = endpoint.providerApiUrl;
export const API_URL = endpoint.providerApiUrl;
export const PROXY_API_PREFIX = endpoint.apiPrefix;
export const PROXY_WS_PREFIX = endpoint.wsPrefix;
export const PROXY_ORIGIN = endpoint.proxyOrigin;
export const LIVEKIT_PREFIX = endpoint.livekitPrefix;
export const resolveProxyOrigin = endpoint.resolveProxyOrigin;
export const resolveApiUrl = endpoint.resolveApiUrl;
export const resolveWebSocketUrl = endpoint.resolveWebSocketUrl;
export const resolveLiveKitUrl = endpoint.resolveLiveKitUrl;
