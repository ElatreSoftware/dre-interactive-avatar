/**
 * Avatar × ElevenLabs session layer.
 *
 * Wrap your UI in `AvatarProvider`, then reach for whichever hook you need.
 * Nothing outside this folder imports the vendor SDK.
 */
export { AvatarProvider, useAvatarContext } from "./context";
export type {
  AvatarContextValue,
  AvatarProviderProps,
  SessionFactory,
} from "./context";

export { useSession } from "./useSession";
export type { UseSessionResult } from "./useSession";
export { useVoiceChat } from "./useVoiceChat";
export type { UseVoiceChatResult } from "./useVoiceChat";
export { useTextChat } from "./useTextChat";
export type { UseTextChatResult } from "./useTextChat";
export { useAvatarActions } from "./useAvatarActions";
export type { UseAvatarActionsResult } from "./useAvatarActions";
export { useChatHistory } from "./useChatHistory";
export { useMicrophoneDevices } from "./useMicrophoneDevices";
export type { UseMicrophoneDevicesResult } from "./useMicrophoneDevices";

export { MessageSender } from "./types";
export type {
  AvatarLifecycleEvent,
  ConnectionQualityLevel,
  AvatarConfig,
  AvatarMessage,
  MicrophoneDevice,
  SessionCredentials,
  SessionEndReason,
  SessionError,
  SessionErrorCode,
  SessionStatus,
} from "./types";

export { fetchSessionCredentials, SessionTokenError } from "./sessionClient";
export { requestMicrophoneAccess } from "./microphone";
export type { MicrophonePermission } from "./microphone";
