"use client";

import { MARKERS, type MarkerDef, type RoomId, type ScenarioObjectId } from "../level";
import { getSectorSmoke, VENTILATION_SMOKE_FACTOR } from "../smoke";
import { useSimulation } from "../store";
import { EventsSocket } from "./events";
import { PresenceTracker, type PresenceTransition } from "./presence";
import {
  readRecoverySnapshot,
  saveRecoverySnapshot,
  type RecoveryData,
} from "./recovery";
import { assignRoles, resolveRoom } from "./roles";
import {
  COUNTDOWN_MS,
  PRESENCE_PING_MS,
  WARDEN_SECTORS,
  type ClientIntent,
  type CommandAcknowledgement,
  type ConnectionState,
  type DrillRoom,
  type EvacueeState,
  type EvidenceRecord,
  type JoinFailure,
  type JoinResult,
  type NetClient,
  type NetEvent,
  type Participant,
  type PresenceState,
  type RouteMessage,
  type StartResult,
  type WardenState,
  newConnectionId,
} from "./types";

const CONNECT_TIMEOUT_MS = 8_000;
const PROBE_MS = 1_200;
const JOIN_TIMEOUT_MS = 6_000;
const SYNC_RETRY_MS = 1_500;
const PRESENCE_SWEEP_MS = 1_000;

type WardenIntent = Exclude<ClientIntent, { type: "evacuee-state" }>;
type WardenCommand = Extract<ClientIntent, { type: "warden-command" }>;

/** /game/{code}/room and /game/{code}/cmd. The namespace handler stores each one in DynamoDB. */
type GameMessage =
  | { t: "sync"; from: string; participant?: Participant }
  | { t: "room"; from: string; room: DrillRoom }
  | { t: "reject"; from: string; to: string; reason: JoinFailure }
  | {
      t: "presence";
      from: string;
      participantId: string;
      connectionId: string;
      connectionStartedAt: number;
      state: PresenceState;
      at: number;
      reconnectUntil: number | null;
    }
  | { t: "leave"; from: string; connectionId?: string }
  /** Written to DynamoDB for the debrief and the end-of-drill check. Drives no UI. */
  | { t: "progress"; from: string; step: ScenarioObjectId; at: number; elapsed: number }
  | { t: "intent"; from: string; intent: WardenIntent }
  | { t: "ack"; from: string; to: string; acknowledgement: CommandAcknowledgement };

/** /live/{code}/warden: role-scoped snapshots, broadcast only. */
type LiveMessage = { to: string; state: WardenState };

/** /live/{code}/presence: "still here". Broadcast only, deliberately never stored. */
type PresenceMessage = {
  from: string;
  connectionId?: string;
  connectionStartedAt?: number;
  at: number;
};

