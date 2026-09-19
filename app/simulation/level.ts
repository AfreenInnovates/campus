export type Vec3 = [number, number, number];

/* The compact authored block. IDs are stable across render, collision, and events. */
export type RoomId =
  | "outside"
  | "entry"
  | "lobby"
  | "wcorr"
  | "ecorr"
  | "sec"
  | "vault"
  | "annex"
  | "library"
  | "server";

export type EquipmentId = "access-card" | "emergency-guide";
export type ScenarioObjectId =
  | "emergency-backpack"
  | "lab-access-card"
  | "gas-valve"
  | "first-aid-kit"
  | "lab-safety-clue"
  | "academic-guide"
  | "main-exit";

export type ScenarioObjectKind = "pickup" | "valve" | "clue" | "exit";
export type ScenarioProgress = Record<ScenarioObjectId, boolean>;

export interface ScenarioObjectDef {
  id: ScenarioObjectId;
  kind: ScenarioObjectKind;
  room: RoomId;
  label: string;
  sub: string;
  position: Vec3;
  color: string;
  radius: number;
}

export const WALL_T = 0.3;
export const ROOM_H = 3.8;

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface RoomDef {
  id: RoomId;
  name: string;
  blurb: string;
  bounds: Bounds;
  fog: boolean;
  floor: string;
  cam: { pos: Vec3; target: Vec3 };
}

/**
 * The renderer retains the compact block foundation while the labels and
 * interaction catalog describe the CampusEvac topology.
 */
export const ROOMS: RoomDef[] = [
  {
    id: "outside",
    name: "Plaza / Assembly Point",
    blurb: "Safe staging area with the assembly beacon ahead.",
    bounds: { minX: -21, maxX: 21, minZ: 15.75, maxZ: 39 },
    fog: false,
    floor: "#2c2f33",
    cam: { pos: [0, 22.5, 49.5], target: [0, 3, 4.5] },
  },
  {
    id: "entry",
    name: "Main Entrance",
    blurb: "Notice wall and orientation point for the drill.",
    bounds: { minX: -4.5, maxX: 4.5, minZ: 10.5, maxZ: 15.75 },
    fog: false,
    floor: "#6e6a63",
    cam: { pos: [0, 16.5, 39], target: [0, 2.4, 9] },
  },
  {
    id: "lobby",
    name: "Central Corridor",
    blurb: "Primary route decision between the west and east stairs.",
    bounds: { minX: -8.25, maxX: 8.25, minZ: -10.5, maxZ: 10.5 },
    fog: true,
    floor: "#7b7770",
    cam: { pos: [0, 29.85, 21], target: [0, 0.9, 0] },
  },
  {
    id: "wcorr",
    name: "Science Block / Passage",
    blurb: "Candidate route to the outdoor assembly point.",
    bounds: { minX: -12, maxX: -8.25, minZ: 1.5, maxZ: 6 },
    fog: false,
    floor: "#6e6a63",
    cam: { pos: [-10.5, 13.5, 27], target: [-10.5, 2.1, 3] },
  },
  {
    id: "ecorr",
    name: "Academic Block / Passage",
    blurb: "Route edge that becomes unsafe during the scenario.",
    bounds: { minX: 8.25, maxX: 12, minZ: 1.5, maxZ: 6 },
    fog: false,
    floor: "#6e6a63",
    cam: { pos: [10.5, 13.5, 27], target: [10.5, 2.1, 3] },
  },
  {
    id: "sec",
    name: "Science Block / Chemistry Lab 1A",
    blurb: "Gas control, safety equipment, and the west exit route.",
    bounds: { minX: -33, maxX: -12, minZ: -10.5, maxZ: 10.5 },
    fog: true,
    floor: "#78746d",
    cam: { pos: [-1.5, 29.85, 0], target: [-22.5, 0.9, 0] },
  },
  {
    id: "vault",
    name: "Academic Block / Classroom A201",
    blurb: "Emergency guide, classroom clues, and the east route.",
    bounds: { minX: 12, maxX: 33, minZ: -10.5, maxZ: 10.5 },
    fog: true,
    floor: "#78746d",
    cam: { pos: [1.5, 29.85, 0], target: [22.5, 0.9, 0] },
  },
  {
    id: "annex",
    name: "Academic Block / Electrical Service",
    blurb: "Authored smoke origin and recovery route.",
    bounds: { minX: 19.5, maxX: 25.5, minZ: -15, maxZ: -10.5 },
    fog: false,
    floor: "#5d5a55",
    cam: { pos: [22.5, 13.5, 21], target: [22.5, 2.1, -10.5] },
  },
  {
    id: "library",
    name: "Library",
    blurb: "Quiet study area with reading desks.",
    bounds: { minX: -8.25, maxX: 8.25, minZ: -25.5, maxZ: -10.5 },
    fog: false,
    floor: "#5c5066",
    cam: { pos: [0, 20, -10], target: [0, 0, -18] },
  },
  {
    id: "server",
    name: "Server Room",
    blurb: "High-security data processing center.",
    bounds: { minX: -33, maxX: -12, minZ: -25.5, maxZ: -10.5 },
    fog: true,
    floor: "#16111e",
    cam: { pos: [-22, 20, -10], target: [-22, 0, -18] },
  },
];

