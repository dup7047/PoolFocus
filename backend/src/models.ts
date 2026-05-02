export type ChallengeEntryStatus =
  | "pending_config"
  | "ready"
  | "active"
  | "forfeited"
  | "completed"
  | "invalid";

export type ScreenTimeEventType =
  | "shield_unlock"
  | "authorization_revoked"
  | "monitor_unavailable"
  | "heartbeat_missing"
  | "selection_changed"
  | "challenge_completed";

export interface User {
  id: string;
  displayName: string;
}

export interface Pool {
  id: string;
  name: string;
  ownerUserID: string;
  timezoneIdentifier: string;
  privateInviteCode: string;
}

export interface ChallengeDay {
  id: string;
  poolID: string;
  challengeStartUTC: string;
  challengeEndUTC: string;
  status: "scheduled" | "active" | "finalized";
}

export interface ChallengeEntry {
  id: string;
  challengeDayID: string;
  userID: string;
  displayName: string;
  status: ChallengeEntryStatus;
  selectionVersionHash?: string;
  forfeitedAt?: string;
  completedAt?: string;
  pointsAwarded: number;
}

export interface ScreenTimeEvent {
  id: string;
  entryID: string;
  deviceID: string;
  type: ScreenTimeEventType;
  selectionVersionHash?: string;
  clientOccurredAt: string;
  receivedAt?: string;
}

export interface ChallengeReadinessRequest {
  poolID: string;
  challengeDayID: string;
  deviceID: string;
  selectionVersionHash: string;
  appAttestAssertion?: string;
}

export interface ChallengeEventRequest {
  event: ScreenTimeEvent;
  appAttestAssertion?: string;
}

export interface LeaderboardRow {
  entry: ChallengeEntry;
  rank: number;
  survivedUntil: string;
  isCoWinner: boolean;
}
