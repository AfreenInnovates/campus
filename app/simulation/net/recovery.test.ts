import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearRecoverySnapshot,
  readRecoverySnapshot,
  saveRecoverySnapshot,
  type RecoveryData,
} from "./recovery";
import type { EvacueeState } from "./types";

const state: EvacueeState = {
  kind: "evacuee",
  t: 2_000,
  hazardElapsed: 18,
  stateVersion: 7,
  eventSequence: 4,
  position: [1, 2, 0.4],
  sectorId: "entry",
  air: 86,
  health: 93,
  hasBackpack: true,
  equipped: "access-card",
  scenarioProgress: {
    "emergency-backpack": true,
    "lab-access-card": true,
    "gas-valve": false,
    "first-aid-kit": false,
    "lab-safety-clue": false,
    "academic-guide": false,
    "main-exit": false,
  },
  smokeIntensity: 0.2,
  stamina: 74,
  routeStatus: "clear",
  interventionApplied: false,
  assemblyProgress: 0,
  assemblyConfirmed: false,
  failed: false,
  routeMessage: null,
  log: [],
};

const data: RecoveryData = {
  state,
  evidence: [],
  routeStatus: "clear",
  interventionApplied: false,
  latestMessage: null,
  lastAcknowledgement: null,
  processed: {},
  stateVersion: 7,
  eventSequence: 4,
};

describe("recovery snapshots", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  } as Storage;

  beforeEach(() => {
    values.clear();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: storage },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("round-trips authority state for the same drill", () => {
    saveRecoverySnapshot("AB123", "drill-1", data);

    expect(readRecoverySnapshot("AB123", "drill-1", 1)).toMatchObject({
      state,
      evidence: [],
      stateVersion: 7,
      eventSequence: 4,
    });
  });

  it("does not restore a snapshot from an older drill instance", () => {
    saveRecoverySnapshot("AB123", "drill-1", data);

    expect(readRecoverySnapshot("AB123", "drill-2", 1)).toBeNull();
    expect(readRecoverySnapshot("AB123", "drill-1", Date.now() + 1)).toBeNull();
  });

  it("clears a snapshot when the participant intentionally leaves", () => {
    saveRecoverySnapshot("AB123", "drill-1", data);
    clearRecoverySnapshot("AB123");

    expect(readRecoverySnapshot("AB123", "drill-1", 1)).toBeNull();
  });
});
