export type Point = [number, number];

/* The compact authored block. IDs are stable across render, collision, and events. */
export type RoomId =
  | "outside"
  | "entry"
  | "lobby"
  | "wcorr"
  | "ecorr"
  | "sec"
  | "vault"
  | "annex";

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
  position: Point;
  color: string;
  radius: number;
}

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
    bounds: { minX: -14, maxX: 14, minZ: 10.5, maxZ: 26 },
  },
  {
    id: "entry",
    name: "Main Entrance",
    blurb: "Notice wall and orientation point for the drill.",
    bounds: { minX: -3, maxX: 3, minZ: 7, maxZ: 10.5 },
  },
  {
    id: "lobby",
    name: "Central Corridor",
    blurb: "Primary route decision between the west and east stairs.",
    bounds: { minX: -5.5, maxX: 5.5, minZ: -7, maxZ: 7 },
  },
  {
    id: "wcorr",
    name: "Science Block / Passage",
    blurb: "Candidate route to the outdoor assembly point.",
    bounds: { minX: -8, maxX: -5.5, minZ: 1, maxZ: 4 },
  },
  {
    id: "ecorr",
    name: "Academic Block / Passage",
    blurb: "Route edge that becomes unsafe during the scenario.",
    bounds: { minX: 5.5, maxX: 8, minZ: 1, maxZ: 4 },
  },
  {
    id: "sec",
    name: "Science Block / Chemistry Lab 1A",
    blurb: "Gas control, safety equipment, and the west exit route.",
    bounds: { minX: -22, maxX: -8, minZ: -7, maxZ: 7 },
  },
  {
    id: "vault",
    name: "Academic Block / Classroom A201",
    blurb: "Emergency guide, classroom clues, and the east route.",
    bounds: { minX: 8, maxX: 22, minZ: -7, maxZ: 7 },
  },
  {
    id: "annex",
    name: "Academic Block / Electrical Service",
    blurb: "Authored smoke origin and recovery route.",
    bounds: { minX: 13, maxX: 17, minZ: -10, maxZ: -7 },
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
}

export interface WallDef {
  id: string;
  axis: "x" | "z";
  fixed: number;
  from: number;
  to: number;
  openings?: Opening[];
  color?: string;
}

const OUT = "#c9bac8";
const IN = "#e7dde4";

export const WALLS: WallDef[] = [
  {
    id: "w-north",
    axis: "x",
    fixed: -7,
    from: -22.15,
    to: 22.15,
    color: OUT,
    openings: [{ at: 15, width: 3.6 }],
  },
  { id: "w-west", axis: "z", fixed: -22, from: -7.15, to: 7.15, color: OUT },
  { id: "w-east", axis: "z", fixed: 22, from: -7.15, to: 7.15, color: OUT },
  {
    id: "w-south-w",
    axis: "x",
    fixed: 7,
    from: -22.15,
    to: -3,
    color: OUT,
  },
  {
    id: "w-south-e",
    axis: "x",
    fixed: 7,
    from: 3,
    to: 22.15,
    color: OUT,
  },
  { id: "w-entry-w", axis: "z", fixed: -3, from: 7, to: 10.65, color: OUT },
  { id: "w-entry-e", axis: "z", fixed: 3, from: 7, to: 10.65, color: OUT },
  {
    id: "w-entry-s",
    axis: "x",
    fixed: 10.5,
    from: -3.15,
    to: 3.15,
    color: OUT,
    openings: [{ at: 0, width: 3 }],
  },
  { id: "w-annex-w", axis: "z", fixed: 13, from: -10.15, to: -7, color: OUT },
  { id: "w-annex-e", axis: "z", fixed: 17, from: -10.15, to: -7, color: OUT },
  { id: "w-annex-n", axis: "x", fixed: -10, from: 12.85, to: 17.15, color: OUT },
  {
    id: "w-sec-e",
    axis: "z",
    fixed: -8,
    from: -7,
    to: 7,
    color: IN,
    openings: [{ at: 2.5, width: 1.6 }],
  },
  {
    id: "w-lobby-w",
    axis: "z",
    fixed: -5.5,
    from: -7,
    to: 7,
    color: IN,
    openings: [{ at: 2.5, width: 1.6 }],
  },
  {
    id: "w-lobby-e",
    axis: "z",
    fixed: 5.5,
    from: -7,
    to: 7,
    color: IN,
    openings: [{ at: 2.5, width: 1.6 }],
  },
  {
    id: "w-vault-w",
    axis: "z",
    fixed: 8,
    from: -7,
    to: 7,
    color: IN,
    openings: [{ at: 2.5, width: 1.6 }],
  },
];