/** Drill state held by the evacuee browser once the drill is active. */
interface DrillAuthority {
  drillId: string;
  evacueeState: EvacueeState | null;
  evidence: EvidenceRecord[];
  routeStatus: EvacueeState["routeStatus"];
  interventionApplied: boolean;
  latestMessage: RouteMessage | null;
  lastAcknowledgement: CommandAcknowledgement | null;
  processed: Record<string, CommandAcknowledgement>;
  stateVersion: number;
  eventSequence: number;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const sectorOf = (participant: Participant): RoomId => participant.sectorId ?? WARDEN_SECTORS[0];

function evidenceFor(marker: MarkerDef, now: number): EvidenceRecord {
  return {
    id: marker.id,
    sectorId: marker.room,
    label: marker.label,
    source: marker.source ?? "Authored sector evidence",
    status: "UNKNOWN",
    observedAt: null,
    verifiedAt: null,
    updatedAt: now,
    nextAction: marker.nextAction ?? "Inspect the evidence before communicating.",
  };
}

function wardenState(room: DrillRoom, drill: DrillAuthority, warden: Participant): WardenState {
  const assignedSector = sectorOf(warden);
  const state = drill.evacueeState;
  return {
    kind: "warden",
    t: Date.now(),
    stateVersion: drill.stateVersion,
    eventSequence: drill.eventSequence,
    assignedSector,
    // Movement is shared with the warden in real time; evidence stays sector-scoped.
    evacuee: state ? { position: state.position, sectorId: state.sectorId } : null,
    air: state?.air ?? 100,
    health: state?.health ?? 72,
    hasBackpack: state?.hasBackpack ?? false,
    equipped: state?.equipped ?? null,
    scenarioProgress: state?.scenarioProgress ?? {
      "emergency-backpack": false,
      "lab-access-card": false,
      "gas-valve": false,
      "first-aid-kit": false,
      "lab-safety-clue": false,
      "academic-guide": false,
      "main-exit": false,
    },
    smokeIntensity:
      getSectorSmoke(assignedSector, state?.hazardElapsed ?? 0) *
      (drill.interventionApplied ? VENTILATION_SMOKE_FACTOR : 1),
    routeStatus: drill.routeStatus,
    interventionApplied: drill.interventionApplied,
    assemblyProgress: state?.assemblyProgress ?? (room.outcome === "assembly-confirmed" ? 1 : 0),
    assemblyConfirmed: state?.assemblyConfirmed ?? room.outcome === "assembly-confirmed",
    failed:
      state?.failed ??
      (room.phase === "failed" || room.outcome === "drill-failed" || room.outcome === "participant-left"),
    evidence: drill.evidence.filter((item) => item.sectorId === assignedSector),
    latestMessage: drill.latestMessage,
    lastAcknowledgement: drill.lastAcknowledgement,
    log: state?.log ?? [],
  };
}

/**
 * Two-seat drill over AWS AppSync Events, with no game server:
 * - the host browser owns the lobby (admission, countdown, role draw);
 * - once active, the evacuee browser owns the drill. It already runs movement and smoke, so it
 *   validates warden intents and streams role-scoped warden snapshots at the publish rate.
 * Room snapshots carry a `rev`; every client keeps the highest one it has seen.
 */
export class EventsNet implements NetClient {
  private socket: EventsSocket | null = null;
  private readonly listeners = new Set<(event: NetEvent) => void>();
  private readonly statusListeners = new Set<(state: ConnectionState) => void>();
  private readonly waiters = new Set<(message: GameMessage) => void>();
  private unsubscribe: (() => void)[] = [];
  private socketStatusUnsubscribe: (() => void) | null = null;
  private activationTimer: ReturnType<typeof setTimeout> | null = null;
  private code = "";
  private myId = "";
  private connectionId = "";
  private connectionStartedAt = 0;
  private participant: Participant | null = null;
  private room: DrillRoom | null = null;
  private lobbyOwner = false;
  private authority: DrillAuthority | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private readonly presence = new PresenceTracker();
  private transportReady = false;
  private resyncInFlight = false;
  private lastRecoverySave = 0;

  async connect(code: string, participant?: Participant) {
    this.code = code;
    this.participant = participant
      ? {
          ...participant,
          connectionId: participant.connectionId ?? newConnectionId(),
          connectionStartedAt: participant.connectionStartedAt ?? Date.now(),
        }
      : null;
    this.myId = this.participant?.id ?? "";
    this.connectionId = this.participant?.connectionId ?? "";
    this.connectionStartedAt = this.participant?.connectionStartedAt ?? 0;
    this.emitStatus("connecting");
    const socket = new EventsSocket();
    this.socket = socket;
    this.socketStatusUnsubscribe = socket.onStatus((state) => this.handleSocketStatus(state));
    const game = socket.subscribe(`/game/${code}/*`, (payload) => this.receive(payload as GameMessage));
    const live = socket.subscribe(`/live/${code}/warden`, (payload) => this.receiveLive(payload as LiveMessage));
    const presence = socket.subscribe(`/live/${code}/presence`, (payload) =>
      this.receivePresence(payload as PresenceMessage),
    );
    this.unsubscribe = [game.close, live.close, presence.close];
    try {
      await withTimeout(
        Promise.all([game.ready, live.ready, presence.ready]),
        CONNECT_TIMEOUT_MS,
        "realtime connection timed out",
      );
    } catch (error) {
      this.transportReady = false;
      throw error;
    }
    this.transportReady = true;
    this.startPresence();
    this.emitStatus("connected");
  }

  retry() {
    this.socket?.retryNow();
  }

