"use client";

import { useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import { ContactShadows, Environment, Lightformer, OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { roomById, SUN_DIRECTION, type RoomDef } from "../level";
import { getSectorSmoke, VENTILATION_SMOKE_FACTOR } from "../smoke";
import { clampDt, runtime } from "../runtime";
import { useSimulation } from "../store";
import { useCoarsePointer } from "../useCoarsePointer";

/** Corners of a room, at floor level and at head height. */
function roomCorners(room: RoomDef) {
  const b = room.bounds;
  const out: THREE.Vector3[] = [];
  for (const x of [b.minX, b.maxX])
    for (const z of [b.minZ, b.maxZ])
      for (const y of [0, 2.4]) out.push(new THREE.Vector3(x, y, z));
  return out;
}

/**
 * How far back this room has to be viewed from to hold all of it on screen.
 *
 * The pose in `level.ts` fixes the direction - behind the door the evacuee
 * walks in through - but the distance that fits depends on the window: a tall
 * narrow window has a much narrower horizontal field than a wide one, and the
 * far corners slide off the sides. Solving for it here means the warden
 * always gets the whole room whatever shape their window is, instead of a
 * framing that only works on the laptop it was authored on.
 */
function fitDistance(room: RoomDef, aspect: number, fov: number) {
  const target = new THREE.Vector3(...room.cam.target);
  const dir = new THREE.Vector3(...room.cam.pos).sub(target).normalize();
  const corners = roomCorners(room);
  const probe = new THREE.PerspectiveCamera(fov, aspect, 0.1, 400);
  const MARGIN = 0.92;

  const overflow = (d: number) => {
    probe.position.copy(target).addScaledVector(dir, d);
    probe.lookAt(target);
    probe.updateMatrixWorld(true);
    probe.updateProjectionMatrix();
    let worst = 0;
    for (const c of corners) {
      const p = c.clone().project(probe);
      worst = Math.max(worst, Math.abs(p.x), Math.abs(p.y));
    }
    return worst;
  };

  const authored = new THREE.Vector3(...room.cam.pos).distanceTo(target);
  if (overflow(authored) <= MARGIN) return authored;
  let lo = authored;
  let hi = authored * 4;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (overflow(mid) > MARGIN) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * Mouse look for the evacuee. Uses pointer lock when the browser allows it and
 * falls back to click-drag when it does not (embedded frames, some previews).
 */
function FirstPersonLook({ touch }: { touch: boolean }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);

  // a finger drives the look through the on-screen pad, drained here each frame
  useFrame(() => {
    if (!touch) return;
    const { dx, dy } = runtime.touchLook;
    if (dx === 0 && dy === 0) return;
    runtime.touchLook.dx = 0;
    runtime.touchLook.dy = 0;
    const euler = new THREE.Euler(0, 0, 0, "YXZ");
    euler.setFromQuaternion(camera.quaternion);
    euler.y -= dx * 0.0042;
    euler.x = THREE.MathUtils.clamp(euler.x - dy * 0.0042, -1.35, 1.35);
    camera.quaternion.setFromEuler(euler);
  });

  useEffect(() => {
    // pointer lock is a desktop idea; on a phone the synthesised mouse events
    // would fight the look pad
    if (touch) return;
    const el = gl.domElement;
    const euler = new THREE.Euler(0, 0, 0, "YXZ");
    let dragging = false;

    const onDown = () => {
      dragging = true;
      try {
        const p = el.requestPointerLock() as unknown as Promise<void> | void;
        if (p && typeof (p as Promise<void>).catch === "function")
          (p as Promise<void>).catch(() => {});
      } catch {
        /* pointer lock unavailable - drag look still works */
      }
    };
    const onUp = () => {
      dragging = false;
    };
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== el && !dragging) return;
      euler.setFromQuaternion(camera.quaternion);
      euler.y -= e.movementX * 0.0022;
      euler.x = THREE.MathUtils.clamp(
        euler.x - e.movementY * 0.0022,
        -1.35,
        1.35,
      );
      camera.quaternion.setFromEuler(euler);
    };

    el.addEventListener("mousedown", onDown);
    el.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      el.removeEventListener("mousedown", onDown);
      el.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (document.pointerLockElement === el) document.exitPointerLock();
    };
  }, [gl, camera, touch]);

  return null;
}

