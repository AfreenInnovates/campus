import {
  ASSEMBLY_Z,
  EVACUEE_SPAWN,
  MASSES,
  ROOMS,
  SCENARIO_OBJECTS,
  WALLS,
  roomAt,
  roomById,
  type Point,
  type RoomDef,
  type RoomId,
  type WallDef,
} from "../simulation/level";

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

function overlap(a1: number, a2: number, b1: number, b2: number) {
  return Math.min(a2, b2) - Math.max(a1, b1);
}

function sharedBoundary(a: RoomDef, b: RoomDef): Point | null {
  const ab = a.bounds;
  const bb = b.bounds;
  if (Math.abs(ab.maxX - bb.minX) < 0.08) {
    const length = overlap(ab.minZ, ab.maxZ, bb.minZ, bb.maxZ);
    if (length > 0.08) return [ab.maxX, Math.max(ab.minZ, bb.minZ) + length / 2];
  }
  if (Math.abs(ab.minX - bb.maxX) < 0.08) {
    const length = overlap(ab.minZ, ab.maxZ, bb.minZ, bb.maxZ);
    if (length > 0.08) return [ab.minX, Math.max(ab.minZ, bb.minZ) + length / 2];
  }
  if (Math.abs(ab.maxZ - bb.minZ) < 0.08) {
    const length = overlap(ab.minX, ab.maxX, bb.minX, bb.maxX);
    if (length > 0.08) return [Math.max(ab.minX, bb.minX) + length / 2, ab.maxZ];
  }
  if (Math.abs(ab.minZ - bb.maxZ) < 0.08) {
    const length = overlap(ab.minX, ab.maxX, bb.minX, bb.maxX);
    if (length > 0.08) return [Math.max(ab.minX, bb.minX) + length / 2, ab.minZ];
  }
  return null;
}

function authoredRoomPath(from: RoomId, to: RoomId): RoomDef[] {
  if (from === to) return [roomById(from)];
  const queue: RoomDef[][] = [[roomById(from)]];
  const visited = new Set<RoomId>([from]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    const last = path.at(-1)!;
    for (const next of ROOMS) {
      if (visited.has(next.id) || !sharedBoundary(last, next)) continue;
      const nextPath = [...path, next];
      if (next.id === to) return nextPath;
      visited.add(next.id);
      queue.push(nextPath);
    }
  }
  return [roomById(from), roomById(to)];
}

function authoredPath(from: Point, to: Point, targetRoom: RoomId) {
  const rooms = authoredRoomPath(roomAt(from[0], from[1]), targetRoom);
  const points: Point[] = [from];
  for (let index = 0; index < rooms.length - 1; index += 1) {
    const boundary = sharedBoundary(rooms[index], rooms[index + 1]);
    if (boundary) points.push(boundary);
  }
  points.push(to);
  return points;
}

const TREE_POSITIONS: Point[] = [
  [-20, 15], [-16, 21], [-9, 23], [9, 23], [16, 21], [20, 15],
  [-20, 10.8], [20, 10.8], [-13, 18.5], [13, 18.5],
];