  disconnect() {
    if (this.activationTimer) clearTimeout(this.activationTimer);
    this.activationTimer = null;
    this.emitStatus("disconnected");
    this.transportReady = false;
    this.socketStatusUnsubscribe?.();
    this.socketStatusUnsubscribe = null;
    this.stopPresence();
    this.presence.clear();
    for (const stop of this.unsubscribe) stop();
    this.unsubscribe = [];
    this.socket?.close();
    this.socket = null;
    this.listeners.clear();
    this.waiters.clear();
    this.room = null;
    this.authority = null;
    this.lobbyOwner = false;
    this.code = "";
    this.myId = "";
    this.connectionId = "";
    this.connectionStartedAt = 0;
    this.participant = null;
    this.resyncInFlight = false;
    this.lastRecoverySave = 0;
    this.statusListeners.clear();
  }

  async createRoom(seed: DrillRoom) {
    // A refreshed host finds the drill still held by the other browser.
    const existing = await this.waitFor(
      (message) => (message.t === "room" ? message.room : undefined),
      PROBE_MS,
      () => this.publish({ t: "sync", from: this.myId, participant: this.joinParticipant() }),
    );
    if (existing) return existing;
    this.lobbyOwner = true;
    this.room = {
      ...seed,
      drillId: seed.drillId || `drill_${seed.code}`,
      hostId: seed.hostId || this.myId,
      rev: 1,
    };
    this.emit({ type: "room", room: this.room });
    return this.room;
  }

  async join(code: string, participant: Participant): Promise<JoinResult> {
    this.myId = participant.id;
    this.participant = {
      ...this.participant,
      ...participant,
      connectionId: participant.connectionId ?? (this.connectionId || newConnectionId()),
      connectionStartedAt: participant.connectionStartedAt ?? (this.connectionStartedAt || Date.now()),
    };
    this.connectionId = this.participant.connectionId!;
    this.connectionStartedAt = this.participant.connectionStartedAt!;
    if (this.lobbyOwner && this.room) {
      const failure = this.admit(this.joinParticipant());
      return failure ? { error: failure } : { room: this.room };
    }

    let sawRoom = false;
    const outcome = await this.waitFor<DrillRoom | JoinFailure>(
      (message) => {
        if (message.t === "reject" && message.to === participant.id) return message.reason;
        if (message.t !== "room") return undefined;
        sawRoom = true;
        return message.room.participants.some((item) => item.id === participant.id) ? message.room : undefined;
      },
      JOIN_TIMEOUT_MS,
      () => this.publish({ t: "sync", from: participant.id, participant: this.joinParticipant() }),
    );
    if (!outcome) return { error: sawRoom ? "unavailable" : "notfound" };
    if (typeof outcome === "string") return { error: outcome };
    const room = this.room ?? outcome;
    this.claimParticipant(room, false);
    return { room: this.room ?? room };
  }

  leave(_code: string, playerId: string) {
    this.publish({
      t: "leave",
      from: playerId,
      ...(playerId === this.myId && this.connectionId ? { connectionId: this.connectionId } : {}),
    });
  }

  async start(_code: string, playerId: string): Promise<StartResult> {
    const room = resolveRoom(this.room);
    if (!room) return { ok: false, error: "notfound" };
    if (!this.lobbyOwner || room.hostId !== playerId) return { ok: false, error: "not-host" };
    if (room.participants.length < room.maxPlayers) return { ok: false, error: "not-ready" };
    if (room.phase !== "lobby" && room.phase !== "preparing") return { ok: false, error: "started" };
    this.commitRoom({
      ...room,
      phase: "active",
      startsAt: null,
      participants: assignRoles(room.participants, room.seed),
    });
    return { ok: true };
  }

  send(intent: ClientIntent) {
    const role = this.me()?.role;
    if (intent.type === "evacuee-state") {
      if (role === "evacuee") this.publishEvacuee(intent.state);
      return;
    }
    if (role === "warden") this.publish({ t: "intent", from: this.myId, intent });
  }

  publishProgress(step: ScenarioObjectId, elapsed: number) {
    if (!this.code || !this.myId) return;
    this.publish({ t: "progress", from: this.myId, step, at: Date.now(), elapsed });
  }

  onMessage(callback: (event: NetEvent) => void) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  onStatus(callback: (state: ConnectionState) => void) {
    this.statusListeners.add(callback);
    return () => this.statusListeners.delete(callback);
  }