/**
 * The warden camera follows the evacuee sector: whenever the evacuee moves
 * into another room the framing slides over to that room, so the map reveals
 * itself as the run goes on instead of being handed over all at once.
 *
 * A warden's framing is bolted down - no orbit, no pan. Their sector is
 * always drawn from the same angle, so route directions stay consistent for
 * the warden and evacuee. Solo play keeps the
 * free camera, since there is nobody to give directions to.
 */
const FOV = 45;

/** Cheap distance fog: smoke changes readability without a volumetric pass. */
function SmokeAtmosphere() {
  const view = useSimulation((s) => s.view);
  const room = useSimulation((s) => s.sector);
  const fog = useRef<THREE.FogExp2>(null);
  const current = useRef(0);
  const clear = useMemo(() => new THREE.Color("#6a5774"), []);
  const smoke = useMemo(() => new THREE.Color("#9a939b"), []);

  useFrame((_, rawDt) => {
    const fogInstance = fog.current;
    if (!fogInstance) return;

    const state = useSimulation.getState();
    const target =
      view === "evacuee"
        ? getSectorSmoke(room, state.hazardElapsed) *
          (state.interventionApplied ? VENTILATION_SMOKE_FACTOR : 1)
        : 0;
    const k = 1 - Math.exp(-clampDt(rawDt) * 4);
    current.current += (target - current.current) * k;
    fogInstance.density = 0.012 + current.current * 0.1;
    fogInstance.color.copy(clear).lerp(smoke, current.current);
  });

  return <fogExp2 ref={fog} attach="fog" args={["#6a5774", 0.012]} />;
}

const SUN = new THREE.Vector3(...SUN_DIRECTION).normalize();

/** Low sunset key light, a violet sky fill and a restrained emergency pulse once smoke builds. */
function SceneLighting() {
  const smoke = useSimulation((state) => state.smokeIntensity);
  const intervention = useSimulation((state) => state.interventionApplied);
  const alert = useRef<THREE.PointLight>(null);

  useFrame(({ clock }, rawDt) => {
    if (!alert.current) return;
    const pulse = (Math.sin(clock.elapsedTime * 5.5) + 1) * 0.5;
    const target = smoke > 0.18 ? 0.15 + pulse * 0.45 * (intervention ? 0.35 : 1) : 0;
    alert.current.intensity += (target - alert.current.intensity) * Math.min(1, clampDt(rawDt) * 5);
  });

  return (
    <>
      <directionalLight
        castShadow
        position={[SUN.x * 45, SUN.y * 45 + 12, SUN.z * 45]}
        intensity={2.8}
        color="#ffccaa"
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0002}
        shadow-normalBias={0.04}
        shadow-camera-near={1}
        shadow-camera-far={120}
        shadow-camera-left={-34}
        shadow-camera-right={34}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
      />
      <directionalLight position={[-24, 18, 30]} intensity={0.6} color="#bbaaff" />
      <pointLight ref={alert} position={[0, 3.15, -1.5]} distance={18} decay={2} color="#ff3344" />
    </>
  );
}

