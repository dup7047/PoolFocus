import {
  ChallengeDay,
  ChallengeEntry,
  Pool,
  ScreenTimeEvent,
  User
} from "./models.js";

export interface Repository {
  getChallengeDay(id: string): Promise<ChallengeDay | undefined>;
  getEntryByDayAndUser(
    challengeDayID: string,
    userID: string
  ): Promise<ChallengeEntry | undefined>;
  upsertEntry(entry: ChallengeEntry): Promise<ChallengeEntry>;
  appendEvent(event: ScreenTimeEvent): Promise<ScreenTimeEvent>;
  entriesForChallenge(challengeDayID: string): Promise<ChallengeEntry[]>;
  eventsForEntries(entryIDs: Set<string>): Promise<ScreenTimeEvent[]>;
}

export class InMemoryRepository implements Repository {
  readonly users = new Map<string, User>();
  readonly pools = new Map<string, Pool>();
  readonly challengeDays = new Map<string, ChallengeDay>();
  readonly entries = new Map<string, ChallengeEntry>();
  readonly events = new Map<string, ScreenTimeEvent>();

  async getChallengeDay(id: string): Promise<ChallengeDay | undefined> {
    return this.challengeDays.get(id);
  }

  async getEntryByDayAndUser(
    challengeDayID: string,
    userID: string
  ): Promise<ChallengeEntry | undefined> {
    return [...this.entries.values()].find(
      (entry) => entry.challengeDayID === challengeDayID && entry.userID === userID
    );
  }

  async upsertEntry(entry: ChallengeEntry): Promise<ChallengeEntry> {
    this.entries.set(entry.id, entry);
    return entry;
  }

  async appendEvent(event: ScreenTimeEvent): Promise<ScreenTimeEvent> {
    const receivedEvent: ScreenTimeEvent = {
      ...event,
      receivedAt: event.receivedAt ?? new Date().toISOString()
    };

    if (!this.events.has(receivedEvent.id)) {
      this.events.set(receivedEvent.id, receivedEvent);
    }

    return this.events.get(receivedEvent.id) ?? receivedEvent;
  }

  async entriesForChallenge(challengeDayID: string): Promise<ChallengeEntry[]> {
    return [...this.entries.values()].filter(
      (entry) => entry.challengeDayID === challengeDayID
    );
  }

  async eventsForEntries(entryIDs: Set<string>): Promise<ScreenTimeEvent[]> {
    return [...this.events.values()].filter((event) => entryIDs.has(event.entryID));
  }
}
