import { VoiceChatConfig } from "../VoiceChat";
export declare enum SessionMode {
    FULL = "FULL",
    LITE = "LITE"
}
export declare enum AgentType {
    FULL = "FULL",
    OPENAI_REALTIME = "OPENAI_REALTIME",
    ELEVENLABS_AGENT = "ELEVENLABS_AGENT",
    GEMINI_REALTIME = "GEMINI_REALTIME",
    UNKNOWN = "UNKNOWN"
}
export declare enum SessionState {
    INACTIVE = "INACTIVE",
    CONNECTING = "CONNECTING",
    CONNECTED = "CONNECTED",
    DISCONNECTING = "DISCONNECTING",
    DISCONNECTED = "DISCONNECTED"
}
export declare enum SessionDisconnectReason {
    UNKNOWN_REASON = "UNKNOWN_REASON",
    CLIENT_INITIATED = "CLIENT_INITIATED",
    SESSION_START_FAILED = "SESSION_START_FAILED",
    SERVER_INITIATED = "SERVER_INITIATED"
}
export interface SessionConfig {
    /** Override the LiveAvatar API base URL. */
    apiUrl?: string;
    /**
     * Backend Nginx origin, for example `https://video.example.com`.
     * API calls use `{origin}/liveavatar` and the session WebSocket uses
     * `{origin}/liveavatar-ws`, unless `apiUrl` or `wsUrl` is set.
     * Also read from `lib/endpoint.config.cjs`, `LIVEAVATAR_PROXY_ORIGIN`, or
     * `globalThis.__ELATRE_LIVEAVATAR__.proxyOrigin`.
     */
    proxyOrigin?: string;
    /**
     * Nginx base for the session event WebSocket returned as `ws_url`.
     * Path and query from the provider URL are preserved.
     * Also read from `LIVEAVATAR_WS_URL`.
     */
    wsUrl?: string;
    /**
     * Nginx base for LiveKit signaling (`livekit_url`), for example
     * `https://video.example.com/livekit`. The original LiveKit host is kept
     * in the path. Also read from `LIVEAVATAR_LIVEKIT_URL`.
     * Leave unset to connect to the provider LiveKit URL directly.
     * WebRTC audio and video still use ICE/UDP and are not carried by this URL.
     */
    livekitUrl?: string;
    /**
     * When true, the SDK automatically sends a keep-alive request to the server
     * every minute for as long as the session is connected. Defaults to false.
     */
    autoKeepAlive?: boolean;
    /**
     * WebRTC configuration for the LiveKit peer connection. Use it for networks
     * where the default connection fails, for example `{ iceTransportPolicy:
     * "relay" }` to force TURN, or your own `iceServers`. ICE servers set here
     * replace the ones LiveKit provides. Behind proxies that only pass HTTPS,
     * use a `turns:` (TLS) URL on port 443. Defaults to LiveKit's configuration.
     */
    rtcConfig?: RTCConfiguration;
    /**
     * Voice chat settings applied when the session connects. Defaults to `{}`,
     * which turns the microphone on unmuted. For a text-only experience pass
     * `{ defaultMuted: true }`.
     */
    voiceChat?: VoiceChatConfig;
}
export interface SessionInfo {
    session_id: string;
    max_session_duration: number | null;
    livekit_url?: string;
    livekit_client_token?: string;
    ws_url?: string;
}
export declare enum Language {
    af = "af",
    sq = "sq",
    am = "am",
    ar = "ar",
    hy = "hy",
    as = "as",
    ast = "ast",
    az = "az",
    ba = "ba",
    eu = "eu",
    be = "be",
    bn = "bn",
    bs = "bs",
    br = "br",
    bg = "bg",
    my = "my",
    ca = "ca",
    ceb = "ceb",
    zh = "zh",
    hr = "hr",
    cs = "cs",
    da = "da",
    nl = "nl",
    en = "en",
    et = "et",
    fo = "fo",
    fi = "fi",
    fr = "fr",
    fy = "fy",
    ff = "ff",
    gd = "gd",
    gl = "gl",
    lg = "lg",
    ka = "ka",
    de = "de",
    el = "el",
    gu = "gu",
    ht = "ht",
    ha = "ha",
    haw = "haw",
    he = "he",
    hi = "hi",
    hu = "hu",
    is = "is",
    ig = "ig",
    ilo = "ilo",
    id = "id",
    ga = "ga",
    it = "it",
    ja = "ja",
    jv = "jv",
    kn = "kn",
    kk = "kk",
    km = "km",
    ko = "ko",
    lo = "lo",
    la = "la",
    lv = "lv",
    lb = "lb",
    ln = "ln",
    lt = "lt",
    mk = "mk",
    mg = "mg",
    ms = "ms",
    ml = "ml",
    mt = "mt",
    mi = "mi",
    mr = "mr",
    mo = "mo",
    mn = "mn",
    ne = "ne",
    no = "no",
    nn = "nn",
    oc = "oc",
    or = "or",
    pa = "pa",
    ps = "ps",
    fa = "fa",
    pl = "pl",
    pt = "pt",
    ro = "ro",
    ru = "ru",
    sa = "sa",
    sr = "sr",
    sn = "sn",
    sd = "sd",
    si = "si",
    sk = "sk",
    sl = "sl",
    so = "so",
    es = "es",
    su = "su",
    sw = "sw",
    ss = "ss",
    sv = "sv",
    tl = "tl",
    tg = "tg",
    ta = "ta",
    tt = "tt",
    te = "te",
    th = "th",
    bo = "bo",
    tn = "tn",
    tr = "tr",
    tk = "tk",
    uk = "uk",
    ur = "ur",
    uz = "uz",
    vi = "vi",
    cy = "cy",
    wo = "wo",
    xh = "xh",
    yi = "yi",
    yo = "yo",
    zu = "zu"
}
