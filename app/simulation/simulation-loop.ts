import { ASSEMBLY_Z, EVACUEE_SPAWN, MARKERS, SCENARIO_OBJECTS, roomAt } from "./level";
import { moveWithCollisions } from "./geometry";
import { getSectorSmoke, VENTILATION_SMOKE_FACTOR } from "./smoke";
import { clampDt, runtime } from "./runtime";
import { useSession } from "./session";
import { useSimulation, type SimulationState } from "./store";
import type { EvacueeState } from "./net/types";

const WALK_SPEED = 3.6;
const RUN_SPEED = 5.8;
const PUBLISH_HZ = 12;

let hazardAccumulator = 0;
let promptAccumulator = 0;
let publishAccumulator = 0;
let stateVersion = 0;

const ventilation = MARKERS.find((marker) => marker.id === "ventilation-panel")!.position;
const assembly = { x: 0, z: ASSEMBLY_Z + 2 };

function distance(a: { x: number; z: number }, b: [number, number]) {
  return Math.hypot(a.x - b[0], a.z - b[1]);
}

function clearMovement() {
  runtime.touchMove.x = 0;
  runtime.touchMove.y = 0;
  runtime.touchSprint = false;
}

export function resetSimulationRuntime() {
  const recovery = runtime.recoveryPosition;
  runtime.recoveryPosition = null;
  runtime.evacuee.x = recovery?.x ?? EVACUEE_SPAWN[0];
  runtime.evacuee.z = recovery?.z ?? EVACUEE_SPAWN[1];
  runtime.evacueeYaw = recovery?.yaw ?? 0;
  runtime.sector = roomAt(runtime.evacuee.x, runtime.evacuee.z);
  runtime.useTarget = null;
  runtime.drillStartedAt = recovery ? Date.now() - (runtime.recoveryHazardElapsed ?? 0) * 1000 : 0;
  runtime.hazardElapsed = runtime.recoveryHazardElapsed ?? 0;
  runtime.recoveryHazardElapsed = null;
  runtime.netEvacuee = null;
  clearMovement();
  hazardAccumulator = 0;
  promptAccumulator = 0;
  publishAccumulator = 0;
  stateVersion = 0;
}

function stepLocalMovement(dt: number, sim: SimulationState) {
  const enabled = sim.briefingStatus === "complete" && !sim.paused && sim.air > 0 && !sim.failed && !sim.assemblyConfirmed;
  if (!enabled) {
    clearMovement();
    return;
  }

  const forward = Math.max(-1, Math.min(1, (runtime.keys.forward ? 1 : 0) - (runtime.keys.back ? 1 : 0) + runtime.touchMove.y));
  const right = Math.max(-1, Math.min(1, (runtime.keys.right ? 1 : 0) - (runtime.keys.left ? 1 : 0) + runtime.touchMove.x));
  const length = Math.hypot(forward, right);
  if (length <= 0.0001) return;

  const throttle = Math.min(1, length);
  const x = (right / length) * throttle;
  // The authored map renders increasing z downward, so forward/up must travel toward -z.
  const z = -(forward / length) * throttle;
  const speed = (runtime.keys.sprint || runtime.touchSprint ? RUN_SPEED : WALK_SPEED) * throttle;
  const next = moveWithCollisions(runtime.evacuee, x * speed * dt, z * speed * dt);
  runtime.evacuee.x = next.x;
  runtime.evacuee.z = next.z;
  runtime.evacueeYaw = Math.atan2(x, z);
  runtime.sector = roomAt(next.x, next.z);
}

