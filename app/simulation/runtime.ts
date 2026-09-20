import {
  EVACUEE_SPAWN,
  type EquipmentId,
  type RoomId,
  type ScenarioObjectId,
} from "./level";

/** Keep the simulation stable when a tab wakes up after a frame hitch. */
export const clampDt = (dt: number) => Math.min(dt, 0.05);

/**
 * Ephemeral state shared by the 2D simulation loop. Durable drill state belongs
 * to the room authority; this object only holds movement, input, and recovery values.
 */
export const runtime = {
  evacuee: { x: EVACUEE_SPAWN[0], z: EVACUEE_SPAWN[1] },
  evacueeYaw: 0,
  sector: "entry" as RoomId,
  drillStartedAt: 0,
  hazardElapsed: 0,
  recoveryPosition: null as null | { x: number; z: number; yaw: number },
  recoveryHazardElapsed: null as number | null,
  /** Authoritative evacuee transform received by a warden client. */
  netEvacuee: null as null | {
    x: number;
    z: number;
    yaw: number;
    sectorId: RoomId;
    hasBackpack: boolean;
    equipped: EquipmentId | null;
    scenarioProgress: Partial<Record<ScenarioObjectId, boolean>>;
  },
  /** What the action button can do at the current position. */
  useTarget: null as null | {
    kind: "intervention" | "assembly" | "scenario";
    id: string;
  },

  /* input shared by keyboard and coarse-pointer controls */
  keys: {
    forward: false,
    back: false,
    left: false,
    right: false,
    sprint: false,
  },
  touchMove: { x: 0, y: 0 },
  /** Thumb pushed to the edge of the stick: the touch equivalent of holding Shift. */
  touchSprint: false,
};
