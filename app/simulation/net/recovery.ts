import type {
  CommandAcknowledgement,
  EvidenceRecord,
  EvacueeState,
  RouteMessage,
} from "./types";

export interface RecoveryData {
  state: EvacueeState;
  evidence: EvidenceRecord[];
  routeStatus: EvacueeState["routeStatus"];
  interventionApplied: boolean;
  latestMessage: RouteMessage | null;
  lastAcknowledgement: CommandAcknowledgement | null;
  processed: Record<string, CommandAcknowledgement>;
  stateVersion: number;
  eventSequence: number;
}

export interface RecoverySnapshot extends RecoveryData {
  drillId: string;
  savedAt: number;
}

const keyFor = (code: string) => `campusevac:recovery:${code}`;

export function saveRecoverySnapshot(code: string, drillId: string, data: RecoveryData) {
  if (typeof window === "undefined") return;
  try {
    const snapshot: RecoverySnapshot = { drillId, savedAt: Date.now(), ...data };
    window.localStorage.setItem(keyFor(code), JSON.stringify(snapshot));
  } catch {
    // Recovery is best effort when storage is disabled or full.
  }
}

export function readRecoverySnapshot(code: string, drillId: string, createdAt: number) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(keyFor(code));
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as RecoverySnapshot;
    if (!isRecoverySnapshot(snapshot) || snapshot.drillId !== drillId || snapshot.savedAt < createdAt)
      return null;
    return snapshot;
  } catch {
    return null;
  }
}

function isRecoverySnapshot(value: unknown): value is RecoverySnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<RecoverySnapshot>;
  return (
    typeof snapshot.drillId === "string" &&
    Number.isFinite(snapshot.savedAt) &&
    !!snapshot.state &&
    snapshot.state.kind === "evacuee" &&
    Array.isArray(snapshot.evidence) &&
    typeof snapshot.interventionApplied === "boolean" &&
    !!snapshot.processed &&
    typeof snapshot.processed === "object" &&
    Number.isFinite(snapshot.stateVersion) &&
    Number.isFinite(snapshot.eventSequence)
  );
}

export function clearRecoverySnapshot(code: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(keyFor(code));
  } catch {
    // Recovery cleanup should not block leaving a drill.
  }
}