  /* ------------------------------------------------------------- transport */

  private emitStatus(state: ConnectionState) {
    for (const callback of this.statusListeners) callback(state);
  }

  private handleSocketStatus(state: "connecting" | "connected" | "reconnecting" | "disconnected") {
    if (state === "reconnecting") {
      if (this.transportReady) this.emitStatus("reconnecting");
      return;
    }
    if (state === "disconnected") {
      if (this.transportReady) this.emitStatus("disconnected");
      return;
    }
    if (state !== "connected" || !this.transportReady) return;
    void this.resyncAfterReconnect();
  }

  private async resyncAfterReconnect() {
    if (this.resyncInFlight || !this.code || !this.myId) return;
    this.resyncInFlight = true;
    this.emitStatus("syncing");
    try {
      const room = resolveRoom(this.room);
      const participant = this.joinParticipant();
      if (room) {
        if (this.lobbyOwner) this.admit(participant);
        else this.claimParticipant(room, true);
        this.publish({ t: "sync", from: this.myId, participant });
        if (room.phase === "active" && this.me()?.role === "evacuee")
          this.broadcastWarden(room, this.drill(room), false);
      }
      this.startPresence();
    } finally {
      this.resyncInFlight = false;
      this.emitStatus("connected");
    }
  }

  private joinParticipant(): Participant {
    return {
      ...(this.participant ?? {
        id: this.myId,
        name: "participant",
        role: null,
        sectorId: null,
        joinedAt: Date.now(),
      }),
      id: this.myId,
      connectionId: this.connectionId || newConnectionId(),
      connectionStartedAt: this.connectionStartedAt || Date.now(),
      connected: true,
      presence: "connected",
      reconnectUntil: null,
    };
  }

  private publish(message: GameMessage) {
    const channel = message.t === "intent" || message.t === "ack" ? "cmd" : "room";
    this.socket?.publish(`/game/${this.code}/${channel}`, [message]);
  }

  private receive(message: GameMessage) {
    if (!message || typeof message !== "object" || message.from === this.myId) return;
    switch (message.t) {
      case "room":
        this.adopt(message.room);
        break;
      case "sync":
        if (!this.room) break;
        if (this.lobbyOwner && message.participant) {
          const failure = this.admit(message.participant);
          if (failure)
            this.publish({ t: "reject", from: this.myId, to: message.participant.id, reason: failure });
        } else {
          this.publish({ t: "room", from: this.myId, room: this.room });
          if (this.me()?.role === "evacuee" && resolveRoom(this.room)?.phase === "active")
            this.broadcastWarden(resolveRoom(this.room)!, this.drill(resolveRoom(this.room)!), false);
        }
        break;
      case "leave":
        this.removeParticipant(message.from, message.connectionId);
        break;
      case "presence":
        this.receiveGamePresence(message);
        break;
      case "progress":
        // recorded by the namespace handler on the way through; nothing to apply locally
        break;
      case "intent":
        this.authorize(message.from, message.intent);
        break;
      case "ack":
        if (message.to === this.myId)
          this.emit({ type: "command-ack", acknowledgement: message.acknowledgement });
        break;
    }
    for (const waiter of [...this.waiters]) waiter(message);
  }

  private receiveLive(message: LiveMessage) {
    if (message?.to === this.myId) this.emit({ type: "warden-state", state: message.state });
  }

  /* --------------------------------------------------------------- presence */

  private startPresence() {
    this.stopPresence();
    const ping = () => {
      if (!this.code || !this.myId) return;
      // volatile: a ping that could not go out is worthless a moment later
      this.socket?.publish(
        `/live/${this.code}/presence`,
        [
          {
            from: this.myId,
            connectionId: this.connectionId,
            connectionStartedAt: this.connectionStartedAt,
            at: Date.now(),
          },
        ],
        true,
      );
    };
    ping();
    this.pingTimer = setInterval(ping, PRESENCE_PING_MS);
    this.sweepTimer = setInterval(() => this.sweepPresence(), PRESENCE_SWEEP_MS);
  }

  private stopPresence() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.pingTimer = null;
    this.sweepTimer = null;
  }