export const roomById = (id: RoomId) => ROOMS.find((room) => room.id === id)!;

export function roomAt(x: number, z: number): RoomId {
  for (const room of ROOMS) {
    if (room.id === "outside") continue;
    const bounds = room.bounds;
    if (
      x >= bounds.minX &&
      x <= bounds.maxX &&
      z >= bounds.minZ &&
      z <= bounds.maxZ
    )
      return room.id;
  }
  return "outside";
}

/* ------------------------------------------------------------------- walls */

export interface Opening {
  at: number;
  width: number;
  height?: number;
}

export interface WallDef {
  id: string;
  axis: "x" | "z";
  fixed: number;
  from: number;
  to: number;
  openings?: Opening[];
  height?: number;
  cutaway?: boolean;
  color?: string;
}

const OUT = "#c9bac8";
const IN = "#e7dde4";

export const WALLS: WallDef[] = [
  {
    id: "w-north",
    axis: "x",
    fixed: -10.5,
    from: -33.225,
    to: 33.225,
    color: OUT,
    openings: [{ at: 22.5, width: 5.4, height: 2.9 }, { at: 0, width: 3.6, height: 2.9 }, { at: -22.5, width: 2.4, height: 2.4 }],
  },
  { id: "w-west", axis: "z", fixed: -33, from: -10.725, to: 10.725, color: OUT },
  { id: "w-east", axis: "z", fixed: 33, from: -10.725, to: 10.725, color: OUT },
  {
    id: "w-south-w",
    axis: "x",
    fixed: 10.5,
    from: -33.225,
    to: -4.5,
    color: OUT,
    cutaway: true,
  },
  {
    id: "w-south-e",
    axis: "x",
    fixed: 10.5,
    from: 4.5,
    to: 33.225,
    color: OUT,
    cutaway: true,
  },
  { id: "w-entry-w", axis: "z", fixed: -4.5, from: 10.5, to: 15.975, color: OUT },
  { id: "w-entry-e", axis: "z", fixed: 4.5, from: 10.5, to: 15.975, color: OUT },
  {
    id: "w-entry-s",
    axis: "x",
    fixed: 15.75,
    from: -4.725,
    to: 4.725,
    height: 3.2,
    color: OUT,
    openings: [{ at: 0, width: 4.5, height: 2.6 }],
  },
  { id: "w-annex-w", axis: "z", fixed: 19.5, from: -15.225, to: -10.5, color: OUT },
  { id: "w-annex-e", axis: "z", fixed: 25.5, from: -15.225, to: -10.5, color: OUT },
  { id: "w-annex-n", axis: "x", fixed: -15, from: 19.275, to: 25.725, color: OUT },
  {
    id: "w-sec-e",
    axis: "z",
    fixed: -12,
    from: -10.5,
    to: 10.5,
    color: IN,
    openings: [{ at: 3.75, width: 2.4, height: 2.4 }],
  },
  {
    id: "w-lobby-w",
    axis: "z",
    fixed: -8.25,
    from: -10.5,
    to: 10.5,
    color: IN,
    openings: [{ at: 3.75, width: 2.4, height: 2.4 }],
  },
  {
    id: "w-lobby-e",
    axis: "z",
    fixed: 8.25,
    from: -10.5,
    to: 10.5,
    color: IN,
    openings: [{ at: 3.75, width: 2.4, height: 2.4 }],
  },
  {
    id: "w-vault-w",
    axis: "z",
    fixed: 12,
    from: -10.5,
    to: 10.5,
    color: IN,
    openings: [{ at: 3.75, width: 2.4, height: 2.4 }],
  },
  { id: "w-lib-n", axis: "x", fixed: -25.5, from: -8.25, to: 8.25, color: OUT },
  { id: "w-lib-w", axis: "z", fixed: -8.25, from: -25.5, to: -10.5, color: IN, openings: [{ at: 3.75, width: 2.4, height: 2.4 }] },
  { id: "w-lib-e", axis: "z", fixed: 8.25, from: -25.5, to: -10.5, color: OUT },
  { id: "w-server-n", axis: "x", fixed: -25.5, from: -33, to: -12, color: OUT },
  { id: "w-server-w", axis: "z", fixed: -33, from: -25.5, to: -10.5, color: OUT },
];