function stepRemoteEvacuee(dt: number) {
  const current = runtime.netEvacuee;
  if (!current) return;
  const factor = Math.min(1, clampDt(dt) * 9);
  runtime.evacuee.x += (current.x - runtime.evacuee.x) * factor;
  runtime.evacuee.z += (current.z - runtime.evacuee.z) * factor;
  runtime.evacueeYaw +=
    (((current.yaw - runtime.evacueeYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * factor;
  runtime.sector = current.sectorId;
}

function stepSystems(dt: number, sim: SimulationState) {
  if (sim.failed || sim.assemblyConfirmed) return;
  if (sim.briefingStatus !== "complete") {
    runtime.useTarget = null;
    clearMovement();
    return;
  }

  if (sim.paused) {
    runtime.useTarget = null;
    clearMovement();
    if (runtime.drillStartedAt > 0) runtime.drillStartedAt += dt * 1000;
    return;
  }

  const room = useSession.getState().room;
  if (room && room.phase !== "active") return;
  if (runtime.drillStartedAt <= 0) runtime.drillStartedAt = Date.now();
  const elapsed = Math.max(0, (Date.now() - runtime.drillStartedAt) / 1000);
  runtime.hazardElapsed = elapsed;
  runtime.sector = roomAt(runtime.evacuee.x, runtime.evacuee.z);

  const intensity = getSectorSmoke(runtime.sector, elapsed) * (sim.interventionApplied ? VENTILATION_SMOKE_FACTOR : 1);
  hazardAccumulator += dt;
  if (hazardAccumulator >= 0.08) {
    const tickDt = hazardAccumulator;
    hazardAccumulator = 0;
    sim.applySmokeExposure(elapsed, intensity, tickDt);
  }

  const scenarioTarget = SCENARIO_OBJECTS
    .filter((object) => object.id === "main-exit" || !sim.scenarioProgress[object.id])
    .filter((object) => object.room === runtime.sector || (object.id === "main-exit" && (runtime.sector === "entry" || runtime.sector === "outside")))
    .map((object) => ({ object, distance: distance(runtime.evacuee, object.position) }))
    .filter(({ object, distance: targetDistance }) => targetDistance < object.radius)
    .sort((a, b) => a.distance - b.distance)[0]?.object;

  let useTarget: typeof runtime.useTarget = null;
  if (scenarioTarget) useTarget = { kind: "scenario", id: scenarioTarget.id };
  else if (distance(runtime.evacuee, [assembly.x, assembly.z]) < 2.8) useTarget = { kind: "assembly", id: "outdoor-assembly" };
  else if (distance(runtime.evacuee, ventilation) < 2.2) useTarget = { kind: "intervention", id: "ventilation-panel" };
  runtime.useTarget = useTarget;

  promptAccumulator += dt;
  if (promptAccumulator <= 0.08) return;
  promptAccumulator = 0;
  sim.enterSector(runtime.sector);
  const scenario = useTarget?.kind === "scenario" ? SCENARIO_OBJECTS.find((object) => object.id === useTarget.id) : null;
  const missing = scenario?.id === "main-exit"
    ? SCENARIO_OBJECTS.find((object) => object.id !== "main-exit" && !sim.scenarioProgress[object.id])
    : null;
  const prompt = scenario
    ? scenario.id === "main-exit"
      ? missing ? `Exit locked. Find the ${missing.label.toLowerCase()}.` : "Press E to leave through the marked exit"
      : scenario.kind === "pickup"
        ? `Press E to pick up the ${scenario.label.toLowerCase()}`
        : scenario.kind === "valve"
          ? "Press E to close the gas isolation valve"
          : `Press E to decode the ${scenario.label.toLowerCase()}`
    : useTarget?.kind === "assembly"
      ? "Press E to confirm assembly at the beacon"
      : useTarget?.kind === "intervention"
        ? sim.mode.kind === "solo" ? "Press E to apply the ventilation override" : "Warden authorization is required for this intervention"
        : null;
  sim.setPrompt(prompt);
}

function readEvacueeState(): EvacueeState {
  const sim = useSimulation.getState();
  return {
    kind: "evacuee",
    t: Date.now(),
    hazardElapsed: runtime.hazardElapsed,
    stateVersion,
    eventSequence: stateVersion,
    position: [runtime.evacuee.x, runtime.evacuee.z, runtime.evacueeYaw],
    sectorId: runtime.sector,
    air: sim.air,
    health: sim.health,
    hasBackpack: sim.hasBackpack,
    equipped: sim.equipped,
    scenarioProgress: sim.scenarioProgress,
    smokeIntensity: sim.smokeIntensity,
    stamina: sim.stamina,
    routeStatus: sim.routeStatus,
    interventionApplied: sim.interventionApplied,
    assemblyProgress: sim.assemblyProgress,
    assemblyConfirmed: sim.assemblyConfirmed,
    failed: sim.failed,
    routeMessage: sim.latestMessage,
    log: sim.log,
  };
}

function stepNetwork(dt: number, sim: SimulationState) {
  if (sim.mode.kind === "solo") return;
  publishAccumulator += dt;
  if (publishAccumulator < 1 / PUBLISH_HZ) return;
  publishAccumulator = 0;
  stateVersion += 1;
  useSession.getState().publish(readEvacueeState());
}

export function stepSimulation(dt: number) {
  const sim = useSimulation.getState();
  if (sim.mode.kind === "warden") {
    stepRemoteEvacuee(dt);
    return;
  }
  stepLocalMovement(clampDt(dt), sim);
  stepSystems(clampDt(dt), sim);
  stepNetwork(clampDt(dt), sim);
}