  private receivePresence(message: PresenceMessage) {
    if (!message || typeof message.from !== "string" || message.from === this.myId) return;
    const room = resolveRoom(this.room);
    const participant = room?.participants.find((item) => item.id === message.from);
    if (!participant) return;
    if (!message.connectionId && participant.connectionId) return;
    const connectionId = message.connectionId ?? `legacy:${message.from}`;
    const connectionStartedAt =
      message.connectionStartedAt ?? participant.connectionStartedAt ?? participant.joinedAt;
    const changed = this.presence.observe(message.from, connectionId, Date.now(), connectionStartedAt);
    if (!changed) return;
    const record = this.presence.get(message.from);
    if (record)
      this.applyPresence(
        {
          participantId: message.from,
          connectionId: record.connectionId,
          connectionStartedAt: record.connectionStartedAt,
          state: "connected",
          reconnectUntil: null,
        },
        false,
      );
  }

  private receiveGamePresence(message: Extract<GameMessage, { t: "presence" }>) {
    const room = resolveRoom(this.room);
    const participant = room?.participants.find((item) => item.id === message.participantId);
    const observer = room?.participants.find((item) => item.id === message.from);
    if (!participant || !observer) return;
    const transition = this.presence.transition(
      message.participantId,
      message.connectionId,
      message.state,
      Date.now(),
      message.reconnectUntil,
      message.connectionStartedAt,
    );
    if (transition) this.applyPresence(transition, false);
  }

  /**
   * Marks anyone who has gone quiet. This is what catches a closed tab, since a closed tab
   * sends no `leave`. Participants are only judged once they have pinged at least once, so a
   * client that is still finishing its own connect is never mistaken for a dropout.
   */
  private sweepPresence() {
    const room = resolveRoom(this.room);
    if (!room || room.phase !== "active") return;
    for (const transition of this.presence.sweep(Date.now())) {
      if (transition.participantId !== this.myId) this.applyPresence(transition, true);
    }
  }

  private applyPresence(transition: PresenceTransition, broadcast: boolean) {
    const room = resolveRoom(this.room);
    const current = room?.participants.find((item) => item.id === transition.participantId);
    if (!room || !current) return;
    const currentConnectionId = current.connectionId ?? `legacy:${current.id}`;
    if (
      current.connectionId &&
      currentConnectionId !== transition.connectionId &&
      transition.state !== "connected"
    )
      return;
    const connected = transition.state === "connected";
    const nextParticipant: Participant = {
      ...current,
      connectionId: transition.connectionId,
      connectionStartedAt: transition.connectionStartedAt,
      presence: transition.state,
      reconnectUntil: connected ? null : transition.reconnectUntil,
      connected,
    };
    const changed =
      current.connectionId !== nextParticipant.connectionId ||
      current.connectionStartedAt !== nextParticipant.connectionStartedAt ||
      current.presence !== nextParticipant.presence ||
      current.reconnectUntil !== nextParticipant.reconnectUntil ||
      current.connected !== nextParticipant.connected;
    if (!changed) return;
    this.applyRoom({
      ...room,
      participants: room.participants.map((item) =>
        item.id === transition.participantId ? nextParticipant : item,
      ),
    });
    if (broadcast)
      this.publish({
        t: "presence",
        from: this.myId,
        participantId: transition.participantId,
        connectionId: transition.connectionId,
        connectionStartedAt: transition.connectionStartedAt,
        state: transition.state,
        at: Date.now(),
        reconnectUntil: transition.reconnectUntil,
      });
    if (transition.state === "expired" && room.phase === "active") {
      const currentRoom = resolveRoom(this.room);
      if (currentRoom?.phase === "active")
        this.applyRoom({ ...currentRoom, phase: "failed", outcome: "participant-left" });
    }
  }

  private claimParticipant(room: DrillRoom, broadcast: boolean) {
    if (!room.participants.some((item) => item.id === this.myId)) return;
    const transition = this.presence.transition(
      this.myId,
      this.connectionId,
      "connected",
      Date.now(),
      null,
      this.connectionStartedAt,
    );
    if (transition) this.applyPresence(transition, broadcast);
  }

  /** Commit when this browser owns the lobby, otherwise apply locally so the UI still reacts. */
  private applyRoom(next: DrillRoom) {
    if (this.lobbyOwner) {
      this.commitRoom(next);
      return;
    }
    this.room = next;
    this.emit({ type: "room", room: next });
  }