function WardenRig({ active }: { active: boolean }) {
  const mode = useSimulation((s) => s.mode);
  const evacueeSector = useSimulation((s) => s.sector);
  // every overview camera follows the evacuee's live sector
  const room = evacueeSector;
  // a warden's framing is bolted down - only solo may turn it
  const posted = mode.kind === "warden";
  // re-fit when the window changes shape, so a resize never crops the room
  const aspect = useThree((s) => s.viewport.aspect);
  const cam = useRef<THREE.PerspectiveCamera>(null);
  const orbit = useRef<ComponentRef<typeof OrbitControls>>(null);
  const [start] = useState(() => roomById(room).cam);
  const want = useRef({
    pos: new THREE.Vector3(...start.pos),
    target: new THREE.Vector3(...start.target),
  });
  const following = useRef(true);

  // how far back this window has to sit to hold the whole room
  const fitted = useMemo(
    () =>
      posted
        ? fitDistance(roomById(room), aspect || 1.6, FOV)
        : new THREE.Vector3(...roomById(room).cam.pos).distanceTo(
            new THREE.Vector3(...roomById(room).cam.target),
          ),
    [room, posted, aspect],
  );

  useEffect(() => {
    const r = roomById(room);
    want.current.target.set(...r.cam.target);
    if (posted) {
      // keep the authored direction, take whatever distance shows the room
      const dir = new THREE.Vector3(...r.cam.pos)
        .sub(want.current.target)
        .normalize();
      want.current.pos.copy(want.current.target).addScaledVector(dir, fitted);
    } else {
      want.current.pos.set(...r.cam.pos);
    }
    // a warden never turns the camera, so there is nothing to ease:
    // put the aim on the room at once and let only the position slide
    if (posted && orbit.current) {
      orbit.current.target.copy(want.current.target);
      orbit.current.update();
    }
    following.current = true;
  }, [room, posted, fitted]);

  // hand the fresh target to the controls whenever they mount
  useEffect(() => {
    if (active && orbit.current) {
      orbit.current.target.copy(want.current.target);
      orbit.current.update();
    }
  }, [active]);

  useFrame((_, rawDt) => {
    if (!cam.current || !following.current) return;
    const k = Math.min(1, clampDt(rawDt) * 2.4);
    cam.current.position.lerp(want.current.pos, k);
    if (orbit.current) {
      orbit.current.target.lerp(want.current.target, k);
      orbit.current.update();
    } else {
      cam.current.lookAt(want.current.target);
    }
    // Where the camera is aimed matters as much as where it stands, and the two
    // converge at different speeds. Stopping on the position alone froze the
    // aim wherever it had got to - which left the side rooms staring at the
    // floor instead of down the room, while the lobby looked fine only because
    // its target is a metre from the origin the aim was still sat on.
    const arrived =
      cam.current.position.distanceTo(want.current.pos) < 0.05 &&
      (!orbit.current ||
        orbit.current.target.distanceTo(want.current.target) < 0.05);
    if (arrived) following.current = false;
  });

  return (
    <>
      <PerspectiveCamera
        ref={cam}
        makeDefault={active}
        fov={FOV}
        near={0.1}
        far={400}
        position={start.pos}
      />
      {active && (
        <OrbitControls
          ref={orbit}
          makeDefault
           /* Wardens get a fixed frame: zoom only, so the sector never turns
              under them and the evacuee heading stays readable. */
          enableRotate={!posted}
          enablePan={!posted}
           /* the assigned framing already starts wide enough to see the whole
              sector and its entry; this is only headroom
             to lean in or pull further back, measured off that fitted distance
             so it means the same thing on every window shape */
          minDistance={posted ? fitted * 0.45 : 4}
          maxDistance={posted ? fitted * 1.8 : 40}
          maxPolarAngle={posted ? 1.3 : 1.52}
          enableDamping
          dampingFactor={0.08}
          onStart={() => {
            // a warden can only dolly, and that must not cancel the
            // slide back to their room's framing
            if (!posted) following.current = false;
          }}
        />
      )}
    </>
  );
}

/**
 * One rig, three views. The simulation is identical in all of them - only the
 * camera and the amount of information drawn on top of the world changes.
 */
export default function ViewRig() {
  const view = useSimulation((s) => s.view);
  const touch = useCoarsePointer();
  const first = view === "evacuee";

  return (
    <>
      <SmokeAtmosphere />
      <SceneLighting />
      <SceneLighting />
      <ContactShadows
        position={[0, 0.015, 4]}
        opacity={0.45}
        scale={48}
        blur={2.2}
        far={5.5}
        resolution={1024}
        color="#221122"
      />

      {/* Soft image-based light: warm sunset on one side, violet sky above. Rendered once. */}
      <Environment frames={1} resolution={256} environmentIntensity={0.8}>
        <Lightformer
          form="rect"
          intensity={4.5}
          color="#ffcca5"
          position={[SUN.x * 30, 8, SUN.z * 30]}
          rotation={[0, Math.atan2(SUN.x, SUN.z) + Math.PI, 0]}
          scale={[60, 20, 1]}
        />
        <Lightformer form="rect" intensity={2.5} color="#d0c0ff" position={[0, 25, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[100, 100, 1]} />
        <Lightformer
          form="rect"
          intensity={1.5}
          color="#ffe0c0"
          position={[-SUN.x * 30, 4, -SUN.z * 30]}
          rotation={[0, Math.atan2(-SUN.x, -SUN.z) + Math.PI, 0]}
          scale={[60, 12, 1]}
        />
      </Environment>

      {/* Evacuee: eyes inside the character, driven by Evacuee.tsx. */}
      <PerspectiveCamera makeDefault={first} fov={74} near={0.06} far={400} />
      {first && <FirstPersonLook key="fps" touch={touch} />}

      <WardenRig active={!first} />

      <ambientLight intensity={first ? 0.35 : 0.45} color="#ffeedd" />
      <hemisphereLight color="#e2d6ff" groundColor="#403040" intensity={first ? 0.7 : 0.8} />
    </>
  );
}