export const MASSES: { x1: number; z1: number; x2: number; z2: number }[] = [
  { x1: -12, z1: -10.725, x2: -8.25, z2: 1.5 },
  { x1: -12, z1: 6, x2: -8.25, z2: 10.725 },
  { x1: 8.25, z1: -10.725, x2: 12, z2: 1.5 },
  { x1: 8.25, z1: 6, x2: 12, z2: 10.725 },
  { x1: -12, z1: -25.5, x2: -8.25, z2: -10.5 },
  { x1: 8.25, z1: -25.5, x2: 12, z2: -10.5 },
];

export const SLABS: {
  id: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  color: string;
  ceiling?: boolean;
}[] = [
  { id: "main", x1: -33.225, z1: -10.725, x2: 33.225, z2: 10.725, color: "#d2c8d8", ceiling: true },
  { id: "entry", x1: -4.725, z1: 10.725, x2: 4.725, z2: 15.975, color: "#cfc3d2", ceiling: true },
  { id: "annex", x1: 19.275, z1: -15.225, x2: 25.725, z2: -10.5, color: "#b5aab9", ceiling: true },
  { id: "library", x1: -8.25, z1: -25.5, x2: 8.25, z2: -10.5, color: "#e2d8e8", ceiling: true },
  { id: "server", x1: -33, z1: -25.5, x2: -12, z2: -10.5, color: "#b0a5b6", ceiling: true },
];

/* ------------------------------------------------------------------- doors */

export interface DoorDef {
  id: string;
  label: string;
  room: RoomId;
  at: Vec3;
  axis: "x" | "z";
  width: number;
  height: number;
  color: string;
  swing: 1 | -1;
}

export const DOORS: DoorDef[] = [
  {
    id: "door-library",
    label: "Library access door",
    room: "lobby",
    at: [0, 0, -10.5],
    axis: "x",
    width: 3.6,
    height: 2.9,
    color: "#a8a2b2",
    swing: -1,
  },
  {
    id: "door-server",
    label: "Server room access",
    room: "sec",
    at: [-22.5, 0, -10.5],
    axis: "x",
    width: 2.4,
    height: 2.4,
    color: "#5f6670",
    swing: -1,
  },
  {
    id: "door-utility",
    label: "Utility access door",
    room: "wcorr",
    at: [-12, 0, 3.75],
    axis: "z",
    width: 2.4,
    height: 2.4,
    color: "#38bdf8",
    swing: 1,
  },
  {
    id: "door-dorm",
    label: "Dorm wing access door",
    room: "ecorr",
    at: [8.25, 0, 3.75],
    axis: "z",
    width: 2.4,
    height: 2.4,
    color: "#facc15",
    swing: -1,
  },
];

