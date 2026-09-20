import { RECONNECT_GRACE_MS, PRESENCE_TIMEOUT_MS, type PresenceState } from "./types";

export interface PresenceRecord {
  participantId: string;
  connectionId: string;
  connectionStartedAt: number;
  state: PresenceState;
  lastSeen: number;
  reconnectUntil: number | null;
}

export interface PresenceTransition {
  participantId: string;
  connectionId: string;
  connectionStartedAt: number;
  state: PresenceState;
  reconnectUntil: number | null;
}

type PresenceRecordInput = PresenceRecord;

/**
 * Local view of peer leases. Connection IDs make a delayed close from an old browser session
 * harmless after a replacement connection has claimed the participant seat.
 */
export class PresenceTracker {
  private readonly records = new Map<string, PresenceRecord>();

  observe(
    participantId: string,
    connectionId: string,
    at: number,
    connectionStartedAt = at,
  ): boolean {
    const current = this.records.get(participantId);
    if (current && current.connectionId === connectionId && at < current.lastSeen) return false;
    if (
      current &&
      current.connectionId !== connectionId &&
      connectionStartedAt < current.connectionStartedAt
    )
      return false;
    const sameConnection = current?.connectionId === connectionId;
    this.records.set(participantId, {
      participantId,
      connectionId,
      connectionStartedAt: sameConnection
        ? current?.connectionStartedAt ?? connectionStartedAt
        : connectionStartedAt,
      state: "connected",
      lastSeen: sameConnection ? Math.max(current?.lastSeen ?? 0, at) : at,
      reconnectUntil: null,
    });
    return !current || current.connectionId !== connectionId || current.state !== "connected";
  }

  /** Seeds the local lease from a room snapshot without letting an older snapshot rewind it. */
  hydrate(record: PresenceRecordInput): boolean {
    const current = this.records.get(record.participantId);
    if (
      current &&
      current.connectionId === record.connectionId &&
      current.lastSeen > record.lastSeen
    )
      return false;
    if (
      current &&
      current.connectionId !== record.connectionId &&
      record.connectionStartedAt < current.connectionStartedAt
    )
      return false;
    this.records.set(record.participantId, { ...record });
    return !current || current.connectionId !== record.connectionId || current.state !== record.state;
  }

  transition(
    participantId: string,
    connectionId: string,
    state: PresenceState,
    at: number,
    reconnectUntil: number | null = null,
    connectionStartedAt = at,
  ): PresenceTransition | null {
    if (state === "connected") {
      if (!this.observe(participantId, connectionId, at, connectionStartedAt)) return null;
      const current = this.records.get(participantId)!;
      return {
        participantId,
        connectionId,
        connectionStartedAt: current.connectionStartedAt,
        state,
        reconnectUntil: null,
      };
    }

    const current = this.records.get(participantId);
    if (current && current.connectionId !== connectionId) return null;
    const deadline = reconnectUntil ?? at + RECONNECT_GRACE_MS;
    this.records.set(participantId, {
      participantId,
      connectionId,
      connectionStartedAt: current?.connectionStartedAt ?? connectionStartedAt,
      state,
      lastSeen: Math.max(current?.lastSeen ?? 0, at),
      reconnectUntil: state === "expired" ? current?.reconnectUntil ?? deadline : deadline,
    });
    return {
      participantId,
      connectionId,
      connectionStartedAt: current?.connectionStartedAt ?? connectionStartedAt,
      state,
      reconnectUntil: state === "expired" ? current?.reconnectUntil ?? deadline : deadline,
    };
  }

  disconnect(
    participantId: string,
    connectionId: string,
    at: number,
    state: "reconnecting" | "disconnected" = "disconnected",
  ): PresenceTransition | null {
    const current = this.records.get(participantId);
    if (!current || current.connectionId !== connectionId) return null;
    return this.transition(participantId, connectionId, state, at);
  }

  sweep(now: number): PresenceTransition[] {
    const transitions: PresenceTransition[] = [];
    for (const current of this.records.values()) {
      if (current.state === "connected" && now - current.lastSeen >= PRESENCE_TIMEOUT_MS) {
        const reconnectUntil = now + RECONNECT_GRACE_MS;
        const next = { ...current, state: "reconnecting" as const, reconnectUntil };
        this.records.set(current.participantId, next);
        transitions.push({
          participantId: current.participantId,
          connectionId: current.connectionId,
          connectionStartedAt: current.connectionStartedAt,
          state: next.state,
          reconnectUntil,
        });
      } else if (
        (current.state === "reconnecting" || current.state === "disconnected") &&
        current.reconnectUntil !== null &&
        now >= current.reconnectUntil
      ) {
        const next = { ...current, state: "expired" as const };
        this.records.set(current.participantId, next);
        transitions.push({
          participantId: current.participantId,
          connectionId: current.connectionId,
          connectionStartedAt: current.connectionStartedAt,
          state: next.state,
          reconnectUntil: next.reconnectUntil,
        });
      }
    }
    return transitions;
  }

  get(participantId: string) {
    return this.records.get(participantId);
  }

  clear() {
    this.records.clear();
  }
}