  /** Resolve with the first message `match` accepts, re-sending `kick` until then; null on timeout. */
  private waitFor<T>(match: (message: GameMessage) => T | undefined, ms: number, kick: () => void) {
    return new Promise<T | null>((resolve) => {
      const finish = (value: T | null) => {
        clearTimeout(timer);
        clearInterval(retry);
        this.waiters.delete(waiter);
        resolve(value);
      };
      const waiter = (message: GameMessage) => {
        const value = match(message);
        if (value !== undefined) finish(value);
      };
      const timer = setTimeout(() => finish(null), ms);
      const retry = setInterval(kick, SYNC_RETRY_MS);
      this.waiters.add(waiter);
      kick();
    });
  }

  private emit(event: NetEvent) {
    for (const callback of this.listeners) callback(event);
  }

  /* ------------------------------------------------------------------ lobby */

  private me() {
    return resolveRoom(this.room)?.participants.find((item) => item.id === this.myId) ?? null;
  }

  private adopt(room: DrillRoom) {
    if (room.code !== this.code) return;
    if (this.room && (room.rev ?? 0) < (this.room.rev ?? 0)) return;
    const now = Date.now();
    const next: DrillRoom = {
      ...room,
      participants: room.participants.map((item) => {
        if (item.id !== this.myId || !this.connectionId) return item;
        return {
          ...item,
          connectionId: this.connectionId,
          connectionStartedAt: this.connectionStartedAt,
          presence: "connected",
          reconnectUntil: null,
          connected: true,
        };
      }),
    };
    this.room = next;
    if (this.myId && next.hostId === this.myId) this.lobbyOwner = true;
    for (const item of next.participants) {
      const connectionId = item.connectionId ?? `legacy:${item.id}`;
      const connectionStartedAt = item.connectionStartedAt ?? item.joinedAt;
      const current = this.presence.get(item.id);
      this.presence.hydrate({
        participantId: item.id,
        connectionId,
        connectionStartedAt,
        state: item.presence ?? (item.connected === false ? "disconnected" : "connected"),
        lastSeen: current?.lastSeen ?? now,
        reconnectUntil: item.reconnectUntil ?? null,
      });
    }
    this.scheduleActivation();
    this.emit({ type: "room", room: next });
  }

  private commitRoom(next: DrillRoom) {
    this.room = { ...next, rev: Math.max(next.rev ?? 0, this.room?.rev ?? 0) + 1 };
    this.scheduleActivation();
    this.emit({ type: "room", room: this.room });
    this.publish({ t: "room", from: this.myId, room: this.room });
  }

  private admit(participant: Participant): JoinFailure | null {
    const room = resolveRoom(this.room);
    if (!room) return "notfound";
    const existing = room.participants.some((item) => item.id === participant.id);
    if (!existing && room.phase !== "lobby" && room.phase !== "preparing") return "unavailable";
    if (!existing && room.participants.length >= room.maxPlayers) return "full";
    const participants = existing
      ? room.participants.map((item) =>
          item.id === participant.id
            ? {
                ...item,
                name: participant.name,
                connectionId: participant.connectionId ?? item.connectionId,
                connectionStartedAt: participant.connectionStartedAt ?? item.connectionStartedAt,
                presence: "connected" as const,
                reconnectUntil: null,
                connected: true,
              }
            : item,
        )
      : [
          ...room.participants,
          {
            ...participant,
            role: null,
            sectorId: null,
            presence: "connected" as const,
            reconnectUntil: null,
            connected: true,
          },
        ];
    const full = participants.length >= room.maxPlayers && room.phase === "lobby";
    this.presence.transition(
      participant.id,
      participant.connectionId ?? `legacy:${participant.id}`,
      "connected",
      Date.now(),
      null,
      participant.connectionStartedAt ?? participant.joinedAt,
    );
    this.commitRoom({
      ...room,
      hostId: room.hostId || participant.id,
      participants,
      ...(full ? { phase: "preparing" as const, startsAt: Date.now() + COUNTDOWN_MS } : {}),
    });
    return null;
  }