function PreviewTrees() {
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

function PreviewFurniture({ room }: { room: RoomDef }) {
  if (room.id === "sec") {
    return (
      <g opacity="0.88" aria-hidden>
        {[room.bounds.minX + 1.4, room.bounds.minX + 5.8, room.bounds.minX + 10.2].map((x) => (
          <g key={x}>
            <rect x={x} y={room.bounds.minZ + 2.2} width="3.4" height="0.72" fill="#9aaeba" stroke="#536d80" strokeWidth="0.12" />
            <rect x={x + 0.42} y={room.bounds.minZ + 1.48} width="0.8" height="0.58" fill="#6f8797" stroke="#284a66" strokeWidth="0.1" />
            <rect x={x + 2.18} y={room.bounds.minZ + 1.52} width="0.58" height="0.42" fill="#77b8d8" stroke="#284a66" strokeWidth="0.1" />
          </g>
        ))}
        <rect x={room.bounds.minX + 1.1} y={room.bounds.maxZ - 1.7} width={room.bounds.maxX - room.bounds.minX - 2.2} height="0.55" fill="#8ea5b1" stroke="#536d80" strokeWidth="0.12" />
      </g>
    );
  }
  if (room.id === "vault") {
    return (
      <g opacity="0.88" aria-hidden>
        {[room.bounds.minX + 1.3, room.bounds.minX + 4.9, room.bounds.minX + 8.5, room.bounds.minX + 11.1].map((x) => (
          <g key={x}>
            <rect x={x} y={room.bounds.minZ + 2.1} width="2.1" height="0.62" fill="#bdad8c" stroke="#7b6d52" strokeWidth="0.1" />
            <rect x={x + 0.72} y={room.bounds.minZ + 1.48} width="0.62" height="0.5" fill="#6d7f8d" stroke="#284a66" strokeWidth="0.1" />
          </g>
        ))}
        <rect x={room.bounds.minX + 1} y={room.bounds.maxZ - 1.35} width={room.bounds.maxX - room.bounds.minX - 2} height="0.52" fill="#bdad8c" stroke="#7b6d52" strokeWidth="0.1" />
      </g>
    );
  }
  if (room.id === "lobby") {
    return (
      <g opacity="0.88" aria-hidden>
        <rect x="-1.35" y="-0.25" width="2.7" height="1.65" fill="#8c969f" stroke="#536d80" strokeWidth="0.14" />
        <rect x="-0.74" y="-0.88" width="1.48" height="0.58" fill="#adb7bd" stroke="#536d80" strokeWidth="0.1" />
        <rect x={room.bounds.minX + 1.1} y={room.bounds.maxZ - 2.1} width="2.8" height="0.48" fill="#987d62" stroke="#536d80" strokeWidth="0.1" />
        <rect x={room.bounds.maxX - 3.9} y={room.bounds.maxZ - 2.1} width="2.8" height="0.48" fill="#987d62" stroke="#536d80" strokeWidth="0.1" />
      </g>
    );
  }
  return null;
}

function roomFill(room: RoomDef) {
  if (room.id === "outside") return "url(#ce-preview-outside)";
  if (room.id === "sec") return "url(#ce-preview-science)";
  if (room.id === "vault" || room.id === "annex") return "url(#ce-preview-academic)";
  return "url(#ce-preview-floor)";
}

export default function PixelMapPreview() {
  const spawn: Point = [EVACUEE_SPAWN[0], EVACUEE_SPAWN[1]];
  const exit = SCENARIO_OBJECTS.find((object) => object.id === "main-exit")!;
  const labTarget = SCENARIO_OBJECTS.find((object) => object.id === "lab-access-card")!;
  const assembly: Point = [0, ASSEMBLY_Z];
  const labRoute = authoredPath(spawn, labTarget.position, labTarget.room);
  const assemblyRoute = authoredPath(spawn, assembly, "outside");

  return (
    <div className="ce-preview-map">
      <svg
        viewBox={`${VIEW.minX} ${VIEW.minZ} ${VIEW.width} ${VIEW.height}`}
        role="img"
        aria-label="Authored CampusEvac top-down map preview with rooms, objectives, route, exit, and assembly point"
      >
        <defs>
          <pattern id="ce-preview-floor" width="1" height="1" patternUnits="userSpaceOnUse">
            <rect width="1" height="1" fill="#cbd8df" />
            <path d="M 0 0 H 1 M 0 0 V 1" stroke="#9fb3bf" strokeWidth="0.06" />
          </pattern>
          <pattern id="ce-preview-science" width="1" height="1" patternUnits="userSpaceOnUse">
            <rect width="1" height="1" fill="#b8d1df" />
            <path d="M 0 0 H 1 M 0 0 V 1" stroke="#77a7be" strokeWidth="0.06" />
          </pattern>
          <pattern id="ce-preview-academic" width="1" height="1" patternUnits="userSpaceOnUse">
            <rect width="1" height="1" fill="#d9d5be" />
            <path d="M 0 0 H 1 M 0 0 V 1" stroke="#b7ab89" strokeWidth="0.06" />
          </pattern>
          <pattern id="ce-preview-outside" width="1" height="1" patternUnits="userSpaceOnUse">
            <rect width="1" height="1" fill="#a7c98b" />
            <path d="M 0 0 H 1 M 0 0 V 1" stroke="#6e9a63" strokeWidth="0.06" />
          </pattern>
        </defs>
        <rect x={VIEW.minX} y={VIEW.minZ} width={VIEW.width} height={VIEW.height} fill="#9fb3bf" />
        <PreviewTrees />
        {ROOMS.map((room) => {
          const { minX, maxX, minZ, maxZ } = room.bounds;
          const labelLines = roomLabelLines(room);
          return (
            <g key={room.id}>
              <rect x={minX} y={minZ} width={maxX - minX} height={maxZ - minZ} fill={roomFill(room)} stroke="#536d80" strokeWidth="0.16" />
              <PreviewFurniture room={room} />
              <rect x={minX + 0.35} y={minZ + 0.35} width={Math.min(maxX - minX - 0.7, Math.max(3.2, labelLines[0].length * 0.32 + 1.15))} height="1.58" fill="#f7fbfd" opacity="0.92" stroke="#536d80" strokeWidth="0.08" />
              <text x={minX + 0.5} y={minZ + 1.05} fill="#13213c" fontSize="0.48" fontWeight="900" letterSpacing="0.05em">
                {roomCode(room)}
              </text>
              <text x={minX + 0.5} y={minZ + 1.43} fill="#284764" fontSize="0.4" fontWeight="900" letterSpacing="0.02em">
                {labelLines[0]}
                <tspan x={minX + 0.5} dy="0.47">{labelLines[1]}</tspan>
              </text>
            </g>
          );
        })}
        {MASSES.map((mass, index) => (
          <rect key={`preview-mass-${index}`} x={mass.x1} y={mass.z1} width={mass.x2 - mass.x1} height={mass.z2 - mass.z1} fill="#7e929e" stroke="#536d80" strokeWidth="0.12" />
        ))}
        {WALLS.flatMap((wall) => wallSegments(wall).map((segment, index) => (
          <line key={`preview-wall-${wall.id}-${index}`} x1={segment[0]} y1={segment[1]} x2={segment[2]} y2={segment[3]} stroke="#284a66" strokeWidth="0.24" strokeLinecap="square" />
        )))}
        <polyline points={pointsAttribute(labRoute)} fill="none" stroke="#31c879" strokeWidth="0.52" strokeDasharray="0.9 0.45" strokeLinecap="square" />
        <polyline points={pointsAttribute(assemblyRoute)} fill="none" stroke="#2871bd" strokeWidth="0.28" strokeDasharray="0.45 0.35" strokeLinecap="square" opacity="0.7" />
        {SCENARIO_OBJECTS.map((object) => {
          const [x, z] = object.position;
          return (
            <g key={object.id} transform={`translate(${x} ${z})`}>
              <rect x="-0.48" y="-0.48" width="0.96" height="0.96" fill="#f7fbfd" stroke={object.color} strokeWidth="0.14" />
              <rect x="-0.22" y="-0.22" width="0.44" height="0.44" fill={object.color} />
            </g>
          );
        })}
        <rect x={spawn[0] - 0.62} y={spawn[1] - 0.62} width="1.24" height="1.24" fill="#f7fbfd" stroke="#13213c" strokeWidth="0.16" />
        <path d={`M ${spawn[0]} ${spawn[1] - 0.5} l 0.4 0.9 h -0.8 z`} fill="#e2a430" stroke="#13213c" strokeWidth="0.12" />
        <rect x={exit.position[0] - 1.05} y={exit.position[1] - 0.55} width="2.1" height="1.1" fill="#31c879" stroke="#13213c" strokeWidth="0.16" />
        <text x={exit.position[0]} y={exit.position[1] + 0.18} fill="#f7fbfd" textAnchor="middle" fontSize="0.36" fontWeight="900">EXIT</text>
        <circle cx={assembly[0]} cy={assembly[1]} r="1.1" fill="none" stroke="#159b60" strokeWidth="0.18" strokeDasharray="0.3 0.2" />
      </svg>
      <div className="ce-preview-map-title">
        <strong>CAMPUS EVAC</strong>
        <span>SCIENCE BLOCK / FLOOR 1</span>
      </div>
      <div className="ce-preview-map-note">
        <strong>EXPLORE BUILDING MAP</strong>
        <span>Follow the authored west route to the lab access card.</span>
      </div>
      <div className="ce-preview-map-label ce-preview-map-label-west">WEST ROUTE</div>
      <div className="ce-preview-map-label ce-preview-map-label-assembly">ASSEMBLY</div>
      <div className="ce-preview-map-key">
        <strong>MAP KEY</strong>
        <span><i className="bg-[#31c879]" /> route</span>
        <span><i className="bg-[#39ff88]" /> exit</span>
      </div>
    </div>
  );
}
