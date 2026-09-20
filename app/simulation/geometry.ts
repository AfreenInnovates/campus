import { MASSES, WALLS, type WallDef } from "./level";

export type PlanarPosition = { x: number; z: number };
export type WallSegment = { axis: "x" | "z"; fixed: number; from: number; to: number };

export function wallSegments(def: WallDef): WallSegment[] {
  const segments: WallSegment[] = [];
  const openings = [...(def.openings ?? [])].sort((a, b) => a.at - b.at);
  let cursor = def.from;
  for (const opening of openings) {
    const start = opening.at - opening.width / 2;
    if (start > cursor) segments.push({ axis: def.axis, fixed: def.fixed, from: cursor, to: start });
    cursor = opening.at + opening.width / 2;
  }
  if (cursor < def.to) segments.push({ axis: def.axis, fixed: def.fixed, from: cursor, to: def.to });
  return segments;
}

const SEGMENTS = WALLS.flatMap(wallSegments);
const PLAYER_RADIUS = 0.42;

function resolveWalls(previous: PlanarPosition, next: PlanarPosition, radius: number) {
  for (const segment of SEGMENTS) {
    const from = segment.from - radius;
    const to = segment.to + radius;
    if (segment.axis === "z") {
      if (next.z < from || next.z > to || Math.abs(next.x - segment.fixed) >= radius) continue;
      const side = previous.x < segment.fixed ? -1 : 1;
      next.x = segment.fixed + side * radius;
    } else {
      if (next.x < from || next.x > to || Math.abs(next.z - segment.fixed) >= radius) continue;
      const side = previous.z < segment.fixed ? -1 : 1;
      next.z = segment.fixed + side * radius;
    }
  }
}

function resolveMasses(next: PlanarPosition, radius: number) {
  for (const mass of MASSES) {
    if (
      next.x < mass.x1 - radius ||
      next.x > mass.x2 + radius ||
      next.z < mass.z1 - radius ||
      next.z > mass.z2 + radius
    )
      continue;

    const exits = [
      { distance: Math.abs(next.x - (mass.x1 - radius)), apply: () => { next.x = mass.x1 - radius; } },
      { distance: Math.abs(mass.x2 + radius - next.x), apply: () => { next.x = mass.x2 + radius; } },
      { distance: Math.abs(next.z - (mass.z1 - radius)), apply: () => { next.z = mass.z1 - radius; } },
      { distance: Math.abs(mass.z2 + radius - next.z), apply: () => { next.z = mass.z2 + radius; } },
    ];
    exits.sort((a, b) => a.distance - b.distance)[0].apply();
  }
}

/** Move the player through authored wall openings and corridor masses. */
export function moveWithCollisions(
  previous: PlanarPosition,
  dx: number,
  dz: number,
  radius = PLAYER_RADIUS,
): PlanarPosition {
  const next = { x: previous.x + dx, z: previous.z + dz };
  resolveWalls(previous, next, radius);
  resolveMasses(next, radius);
  resolveWalls(previous, next, radius);
  return next;
}
