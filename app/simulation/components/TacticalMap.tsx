"use client";

import { useEffect, useState } from "react";
import {
  ASSEMBLY_Z,
  DOORS,
  MARKERS,
  MASSES,
  ROOMS,
  SCENARIO_OBJECTS,
  SPECTATOR_THREATS,
  WALLS,
  nextScenarioGuidance,
  roomById,
  type RoomDef,
  type RoomId,
  type Point,
  type WallDef,
} from "../level";
import { BLOCKED_ROUTE } from "../smoke";
import { runtime } from "../runtime";
import { useSimulation } from "../store";

type Position = { x: number; z: number; yaw: number };

const EXTENTS = ROOMS.reduce(
  (result, room) => ({
    minX: Math.min(result.minX, room.bounds.minX),
    maxX: Math.max(result.maxX, room.bounds.maxX),
    minZ: Math.min(result.minZ, room.bounds.minZ),
    maxZ: Math.max(result.maxZ, room.bounds.maxZ),
  }),
  { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
);

const VIEW = {
  minX: EXTENTS.minX - 1,
  minZ: EXTENTS.minZ - 1,
  width: EXTENTS.maxX - EXTENTS.minX + 2,
  height: EXTENTS.maxZ - EXTENTS.minZ + 2,
};

const EPSILON = 0.08;

function roomCenter(room: RoomDef): Point {
  return [(room.bounds.minX + room.bounds.maxX) / 2, (room.bounds.minZ + room.bounds.maxZ) / 2];
}

function overlap(a1: number, a2: number, b1: number, b2: number) {
  return Math.min(a2, b2) - Math.max(a1, b1);
}

/** Returns the actual shared doorway edge between two authored room bounds. */
function sharedBoundary(a: RoomDef, b: RoomDef): Point | null {
  const ab = a.bounds;
  const bb = b.bounds;
  if (Math.abs(ab.maxX - bb.minX) < EPSILON) {
    const length = overlap(ab.minZ, ab.maxZ, bb.minZ, bb.maxZ);
    if (length > EPSILON) return [ab.maxX, Math.max(ab.minZ, bb.minZ) + length / 2];
  }
  if (Math.abs(ab.minX - bb.maxX) < EPSILON) {
    const length = overlap(ab.minZ, ab.maxZ, bb.minZ, bb.maxZ);
    if (length > EPSILON) return [ab.minX, Math.max(ab.minZ, bb.minZ) + length / 2];
  }
  if (Math.abs(ab.maxZ - bb.minZ) < EPSILON) {
    const length = overlap(ab.minX, ab.maxX, bb.minX, bb.maxX);
    if (length > EPSILON) return [Math.max(ab.minX, bb.minX) + length / 2, ab.maxZ];
  }
  if (Math.abs(ab.minZ - bb.maxZ) < EPSILON) {
    const length = overlap(ab.minX, ab.maxX, bb.minX, bb.maxX);
    if (length > EPSILON) return [Math.max(ab.minX, bb.minX) + length / 2, ab.minZ];
  }
  return null;
}

function neighbors(room: RoomDef) {
  return ROOMS.filter((candidate) => candidate.id !== room.id && sharedBoundary(room, candidate));
}

/** Find a route through touching authored rooms. No visual-only waypoint data is introduced. */
function roomPath(from: RoomId, to: RoomId): RoomDef[] {
  if (from === to) return [roomById(from)];
  const queue: RoomDef[][] = [[roomById(from)]];
  const visited = new Set<RoomId>([from]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    const last = path.at(-1)!;
    for (const next of neighbors(last)) {
      if (visited.has(next.id)) continue;
      const nextPath = [...path, next];
      if (next.id === to) return nextPath;
      visited.add(next.id);
      queue.push(nextPath);
    }
  }
  return [roomById(from), roomById(to)];
}

function pathPoints(rooms: RoomDef[], start: Point, end: Point): Point[] {
  if (rooms.length === 1) return [start, end];
  const points: Point[] = [start];
  for (let index = 0; index < rooms.length - 1; index += 1) {
    const boundary = sharedBoundary(rooms[index], rooms[index + 1]);
    if (boundary) points.push(boundary);
    if (index < rooms.length - 2) points.push(roomCenter(rooms[index + 1]));
  }
  points.push(end);
  return points;
}

function wallSegments(def: WallDef): [number, number, number, number][] {
  const segments: [number, number, number, number][] = [];
  const openings = [...(def.openings ?? [])].sort((a, b) => a.at - b.at);
  let cursor = def.from;
  for (const opening of openings) {
    const start = opening.at - opening.width / 2;
    if (start > cursor) {
      segments.push(
        def.axis === "x" ? [cursor, def.fixed, start, def.fixed] : [def.fixed, cursor, def.fixed, start],
      );
    }
    cursor = opening.at + opening.width / 2;
  }
  if (cursor < def.to) {
    segments.push(
      def.axis === "x" ? [cursor, def.fixed, def.to, def.fixed] : [def.fixed, cursor, def.fixed, def.to],
    );
  }
  return segments;
}

function pointsAttribute(points: Point[]) {
  return points.map(([x, z]) => `${x},${z}`).join(" ");
}

function markerPosition(position: Point): Point {
  return position;
}

function roomFill(room: RoomDef, current: boolean, assigned: boolean) {
  if (room.id === "outside") return "url(#ce-outside-tile)";
  if (current) return "url(#ce-current-tile)";
  if (assigned) return "url(#ce-assigned-tile)";
  if (room.id === "sec") return "url(#ce-science-tile)";
  if (room.id === "vault" || room.id === "annex") return "url(#ce-academic-tile)";
  return "url(#ce-floor-tile)";
}

function roomCode(room: RoomDef) {
  return {
    outside: "ASM",
    entry: "ENT",
    lobby: "HUB",
    wcorr: "W",
    ecorr: "E",
    sec: "LAB 1A",
    vault: "A201",
    annex: "UTIL",
  }[room.id];
}

const ROOM_LABELS: Record<RoomId, [string, string]> = {
    outside: ["PLAZA", "ASSEMBLY"],
    entry: ["MAIN", "ENTRANCE"],
    lobby: ["CENTRAL", "CORRIDOR"],
    wcorr: ["SCIENCE", "PASSAGE"],
    ecorr: ["ACADEMIC", "PASSAGE"],
    sec: ["CHEMISTRY", "LAB 1A"],
    vault: ["CLASSROOM", "A201"],
    annex: ["ELECTRICAL", "SERVICE"],
};

function roomLabelLines(room: RoomDef): [string, string] {
  return ROOM_LABELS[room.id];
}

function RoomFurniture({ room }: { room: RoomDef }) {
  const { minX, maxX, minZ, maxZ } = room.bounds;
  if (room.id === "sec") {
    const stations = [minX + 1.4, minX + 5.8, minX + 10.2];
    return (
      <g opacity="0.88" aria-hidden>
        {stations.map((x) => (
          <g key={x}>
            <rect x={x} y={minZ + 2.2} width="3.4" height="0.72" fill="#9aaeba" stroke="#536d80" strokeWidth="0.12" />
            <rect x={x + 0.42} y={minZ + 1.48} width="0.8" height="0.58" fill="#6f8797" stroke="#284a66" strokeWidth="0.1" />
            <rect x={x + 2.18} y={minZ + 1.52} width="0.58" height="0.42" fill="#77b8d8" stroke="#284a66" strokeWidth="0.1" />
          </g>
        ))}
        <rect x={minX + 1.1} y={maxZ - 1.7} width={maxX - minX - 2.2} height="0.55" fill="#8ea5b1" stroke="#536d80" strokeWidth="0.12" />
        <rect x={minX + 2.4} y={maxZ - 1.13} width="0.8" height="0.44" fill="#d49a36" />
        <rect x={maxX - 3.1} y={maxZ - 1.13} width="0.8" height="0.44" fill="#c54243" />
      </g>
    );
  }
  if (room.id === "vault") {
    const desks = [minX + 1.3, minX + 4.9, minX + 8.5, minX + 11.1];
    return (
      <g opacity="0.88" aria-hidden>
        {desks.map((x) => (
          <g key={x}>
            <rect x={x} y={minZ + 2.1} width="2.1" height="0.62" fill="#bdad8c" stroke="#7b6d52" strokeWidth="0.1" />
            <rect x={x + 0.72} y={minZ + 1.48} width="0.62" height="0.5" fill="#6d7f8d" stroke="#284a66" strokeWidth="0.1" />
          </g>
        ))}
        <rect x={minX + 1} y={maxZ - 1.35} width={maxX - minX - 2} height="0.52" fill="#bdad8c" stroke="#7b6d52" strokeWidth="0.1" />
        <rect x={minX + 1.5} y={maxZ - 2.05} width="1.1" height="0.42" fill="#a78bfa" stroke="#284a66" strokeWidth="0.1" />
      </g>
    );
  }
  if (room.id === "lobby") {
    return (
      <g opacity="0.88" aria-hidden>
        <rect x={-1.35} y={-0.25} width="2.7" height="1.65" fill="#8c969f" stroke="#536d80" strokeWidth="0.14" />
        <rect x={-0.74} y={-0.88} width="1.48" height="0.58" fill="#adb7bd" stroke="#536d80" strokeWidth="0.1" />
        <rect x={minX + 1.1} y={maxZ - 2.1} width="2.8" height="0.48" fill="#987d62" stroke="#536d80" strokeWidth="0.1" />
        <rect x={maxX - 3.9} y={maxZ - 2.1} width="2.8" height="0.48" fill="#987d62" stroke="#536d80" strokeWidth="0.1" />
      </g>
    );
  }
  if (room.id === "entry") {
    return (
      <g opacity="0.9" aria-hidden>
        <rect x={minX + 0.55} y={minZ + 0.75} width={maxX - minX - 1.1} height="0.62" fill="#987d62" stroke="#536d80" strokeWidth="0.12" />
        <rect x={minX + 1.15} y={minZ + 1.5} width="0.64" height="0.42" fill="#77b8d8" stroke="#284a66" strokeWidth="0.1" />
        <rect x={maxX - 1.8} y={minZ + 1.5} width="0.64" height="0.42" fill="#77b8d8" stroke="#284a66" strokeWidth="0.1" />
      </g>
    );
  }
  if (room.id === "annex") {
    return (
      <g opacity="0.9" aria-hidden>
        <rect x={minX + 0.4} y={minZ + 0.6} width={maxX - minX - 0.8} height="0.62" fill="#5d6872" stroke="#284a66" strokeWidth="0.12" />
        <rect x={minX + 0.8} y={minZ + 1.45} width="0.72" height="0.52" fill="#c54243" />
        <rect x={minX + 2.1} y={minZ + 1.45} width="0.72" height="0.52" fill="#d49a36" />
      </g>
    );
  }
  return null;
}

const TREE_POSITIONS: Point[] = [
  [-20, 15], [-16, 21], [-9, 23], [9, 23], [16, 21], [20, 15],
  [-20, 10.8], [20, 10.8], [-13, 18.5], [13, 18.5],
];

function CampusTrees() {
  return (
    <g aria-hidden>
      {TREE_POSITIONS.map(([x, z]) => (
        <g key={`${x}-${z}`} transform={`translate(${x} ${z})`}>
          <rect x="-0.22" y="0.22" width="0.44" height="0.82" fill="#76563e" stroke="#284a66" strokeWidth="0.08" />
          <rect x="-0.72" y="-0.72" width="1.44" height="0.8" fill="#236b4b" stroke="#1b4b3d" strokeWidth="0.1" />
          <rect x="-0.48" y="-1.08" width="0.96" height="0.55" fill="#31a35e" stroke="#1b4b3d" strokeWidth="0.1" />
          <rect x="-0.22" y="-1.34" width="0.44" height="0.32" fill="#73cc64" />
        </g>
      ))}
    </g>
  );
}

function PlayerMarker({ position, label, color }: { position: Position; label: string; color: string }) {
  const [x, z] = [position.x, position.z];
  return (
    <g transform={`translate(${x} ${z}) rotate(${(-position.yaw * 180) / Math.PI})`} aria-label={label}>
      <rect x={-0.56} y={0.34} width="1.12" height="0.2" fill="#13213c" opacity="0.45" />
      <rect x={-0.42} y={-0.16} width="0.84" height="0.72" fill={color} stroke="#13213c" strokeWidth="0.14" />
      <rect x={-0.3} y={-0.72} width="0.6" height="0.56" fill="#d09b70" stroke="#13213c" strokeWidth="0.14" />
      <rect x={-0.34} y={-0.84} width="0.68" height="0.18" fill="#2a1d2b" stroke="#13213c" strokeWidth="0.1" />
      <rect x={-0.58} y={-0.03} width="0.16" height="0.44" fill="#f7fbfd" stroke="#13213c" strokeWidth="0.08" />
      <path d="M 0 -1.08 L 0.22 -0.82 L 0 -0.82 Z" fill="#f7fbfd" stroke="#13213c" strokeWidth="0.08" />
      <text x={0} y={1.2} textAnchor="middle" fontSize="0.66" fontWeight="900" fill="#13213c" stroke="#f7fbfd" strokeWidth="0.12" paintOrder="stroke">
        {label}
      </text>
    </g>
  );
}

function ExitMarker({ position, label, color = "#159b60" }: { position: Point; label: string; color?: string }) {
  return (
    <g transform={`translate(${position[0]} ${position[1]})`} aria-label={label}>
      <rect x={-1.1} y={-0.62} width={2.2} height={1.24} fill={color} stroke="#10213c" strokeWidth={0.16} />
      <path d="M -0.62 0 L 0.15 0 M -0.14 -0.28 L 0.18 0 L -0.14 0.28" stroke="#f7fbfd" strokeWidth={0.14} fill="none" />
      <text x={0.1} y={0.24} textAnchor="middle" fontSize="0.38" fontWeight="900" fill="#f7fbfd">{label}</text>
    </g>
  );
}

export default function TacticalMap() {
  const mode = useSimulation((state) => state.mode);
  const view = useSimulation((state) => state.view);
  const sector = useSimulation((state) => state.sector);
  const progress = useSimulation((state) => state.scenarioProgress);
  const routeStatus = useSimulation((state) => state.routeStatus);
  const smokeIntensity = useSimulation((state) => state.smokeIntensity);
  const latestMessage = useSimulation((state) => state.latestMessage);
  const evidence = useSimulation((state) => state.evidence);
  const [now, setNow] = useState(() => Date.now());
  const [remoteReady, setRemoteReady] = useState(() => mode.kind !== "warden");
  const [position, setPosition] = useState<Position>(() => ({ x: runtime.evacuee.x, z: runtime.evacuee.z, yaw: runtime.evacueeYaw }));

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (time: number) => {
      raf = window.requestAnimationFrame(tick);
      if (time - last < 50) return;
      last = time;
      const available = mode.kind !== "warden" || runtime.netEvacuee !== null;
      setRemoteReady((previous) => previous === available ? previous : available);
      setPosition((previous) => {
        const remote = mode.kind === "warden" ? runtime.netEvacuee : null;
        const next = remote
          ? { x: remote.x, z: remote.z, yaw: remote.yaw }
          : { x: runtime.evacuee.x, z: runtime.evacuee.z, yaw: runtime.evacueeYaw };
        if (Math.abs(previous.x - next.x) < 0.01 && Math.abs(previous.z - next.z) < 0.01 && Math.abs(previous.yaw - next.yaw) < 0.01) return previous;
        return next;
      });
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [mode.kind]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const wardenView = mode.kind === "warden" || view === "evidence";
  const assignedSector = mode.kind === "warden" ? mode.sectorId : null;
  const showPlayerState = mode.kind !== "warden" || remoteReady;
  const guidance = nextScenarioGuidance(progress);
  const nextObject = SCENARIO_OBJECTS.find((item) => item.id === guidance.id);
  const messageActive = latestMessage !== null && latestMessage.expiresAt > now;
  const targetRoom = messageActive ? latestMessage.targetSector : guidance.room;
  const targetPoint = messageActive
    ? roomCenter(roomById(targetRoom))
    : nextObject
      ? markerPosition(nextObject.position)
      : markerPosition(SCENARIO_OBJECTS.find((item) => item.id === "main-exit")!.position);
  const targetPath = showPlayerState ? pathPoints(roomPath(sector, targetRoom), [position.x, position.z], targetPoint) : [];
  const blockedRooms = roomPath(BLOCKED_ROUTE.from, BLOCKED_ROUTE.to);
  const blockedPath = pathPoints(blockedRooms, roomCenter(roomById(BLOCKED_ROUTE.from)), roomCenter(roomById(BLOCKED_ROUTE.to)));
  const routeColor = latestMessage?.confidence === "verified" ? "#159b60" : routeStatus === "unsafe" ? "#d49a36" : "#159b60";

  return (
    <div className="ce-map-viewport ce-map-grid w-full">
      <div className="ce-map-header px-3 py-2">
        <div>
          <div className="ce-kicker text-[#b9d8e9]">Top-down tactical view</div>
          <div className="mt-0.5 text-xs font-black uppercase text-[#f7fbfd]">{roomById(sector).name}</div>
        </div>
        <span className={`ce-route-chip ${routeStatus === "unsafe" ? "ce-route-danger" : "ce-route-safe"}`}>
          <span aria-hidden>{routeStatus === "unsafe" ? "!" : "OK"}</span>
          {routeStatus}
        </span>
      </div>
      <svg
        viewBox={`${VIEW.minX} ${VIEW.minZ} ${VIEW.width} ${VIEW.height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Top-down campus floor plan with live evacuee position, route state, objectives, exits, and hazards"
      >
        <defs>
          <pattern id="ce-floor-tile" width="1" height="1" patternUnits="userSpaceOnUse">
            <rect width="1" height="1" fill="#cbd8df" />
            <path d="M 0 0 H 1 M 0 0 V 1" stroke="#9fb3bf" strokeWidth="0.06" opacity="0.7" />
          </pattern>
          <pattern id="ce-current-tile" width="1" height="1" patternUnits="userSpaceOnUse">
            <rect width="1" height="1" fill="#dceaf1" />
            <path d="M 0 0 H 1 M 0 0 V 1" stroke="#8dc7e6" strokeWidth="0.07" opacity="0.85" />
          </pattern>
          <pattern id="ce-assigned-tile" width="1" height="1" patternUnits="userSpaceOnUse">
            <rect width="1" height="1" fill="#d8e8f6" />
            <path d="M 0 0 H 1 M 0 0 V 1" stroke="#79a7c9" strokeWidth="0.07" opacity="0.85" />
          </pattern>
          <pattern id="ce-science-tile" width="1" height="1" patternUnits="userSpaceOnUse">
            <rect width="1" height="1" fill="#b8d1df" />
            <path d="M 0 0 H 1 M 0 0 V 1" stroke="#77a7be" strokeWidth="0.07" opacity="0.8" />
          </pattern>
          <pattern id="ce-academic-tile" width="1" height="1" patternUnits="userSpaceOnUse">
            <rect width="1" height="1" fill="#d9d5be" />
            <path d="M 0 0 H 1 M 0 0 V 1" stroke="#b7ab89" strokeWidth="0.07" opacity="0.72" />
          </pattern>
          <pattern id="ce-outside-tile" width="1" height="1" patternUnits="userSpaceOnUse">
            <rect width="1" height="1" fill="#a7c98b" />
            <path d="M 0 0 H 1 M 0 0 V 1" stroke="#6e9a63" strokeWidth="0.07" opacity="0.8" />
          </pattern>
          <pattern id="ce-smoke-tile" width="1.8" height="1.8" patternUnits="userSpaceOnUse">
            <rect width="1.8" height="1.8" fill="#5d606b" opacity="0.68" />
            <path d="M 0 0 H 1.8 M 0 0 V 1.8" stroke="#363b4a" strokeWidth="0.1" opacity="0.7" />
          </pattern>
        </defs>
        <rect x={VIEW.minX} y={VIEW.minZ} width={VIEW.width} height={VIEW.height} fill="#9fb3bf" />
        <rect x={ROOMS.find((room) => room.id === "outside")!.bounds.minX} y={ROOMS.find((room) => room.id === "outside")!.bounds.minZ} width={ROOMS.find((room) => room.id === "outside")!.bounds.maxX - ROOMS.find((room) => room.id === "outside")!.bounds.minX} height={ROOMS.find((room) => room.id === "outside")!.bounds.maxZ - ROOMS.find((room) => room.id === "outside")!.bounds.minZ} fill="url(#ce-outside-tile)" />
        <CampusTrees />

        {ROOMS.filter((room) => room.id !== "outside").map((room) => {
          const { minX, maxX, minZ, maxZ } = room.bounds;
          const current = showPlayerState && room.id === sector;
          const assigned = room.id === assignedSector;
          const hazard = (wardenView ? room.id === assignedSector : current) ? smokeIntensity : 0;
          const labelLines = roomLabelLines(room);
          const plaqueWidth = Math.min(maxX - minX - 0.7, Math.max(3.2, labelLines[0].length * 0.32 + 1.15));
          return (
            <g key={room.id}>
              <rect x={minX} y={minZ} width={maxX - minX} height={maxZ - minZ} fill={roomFill(room, current, assigned)} stroke={current ? "#d49a36" : assigned ? "#2871bd" : "#536d80"} strokeWidth={current || assigned ? 0.28 : 0.14} />
              <RoomFurniture room={room} />
              {hazard > 0.02 && <rect x={minX + 0.1} y={minZ + 0.1} width={maxX - minX - 0.2} height={maxZ - minZ - 0.2} fill="url(#ce-smoke-tile)" opacity={Math.min(0.82, hazard * 0.9)} />}
              <rect x={minX + 0.35} y={minZ + 0.35} width={plaqueWidth} height="1.58" fill="#f7fbfd" opacity="0.92" stroke="#536d80" strokeWidth="0.08" />
              <text x={minX + 0.62} y={minZ + 1.04} fontSize="0.47" fontWeight="900" fill="#13213c" letterSpacing="0.05em">
                {roomCode(room)}
              </text>
              <text x={minX + 0.62} y={minZ + 1.43} fontSize="0.4" fontWeight="900" fill="#284764" letterSpacing="0.02em">
                {labelLines[0]}
                <tspan x={minX + 0.62} dy="0.47">{labelLines[1]}</tspan>
              </text>
            </g>
          );
        })}

        {MASSES.map((mass, index) => (
          <rect key={`mass-${index}`} x={mass.x1} y={mass.z1} width={mass.x2 - mass.x1} height={mass.z2 - mass.z1} fill="#7e929e" opacity="0.85" stroke="#536d80" strokeWidth="0.12" />
        ))}

        {WALLS.flatMap((wall) => wallSegments(wall).map((segment, index) => (
           <line key={`${wall.id}-${index}`} x1={segment[0]} y1={segment[1]} x2={segment[2]} y2={segment[3]} stroke={wall.color === "#c9bac8" || wall.color === "#e7dde4" ? "#284a66" : wall.color ?? "#27445f"} strokeWidth="0.22" strokeLinecap="square" />
        )))}

        {DOORS.map((door) => (
          <g key={door.id} aria-label={door.label}>
             <line x1={door.at[0] - (door.axis === "x" ? door.width / 2 : 0)} y1={door.at[1] - (door.axis === "z" ? door.width / 2 : 0)} x2={door.at[0] + (door.axis === "x" ? door.width / 2 : 0)} y2={door.at[1] + (door.axis === "z" ? door.width / 2 : 0)} stroke={door.color} strokeWidth="0.32" />
          </g>
        ))}

        {showPlayerState && <polyline points={pointsAttribute(targetPath)} fill="none" stroke={routeColor} strokeWidth="0.46" strokeDasharray="0.7 0.48" strokeLinecap="square" strokeLinejoin="miter" opacity="0.92" />}
        {routeStatus === "unsafe" && <polyline points={pointsAttribute(blockedPath)} fill="none" stroke="#c54243" strokeWidth="0.62" strokeDasharray="0.9 0.32" strokeLinecap="square" opacity="0.98" />}

        {SCENARIO_OBJECTS.filter((object) => showPlayerState && !progress[object.id] && (wardenView || object.id === guidance.id)).map((object) => {
          const [x, z] = markerPosition(object.position);
          return (
            <g key={object.id} transform={`translate(${x} ${z})`} aria-label={object.label}>
              <rect x={-0.64} y={-0.64} width="1.28" height="1.28" fill="#f7fbfd" stroke={object.color} strokeWidth="0.2" />
              <path d="M 0 -0.42 L 0.42 0 L 0 0.42 L -0.42 0 Z" fill={object.color} stroke="#10213c" strokeWidth="0.1" />
              {(object.id === guidance.id || wardenView) && <text x="0.86" y="0.18" fontSize="0.42" fontWeight="900" fill="#13213c" stroke="#f7fbfd" strokeWidth="0.08" paintOrder="stroke">{object.label}</text>}
            </g>
          );
        })}

        {MARKERS.filter((marker) => wardenView && (assignedSector === null || marker.room === assignedSector)).map((marker) => {
          const [x, z] = markerPosition(marker.position);
          const status = evidence[marker.id]?.status;
          const color = status === "VERIFIED" ? "#159b60" : marker.color;
          return (
            <g key={marker.id} transform={`translate(${x} ${z})`} aria-label={marker.label}>
              <circle r={0.48} fill="#f7fbfd" stroke={color} strokeWidth="0.17" />
              <circle r={0.2} fill={color} />
            </g>
          );
        })}

        {wardenView && SPECTATOR_THREATS.map((threat) => {
          const [x, z] = markerPosition(threat.position);
          return (
            <g key={threat.id} transform={`translate(${x} ${z})`} aria-label={threat.label}>
              <circle r={0.72} fill={threat.color} opacity="0.14" stroke={threat.color} strokeWidth="0.2" strokeDasharray="0.3 0.2" />
              <text x={0} y={0.18} textAnchor="middle" fontSize="0.55" fontWeight="900" fill={threat.color}>!</text>
            </g>
          );
        })}

        <ExitMarker position={markerPosition(SCENARIO_OBJECTS.find((object) => object.id === "main-exit")!.position)} label="EXIT" />
        <ExitMarker position={[0, ASSEMBLY_Z + 2]} label="ASSEMBLY" color="#159b60" />
        {assignedSector && <g transform={`translate(${roomCenter(roomById(assignedSector))[0]} ${roomCenter(roomById(assignedSector))[1]})`} aria-label="Warden post">
          <rect x={-0.52} y={-0.52} width={1.04} height={1.04} fill="#2b70bd" stroke="#10213c" strokeWidth="0.16" />
          <text x={0} y={0.2} textAnchor="middle" fontSize="0.42" fontWeight="900" fill="#f7fbfd">W</text>
        </g>}
        {showPlayerState && <PlayerMarker position={position} label={mode.kind === "warden" ? "EVACUEE" : "YOU"} color={mode.kind === "warden" ? "#2871bd" : "#e2a430"} />}
      </svg>
      <div className="ce-map-overlay ce-map-title-card" aria-hidden>
        <strong>CAMPUS EVAC</strong>
        <span>SCIENCE BLOCK / FLOOR 1</span>
      </div>
      <div className="ce-map-overlay ce-map-instruction-card">
        <strong>{mode.kind === "warden" ? "WARDEN CONTROL" : "EXPLORE BUILDING MAP"}</strong>
        <span>{guidance.label}</span>
      </div>
      <div className="ce-map-overlay ce-map-controls-card" aria-hidden>
        <span><kbd>WASD</kbd> MOVE</span>
        <span><kbd>SPACE</kbd> INTERACT</span>
      </div>
      <div className="ce-map-legend ce-map-legend-box">
        <strong>MAP KEY</strong>
        <span><i className="text-[#e2a430]" /> {mode.kind === "warden" ? "Evacuee" : "You"}</span>
        {assignedSector && <span><i className="text-[#2b70bd]" /> Warden post</span>}
        <span><i className="text-[#159b60]" /> Safe route / exit</span>
        <span><i className="text-[#c54243]" /> Blocked route</span>
        {wardenView && <span><i className="text-[#df6c47]" /> Incident / hazard</span>}
      </div>
      {mode.kind === "warden" && !remoteReady && <div className="border-t border-[#b2c5d2] bg-[#fff2c9] px-3 py-2 text-[10px] font-black uppercase tracking-[0.08em] text-[#8b611d]">Waiting for the live evacuee position</div>}
      {view === "evidence" && <div className="border-t border-[#b2c5d2] bg-[#edf4f7] px-3 py-2 text-[10px] font-semibold text-[#526b83]">Evidence markers are scoped to the assigned sector. Inspect records from the evidence panel.</div>}
    </div>
  );
}