  private removeParticipant(id: string, connectionId?: string) {
    const room = resolveRoom(this.room);
    const participant = room?.participants.find((item) => item.id === id);
    if (!room || !participant) return;
    const currentConnectionId = participant.connectionId ?? `legacy:${id}`;
    // A delayed close from an older tab must not remove the replacement connection.
    if (!connectionId && participant.connectionId) return;
    if (connectionId && connectionId !== currentConnectionId) return;
    if (room.phase === "active") {
      const transition = this.presence.transition(
        id,
        currentConnectionId,
        "disconnected",
        Date.now(),
        null,
        participant.connectionStartedAt ?? participant.joinedAt,
      );
      if (transition) this.applyPresence(transition, true);
      return;
    }
    const participants = room.participants.filter((item) => item.id !== id);
    const next: DrillRoom =
      room.phase === "preparing"
        ? { ...room, participants, phase: "lobby", startsAt: null }
        : { ...room, participants };
    this.applyRoom(next);
  }

  private scheduleActivation() {
    if (this.activationTimer) clearTimeout(this.activationTimer);
    this.activationTimer = null;
    const room = this.room;
    if (!this.lobbyOwner || room?.phase !== "preparing" || room.startsAt === null) return;
    this.activationTimer = setTimeout(
      () => {
        this.activationTimer = null;
        const active = resolveRoom(this.room);
        if (active?.phase === "active" && this.room?.phase === "preparing") this.commitRoom(active);
      },
      Math.max(0, room.startsAt - Date.now()) + 50,
    );
  }

  /* ------------------------------------------------------ evacuee authority */

  private drill(room: DrillRoom): DrillAuthority {
    if (this.authority?.drillId === room.drillId) return this.authority;
    const now = Date.now();
    const recovered =
      this.me()?.role === "evacuee"
        ? readRecoverySnapshot(this.code, room.drillId, room.createdAt)
        : null;
    this.authority = {
      drillId: room.drillId,
      evacueeState: recovered?.state ?? null,
      evidence:
        recovered?.evidence ??
        MARKERS.filter((marker) => marker.kind === "evidence").map((marker) => evidenceFor(marker, now)),
      routeStatus: recovered?.routeStatus ?? "clear",
      interventionApplied: recovered?.interventionApplied ?? false,
      latestMessage: recovered?.latestMessage ?? null,
      lastAcknowledgement: recovered?.lastAcknowledgement ?? null,
      processed: recovered?.processed ?? {},
      stateVersion: recovered?.stateVersion ?? 0,
      eventSequence: recovered?.eventSequence ?? 0,
    };
    return this.authority;
  }

  private persistAuthority(drill: DrillAuthority) {
    const state = drill.evacueeState;
    if (!state) return;
    const terminal = state.assemblyConfirmed || state.failed;
    const now = Date.now();
    if (!terminal && now - this.lastRecoverySave < 500) return;
    this.lastRecoverySave = now;
    const data: RecoveryData = {
      state,
      evidence: drill.evidence,
      routeStatus: drill.routeStatus,
      interventionApplied: drill.interventionApplied,
      latestMessage: drill.latestMessage,
      lastAcknowledgement: drill.lastAcknowledgement,
      processed: drill.processed,
      stateVersion: drill.stateVersion,
      eventSequence: drill.eventSequence,
    };
    saveRecoverySnapshot(this.code, drill.drillId, data);
  }

  private broadcastWarden(room: DrillRoom, drill: DrillAuthority, volatile: boolean) {
    for (const warden of room.participants) {
      if (warden.role !== "warden") continue;
      const message: LiveMessage = { to: warden.id, state: wardenState(room, drill, warden) };
      this.socket?.publish(`/live/${this.code}/warden`, [message], volatile);
    }
  }

  private publishEvacuee(state: EvacueeState) {
    const room = resolveRoom(this.room);
    if (!room) return;
    const drill = this.drill(room);
    const routeStatus = drill.interventionApplied
      ? "intervened"
      : drill.routeStatus === "unsafe"
        ? "unsafe"
        : state.routeStatus;
    drill.evacueeState = {
      ...state,
      routeStatus,
      interventionApplied: state.interventionApplied || drill.interventionApplied,
    };
    drill.routeStatus = routeStatus;
    drill.stateVersion += 1;
    this.persistAuthority(drill);

    if (room.phase === "active" && state.assemblyConfirmed)
      this.commitRoom({ ...room, phase: "assembly", outcome: "assembly-confirmed" });
    else if (room.phase === "active" && state.failed)
      this.commitRoom({ ...room, phase: "failed", outcome: "drill-failed" });

    this.broadcastWarden(resolveRoom(this.room) ?? room, drill, true);
  }