/** Physical scenario props. The player must read the environment, not chase HUD markers. */
export const SCENARIO_OBJECTS: ScenarioObjectDef[] = [
  {
    id: "emergency-backpack",
    kind: "pickup",
    room: "entry",
    label: "Emergency backpack",
    sub: "grab it before entering the block",
    position: [2.325, 0.3, 12.975],
    color: "#38bdf8",
    radius: 1.55,
  },
  {
    id: "lab-access-card",
    kind: "pickup",
    room: "sec",
    label: "Lab access card",
    sub: "opens the marked exit",
    position: [-14.475, 0.98, 3.825],
    color: "#facc15",
    radius: 1.5,
  },
  {
    id: "gas-valve",
    kind: "valve",
    room: "sec",
    label: "Gas isolation valve",
    sub: "close the valve before crossing the lab",
    position: [-29.175, 1.12, -6.525],
    color: "#ef4444",
    radius: 1.55,
  },
  {
    id: "first-aid-kit",
    kind: "pickup",
    room: "sec",
    label: "First-aid kit",
    sub: "use on pickup / one charge",
    position: [-30.75, 1.05, 7.125],
    color: "#fb7185",
    radius: 1.4,
  },
  {
    id: "lab-safety-clue",
    kind: "clue",
    room: "sec",
    label: "Lab safety clue",
    sub: "decode the marked west route",
    position: [-20.55, 1.12, -2.7],
    color: "#10b981",
    radius: 1.35,
  },
  {
    id: "academic-guide",
    kind: "clue",
    room: "vault",
    label: "Emergency route guide",
    sub: "compare the classroom map with the signs",
    position: [18.3, 0.8, 1.875],
    color: "#a78bfa",
    radius: 1.35,
  },
  {
    id: "main-exit",
    kind: "exit",
    room: "entry",
    label: "Marked exit",
    sub: "all critical steps must be complete",
    position: [0, 1.15, 15.3],
    color: "#39ff88",
    radius: 1.6,
  },
];

export const scenarioObjectById = (id: ScenarioObjectId) =>
  SCENARIO_OBJECTS.find((item) => item.id === id)!;

export const CRITICAL_SCENARIO_OBJECTS: ScenarioObjectId[] = [
  "emergency-backpack",
  "lab-access-card",
  "gas-valve",
  "first-aid-kit",
  "lab-safety-clue",
  "academic-guide",
];

export const newScenarioProgress = (): ScenarioProgress => ({
  "emergency-backpack": false,
  "lab-access-card": false,
  "gas-valve": false,
  "first-aid-kit": false,
  "lab-safety-clue": false,
  "academic-guide": false,
  "main-exit": false,
});

export const scenarioReady = (progress: ScenarioProgress) =>
  CRITICAL_SCENARIO_OBJECTS.every((id) => progress[id]);

export interface ScenarioGuidance {
  id: ScenarioObjectId | "complete";
  label: string;
  room: RoomId;
  instruction: string;
  color: string;
}

/** One actionable instruction at a time; the evacuee should never need to parse the whole checklist. */
export function nextScenarioGuidance(progress: ScenarioProgress): ScenarioGuidance {
  const id = CRITICAL_SCENARIO_OBJECTS.find((item) => !progress[item]);
  if (id === "emergency-backpack") return { id, label: "Emergency backpack", room: "entry", instruction: "Pick up the emergency backpack on the floor beside the bench, just inside the entrance.", color: "#38bdf8" };
  if (id === "lab-access-card") return { id, label: "Lab access card", room: "sec", instruction: "Walk into the corridor and take the west door marked SCIENCE BLOCK. The yellow card is on the desk beside that door.", color: "#facc15" };
  if (id === "gas-valve") return { id, label: "Gas isolation valve", room: "sec", instruction: "In Chemistry Lab 1A, go to the back-left corner. Close the red valve under the GAS SHUT-OFF sign.", color: "#ef4444" };
  if (id === "first-aid-kit") return { id, label: "First-aid kit", room: "sec", instruction: "Find the white first-aid kit on the small table under the green FIRST AID sign, next to the window.", color: "#fb7185" };
  if (id === "lab-safety-clue") return { id, label: "Lab safety clue", room: "sec", instruction: "Read the green safety note on the long lab bench in the middle of the room.", color: "#10b981" };
  if (id === "academic-guide") return { id, label: "Academic route guide", room: "vault", instruction: "Cross the corridor to the east door marked ACADEMIC BLOCK. The purple route guide is on the desk nearest the door in Classroom A201.", color: "#a78bfa" };
  return { id: "main-exit", label: "Marked exit", room: "entry", instruction: "All steps done. Go back to the corridor, walk south to the entrance and use the green EXIT doors.", color: "#39ff88" };
}

