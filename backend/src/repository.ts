import {
  ChallengeDay,
  ChallengeEntry,
  Pool,
  ScreenTimeEvent,
  User
} from "./models.js";

export class InMemoryRepository {
  readonly users = new Map<string, User>();
  readonly pools = new Map<string, Pool>();
  readonly challengeDays = new Map<string, ChallengeDay>();
  readonly entries = new Map<string, ChallengeEntry>();
  readonly events = new Map<string, ScreenTimeEvent>();

  upsertEntry(entry: ChallengeEntry): ChallengeEntry {
    this.entries.set(entry.id, entry);
    return entry;
  }

  appendEvent(event: ScreenTimeEvent): ScreenTimeEvent {
    const receivedEvent: ScreenTimeEvent = {
      ...event,
      receivedAt: event.receivedAt ?? new Date().toISOString()
    };

    if (!this.events.has(receivedEvent.id)) {
      this.events.set(receivedEvent.id, receivedEvent);
    }

    return this.events.get(receivedEvent.id) ?? receivedEvent;
  }

  entriesForChallenge(challengeDayID: string): ChallengeEntry[] {
    return [...this.entries.values()].filter((entry) => entry.challengeDayID === challengeDayID);
  }

  eventsForEntries(entryIDs: Set<string>): ScreenTimeEvent[] {
    return [...this.events.values()].filter((event) => entryIDs.has(event.entryID));
  }
}