  private authorize(from: string, intent: WardenIntent) {
    const room = resolveRoom(this.room);
    const warden = room?.participants.find((item) => item.id === from);
    if (!room || this.me()?.role !== "evacuee" || warden?.role !== "warden") return;
    const drill = this.drill(room);

    if (intent.type === "observe-evidence") {
      const evidence = drill.evidence.find((item) => item.id === intent.evidenceId);
      if (!evidence || evidence.sectorId !== sectorOf(warden) || evidence.status !== "UNKNOWN") return;
      const now = Date.now();
      evidence.status = "OBSERVED";
      evidence.observedAt ??= now;
      evidence.updatedAt = now;
      drill.eventSequence += 1;
      drill.stateVersion += 1;
      this.persistAuthority(drill);
      this.broadcastWarden(room, drill, false);
      return;
    }

    let acknowledgement = drill.processed[intent.idempotencyKey];
    if (!acknowledgement) {
      acknowledgement = this.applyCommand(room, drill, warden, intent);
      drill.processed[intent.idempotencyKey] = acknowledgement;
      drill.lastAcknowledgement = acknowledgement;
      drill.stateVersion += 1;
    }
    this.publish({ t: "ack", from: this.myId, to: from, acknowledgement });
    this.persistAuthority(drill);
    this.broadcastWarden(room, drill, false);
  }

  private applyCommand(
    room: DrillRoom,
    drill: DrillAuthority,
    warden: Participant,
    command: WardenCommand,
  ): CommandAcknowledgement {
    const now = Date.now();
    const evidence = drill.evidence.find((item) => item.id === (command.evidenceId ?? "east-route-evidence"));
    const ack = (accepted: boolean, reason: string | null): CommandAcknowledgement => ({
      id: `${drill.drillId}:ack:${command.idempotencyKey}`,
      command: command.command,
      accepted,
      reason,
      at: now,
      stateVersion: drill.stateVersion,
      eventSequence: drill.eventSequence,
    });
    const deny = (reason: string) => ack(false, reason);

    if (room.phase !== "active") return deny("drill is not active");
    if (!evidence) return deny("evidence target is unavailable");
    if (evidence.sectorId !== sectorOf(warden)) return deny("not your sector");

    switch (command.command) {
      case "VERIFY_EAST_ROUTE":
        if (evidence.status !== "OBSERVED") return deny("observe the evidence first");
        evidence.status = "VERIFIED";
        evidence.verifiedAt = now;
        evidence.updatedAt = now;
        break;
      case "SEND_WEST_ROUTE":
      case "MARK_EAST_UNSAFE":
        if (evidence.status !== "VERIFIED") return deny("verify the east route first");
        drill.routeStatus = drill.interventionApplied ? "intervened" : "unsafe";
        if (command.command === "SEND_WEST_ROUTE") {
          drill.latestMessage = {
            messageId: `${drill.drillId}:message:${drill.eventSequence + 1}`,
            drillId: drill.drillId,
            senderId: warden.id,
            senderSector: sectorOf(warden),
            targetSector: "lobby",
            direction: "west",
            kind: "route",
            confidence: "verified",
            urgency: "urgent",
            createdAt: now,
            expiresAt: now + 12_000,
            caption: "East route is unsafe. Proceed to the verified west route.",
            acknowledgedAt: null,
          };
          this.emit({ type: "route-message", message: drill.latestMessage });
        }
        break;
      case "APPLY_VENTILATION":
        if (drill.interventionApplied) return deny("intervention already applied");
        if (evidence.status !== "VERIFIED") return deny("verify the route evidence first");
        drill.interventionApplied = true;
        drill.routeStatus = "intervened";
        // This browser runs the evacuee simulation, which reads the flag for smoke density.
        useSimulation.getState().applyIntervention();
        break;
    }
    drill.eventSequence += 1;
    return ack(true, null);
  }
}