/** Threats are deliberately only rendered in the warden's view. */
export const SPECTATOR_THREATS = [
  {
    id: "gas-cloud",
    room: "sec" as RoomId,
    position: [-29.175, 1.35, -6.525] as Vec3,
    label: "UNSEEN GAS LEAK",
    sub: "evacuee has no direct visual confirmation",
    color: "#ef4444",
  },
  {
    id: "east-structural-risk",
    room: "ecorr" as RoomId,
    position: [8.43, 1.65, 3.75] as Vec3,
    label: "STRUCTURAL RISK",
    sub: "route becomes unsafe after the event escalates",
    color: "#facc15",
  },
] as const;

/* --------------------------------------------------------------- evidence */

export type Reveal = "warden" | "evidence";
export type MarkerKind = "evidence" | "intervention" | "route";

export interface MarkerDef {
  id: string;
  kind: MarkerKind;
  label: string;
  sub?: string;
  reveal: Reveal;
  room: RoomId;
  color: string;
  position: Vec3;
  labelOffset?: Vec3;
  rotationY?: number;
  source?: string;
  nextAction?: string;
}

export const C = {
  red: "#ef4444",
  yellow: "#facc15",
  blue: "#38bdf8",
  green: "#10b981",
  slate: "#334155",
};

/** Stable IDs are shared by the local fixtures, AppSync payloads, and renderer. */
export const MARKERS: MarkerDef[] = [
  {
    id: "east-route-evidence",
    kind: "evidence",
    label: "East route sensor",
    sub: "observed route block",
    reveal: "evidence",
    room: "sec",
    color: C.red,
    position: [-16.8, 1.3, 0.3],
    labelOffset: [0, 0.75, 0],
    source: "Utility sector sensor feed",
    nextAction: "Verify before sending route guidance.",
  },
  {
    id: "smoke-source-evidence",
    kind: "evidence",
    label: "Smoke source reading",
    sub: "observed 8 seconds ago",
    reveal: "evidence",
    room: "sec",
    color: C.yellow,
    position: [-28.5, 1.1, -6],
    labelOffset: [0, 0.75, 0],
    source: "Electrical service monitor",
    nextAction: "Compare the source with the route status.",
  },
  {
    id: "ventilation-panel",
    kind: "intervention",
    label: "Ventilation panel",
    sub: "one authorized intervention",
    reveal: "warden",
    room: "sec",
    color: C.blue,
    position: [-18.3, 2, -10.2],
    labelOffset: [0, 0.85, 0],
    source: "Utility control panel",
    nextAction: "Apply only after the route evidence is verified.",
  },
  {
    id: "west-route-sign",
    kind: "route",
    label: "WEST STAIR -> FOYER",
    sub: "green return route to the marked exit",
    reveal: "warden",
    room: "lobby",
    color: C.green,
    position: [-3.3, 2.5, 10.05],
    labelOffset: [0, 0.7, 0],
    source: "Physical route signage",
    nextAction: "Send the west route when the block is verified.",
  },
];

export const EVACUEE_SPAWN: Vec3 = [0, 1.1, 20];
export const ASSEMBLY_Z = 13.5;

/** Low sunset sun, behind the block to the north-east. Shared by the sky, key light and environment. */
export const SUN_DIRECTION: Vec3 = [0.5, 0.2, -0.84];

export function isRevealed(
  reveal: Reveal,
  view: string,
  observed: boolean,
): boolean {
  if (view === "evacuee") return false;
  if (reveal === "warden") return true;
  return view === "evidence" || observed;
}