export const MASSES: { x1: number; z1: number; x2: number; z2: number }[] = [
  { x1: -8, z1: -7.15, x2: -5.5, z2: 1 },
  { x1: -8, z1: 4, x2: -5.5, z2: 7.15 },
  { x1: 5.5, z1: -7.15, x2: 8, z2: 1 },
  { x1: 5.5, z1: 4, x2: 8, z2: 7.15 },
];

/* ------------------------------------------------------------------- doors */

export interface DoorDef {
  id: string;
  label: string;
  room: RoomId;
  at: Point;
  axis: "x" | "z";
  width: number;
  color: string;
}

export const DOORS: DoorDef[] = [
  {
    id: "door-utility",
    label: "Utility access door",
    room: "wcorr",
    at: [-8, 2.5],
    axis: "z",
    width: 1.6,
    color: "#38bdf8",
  },
  {
    id: "door-dorm",
    label: "Dorm wing access door",
    room: "ecorr",
    at: [5.5, 2.5],
    axis: "z",
    width: 1.6,
    color: "#facc15",
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
    position: [1.55, 8.65],
    color: "#38bdf8",
    radius: 1.55,
  },
  {
    id: "lab-access-card",
    kind: "pickup",
    room: "sec",
    label: "Lab access card",
    sub: "opens the marked exit",
    position: [-9.65, 2.55],
    color: "#facc15",
    radius: 1.5,
  },
  {
    id: "gas-valve",
    kind: "valve",
    room: "sec",
    label: "Gas isolation valve",
    sub: "close the valve before crossing the lab",
    position: [-19.45, -4.35],
    color: "#ef4444",
    radius: 1.55,
  },
  {
    id: "first-aid-kit",
    kind: "pickup",
    room: "sec",
    label: "First-aid kit",
    sub: "use on pickup / one charge",
    position: [-20.5, 4.75],
    color: "#fb7185",
    radius: 1.4,
  },
  {
    id: "lab-safety-clue",
    kind: "clue",
    room: "sec",
    label: "Lab safety clue",
    sub: "decode the marked west route",
    position: [-13.7, -1.8],
    color: "#10b981",
    radius: 1.35,
  },
  {
    id: "academic-guide",
    kind: "clue",
    room: "vault",
    label: "Emergency route guide",
    sub: "compare the classroom map with the signs",
    position: [12.2, 1.25],
    color: "#a78bfa",
    radius: 1.35,
  },
  {
    id: "main-exit",
    kind: "exit",
    room: "entry",
    label: "Marked exit",
    sub: "all critical steps must be complete",
    position: [0, 10.2],
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
    position: [-19.45, -4.35] as Point,
    label: "UNSEEN GAS LEAK",
    sub: "evacuee has no direct visual confirmation",
    color: "#ef4444",
  },
  {
    id: "east-structural-risk",
    room: "ecorr" as RoomId,
    position: [5.62, 2.5] as Point,
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
  position: Point;
  labelOffset?: Point;
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
    position: [-11.2, 0.2],
    labelOffset: [0, 0.75],
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
    position: [-19, -4],
    labelOffset: [0, 0.75],
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
    position: [-12.2, -6.8],
    labelOffset: [0, 0.85],
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
    position: [-2.2, 6.7],
    labelOffset: [0, 0.7],
    source: "Physical route signage",
    nextAction: "Send the west route when the block is verified.",
  },
];

export const EVACUEE_SPAWN: Point = [0, 9];
export const ASSEMBLY_Z = 13.5;

export function isRevealed(
  reveal: Reveal,
  view: string,
  observed: boolean,
): boolean {
  if (view === "evacuee") return false;
  if (reveal === "warden") return true;
  return view === "evidence" || observed;
}
