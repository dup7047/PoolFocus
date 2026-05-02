import {
  ChallengeEntry,
  LeaderboardRow,
  ScreenTimeEvent,
  ScreenTimeEventType
} from "./models.js";

const disqualifyingEvents = new Set<ScreenTimeEventType>([
  "shield_unlock",
  "authorization_revoked",
  "monitor_unavailable",
  "heartbeat_missing",
  "selection_changed"
]);

export function finalizeEntries(input: {
  entries: ChallengeEntry[];
  events: ScreenTimeEvent[];
  challengeStartUTC: string;
  challengeEndUTC: string;
  finalizedAt: string;
}): ChallengeEntry[] {
  const challengeStart = new Date(input.challengeStartUTC);
  const challengeEnd = new Date(input.challengeEndUTC);

  return input.entries.map((entry) => {
    const firstEvent = firstDisqualifyingEvent(entry, input.events);
    if (firstEvent) {
      return {
        ...entry,
        status: firstEvent.type === "selection_changed" ? "invalid" : "forfeited",
        forfeitedAt: clampDate(eventOrderingDate(firstEvent), challengeStart, challengeEnd).toISOString(),
        pointsAwarded: 0
      };
    }

    if (entry.status === "active" || entry.status === "ready") {
      return {
        ...entry,
        status: "completed",
        completedAt: minDate(new Date(input.finalizedAt), challengeEnd).toISOString()
      };
    }

    return entry;
  });
}

export function leaderboard(input: {
  entries: ChallengeEntry[];
  challengeStartUTC: string;
  challengeEndUTC: string;
}): LeaderboardRow[] {
  const challengeStart = new Date(input.challengeStartUTC);
  const challengeEnd = new Date(input.challengeEndUTC);
  const sorted = [...input.entries].sort((left, right) => {
    const leftSurvival = survivalEnd(left, challengeStart, challengeEnd);
    const rightSurvival = survivalEnd(right, challengeStart, challengeEnd);
    const survivalDelta = rightSurvival.getTime() - leftSurvival.getTime();
    if (survivalDelta !== 0) {
      return survivalDelta;
    }
    return left.displayName.localeCompare(right.displayName);
  });

  const bestSurvival = sorted[0] ? survivalEnd(sorted[0], challengeStart, challengeEnd).toISOString() : undefined;
  let lastSurvival: string | undefined;
  let currentRank = 0;

  return sorted.map((entry, index) => {
    const survivedUntil = survivalEnd(entry, challengeStart, challengeEnd).toISOString();
    if (survivedUntil !== lastSurvival) {
      currentRank = index + 1;
      lastSurvival = survivedUntil;
    }

    return {
      entry,
      rank: currentRank,
      survivedUntil,
      isCoWinner: entry.status === "completed" && survivedUntil === bestSurvival
    };
  });
}

export function awardPoints(input: {
  entries: ChallengeEntry[];
  challengeStartUTC: string;
  challengeEndUTC: string;
  completionPoints?: number;
}): ChallengeEntry[] {
  const rows = leaderboard(input);
  const winnerIDs = new Set(rows.filter((row) => row.isCoWinner).map((row) => row.entry.id));
  const completionPoints = input.completionPoints ?? 10;

  return input.entries.map((entry) => ({
    ...entry,
    pointsAwarded: winnerIDs.has(entry.id) ? completionPoints : 0
  }));
}

function firstDisqualifyingEvent(entry: ChallengeEntry, events: ScreenTimeEvent[]): ScreenTimeEvent | undefined {
  return events
    .filter((event) => event.entryID === entry.id && disqualifyingEvents.has(event.type))
    .sort((left, right) => eventOrderingDate(left).getTime() - eventOrderingDate(right).getTime())[0];
}

function survivalEnd(entry: ChallengeEntry, challengeStart: Date, challengeEnd: Date): Date {
  if (entry.forfeitedAt) {
    return clampDate(new Date(entry.forfeitedAt), challengeStart, challengeEnd);
  }

  if (entry.status === "completed") {
    return challengeEnd;
  }

  return challengeStart;
}

function eventOrderingDate(event: ScreenTimeEvent): Date {
  return new Date(event.receivedAt ?? event.clientOccurredAt);
}

function clampDate(date: Date, min: Date, max: Date): Date {
  return minDate(maxDate(date, min), max);
}

function minDate(left: Date, right: Date): Date {
  return left.getTime() < right.getTime() ? left : right;
}

function maxDate(left: Date, right: Date): Date {
  return left.getTime() > right.getTime() ? left : right;
}
