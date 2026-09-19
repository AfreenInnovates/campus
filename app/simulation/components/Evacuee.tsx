"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useKeyboardControls } from "@react-three/drei";
import { CapsuleCollider, RigidBody, useRapier, type RapierRigidBody } from "@react-three/rapier";
import * as THREE from "three";
import { EVACUEE_SPAWN, ROOM_H, roomAt } from "../level";
import { pressJump, pressUse } from "../controls";
import { clampDt, runtime } from "../runtime";
import { useSimulation, useIsSimulationOwner } from "../store";
import { Label, NeonBox } from "./Markers";
import Student from "./Student";

type Controls =
  | "forward"
  | "back"
  | "left"
  | "right"
  | "sprint"
  | "use"
  | "jump"
  | "camera";

const WALK = 3.6;
const RUN = 5.8;
const JUMP_V = 6.2;
const GROUNDED_Y = 0.95;
const JUMP_BUFFER_MS = 160;
const EYE = 0.8;

/* over-the-shoulder camera, measured from the body's centre */
const SHOULDER_HEIGHT = 0.9;
const SHOULDER_OFFSET = 0.5;
const CAMERA_DISTANCE = 2.4;
const CAMERA_CLEARANCE = 0.2;
const UP = new THREE.Vector3(0, 1, 0);

function HeadingBeacon() {
  return (
    <group position={[0, 2.35, 0]}>
      <mesh position={[0, 0, 0.27]}>
        <boxGeometry args={[0.045, 0.045, 0.48]} />
        <meshBasicMaterial color="#facc15" />
      </mesh>
      <mesh position={[0, 0, 0.62]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.14, 0.28, 4]} />
        <meshBasicMaterial color="#facc15" />
      </mesh>
    </group>
  );
}

function ContactShade() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
      <circleGeometry args={[0.5, 20]} />
      <meshBasicMaterial color="#05070a" transparent opacity={0.3} />
    </mesh>
  );
}

function LocalEvacuee() {
  const body = useRef<RapierRigidBody>(null);
  const visual = useRef<THREE.Group>(null);
  const eyeTarget = useRef(new THREE.Vector3());
  const bobT = useRef(0);
  const [sub, get] = useKeyboardControls<Controls>();
  const { world, rapier } = useRapier();
  const scratch = useMemo(
    () => ({
      look: new THREE.Vector3(),
      right: new THREE.Vector3(),
      head: new THREE.Vector3(),
      back: new THREE.Vector3(),
      target: new THREE.Vector3(),
    }),
    [],
  );
  const view = useSimulation((state) => state.view);
  const cameraMode = useSimulation((state) => state.cameraMode);
  const hasBackpack = useSimulation((state) => state.hasBackpack);
  const equipped = useSimulation((state) => state.equipped);
  const air = useSimulation((state) => state.air);
  const briefingStatus = useSimulation((state) => state.briefingStatus);
  const paused = useSimulation((state) => state.paused);
  const resetSeq = useSimulation((state) => state.resetSeq);
  // the evacuee's own camera: over the right shoulder, or through the eyes
  const ownCamera = view === "evacuee";
  const eyes = ownCamera && cameraMode === "first";
  const overShoulder = ownCamera && cameraMode === "third";

  useEffect(
    () =>
      sub(
        (state) => state.use,
        (pressed) => pressed && pressUse(),
      ),
    [sub],
  );

  useEffect(
    () =>
      sub(
        (state) => state.jump,
        (pressed) => pressed && pressJump(),
      ),
    [sub],
  );

  useEffect(
    () =>
      sub(
        (state) => state.camera,
        (pressed) => pressed && useSimulation.getState().toggleCameraMode(),
      ),
    [sub],
  );

  useEffect(() => {
    const rb = body.current;
    if (!rb) return;
    rb.setTranslation(
      { x: EVACUEE_SPAWN[0], y: EVACUEE_SPAWN[1], z: EVACUEE_SPAWN[2] },
      true,
    );
    rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
    eyeTarget.current.set(EVACUEE_SPAWN[0], EVACUEE_SPAWN[1] + EYE, EVACUEE_SPAWN[2]);
  }, [resetSeq]);

  useFrame((state, rawDt) => {
    const rb = body.current;
    if (!rb) return;
    const dt = clampDt(rawDt);
    const t = rb.translation();
    runtime.evacuee.set(t.x, t.y, t.z);
    runtime.sector = roomAt(t.x, t.z);

    const movementEnabled = briefingStatus === "complete" && !paused;
    const down = movementEnabled && air > 0 ? get() : ({} as Record<Controls, boolean>);
    const stick = movementEnabled && air > 0 ? runtime.touchMove : { x: 0, y: 0 };
    const forward = THREE.MathUtils.clamp(
      (down.forward ? 1 : 0) - (down.back ? 1 : 0) + stick.y,
      -1,
      1,
    );
    const right = THREE.MathUtils.clamp(
      (down.right ? 1 : 0) - (down.left ? 1 : 0) + stick.x,
      -1,
      1,
    );

    const direction = state.camera.getWorldDirection(new THREE.Vector3());
    direction.y = 0;
    if (direction.lengthSq() < 1e-6) direction.set(0, 0, -1);
    direction.normalize();
    const side = new THREE.Vector3().crossVectors(
      direction,
      new THREE.Vector3(0, 1, 0),
    );
    const move = new THREE.Vector3()
      .addScaledVector(direction, forward)
      .addScaledVector(side, right);
    const moving = move.lengthSq() > 1e-4;
    const throttle = Math.min(1, move.length());
    if (moving) move.normalize();

    const speed = (down.sprint ? RUN : WALK) * (moving ? throttle : 0);
    const velocity = rb.linvel();
    const grounded = t.y <= GROUNDED_Y;
    const wantsJump = movementEnabled && performance.now() - runtime.jumpAt < JUMP_BUFFER_MS;
    if (wantsJump && grounded && air > 0) runtime.jumpAt = -1e9;
    rb.setLinvel(
      {
        x: move.x * speed,
        y: wantsJump && grounded && air > 0 ? JUMP_V : velocity.y,
        z: move.z * speed,
      },
      true,
    );

    // with its own camera the body faces where the player looks; otherwise where it walks
    if (ownCamera) runtime.evacueeYaw = Math.atan2(direction.x, direction.z);
    else if (moving) runtime.evacueeYaw = Math.atan2(move.x, move.z);
    if (visual.current) visual.current.rotation.y = runtime.evacueeYaw;
    bobT.current += moving ? dt * (down.sprint ? 12 : 8) : 0;

    if (eyes) {
      eyeTarget.current.set(
        t.x,
        t.y + EYE + (moving ? Math.sin(bobT.current * 2) * 0.02 : 0),
        t.z,
      );
      state.camera.position.lerp(eyeTarget.current, 1 - Math.exp(-dt * 14));
    } else if (overShoulder) {
      // Behind and right of the head, pulled in wherever a wall or the floor would clip it.
      const look = state.camera.getWorldDirection(scratch.look);
      const right = scratch.right.crossVectors(look, UP);
      if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
      right.normalize();
      const head = scratch.head.set(t.x, t.y + SHOULDER_HEIGHT, t.z);
      const sideHit = world.castRay(
        new rapier.Ray(head, right),
        SHOULDER_OFFSET,
        true,
        undefined,
        undefined,
        undefined,
        rb,
      );
      head.addScaledVector(
        right,
        sideHit ? Math.max(0, sideHit.timeOfImpact - CAMERA_CLEARANCE) : SHOULDER_OFFSET,
      );
      const back = scratch.back.copy(look).negate();
      const backHit = world.castRay(
        new rapier.Ray(head, back),
        CAMERA_DISTANCE,
        true,
        undefined,
        undefined,
        undefined,
        rb,
      );
      const distance = backHit
        ? Math.max(0.35, backHit.timeOfImpact - CAMERA_CLEARANCE)
        : CAMERA_DISTANCE;
      const target = scratch.target.copy(head).addScaledVector(back, distance);
      // ceilings have no collider, so keep the camera under them indoors
      if (runtime.sector !== "outside") target.y = Math.min(target.y, ROOM_H - 0.3);
      state.camera.position.lerp(target, 1 - Math.exp(-dt * 18));
    }
  });

  return (
    <RigidBody
      ref={body}
      type="dynamic"
      colliders={false}
      position={EVACUEE_SPAWN}
      enabledRotations={[false, false, false]}
      friction={0}
      linearDamping={6}
      mass={1}
      ccd
      userData={{ tag: "evacuee" }}
    >
      <CapsuleCollider args={[0.5, 0.32] as [number, number]} />
      <group ref={visual} position={[0, -0.85, 0]} visible={!eyes}>
        <Student hasBackpack={hasBackpack} heldItem={equipped} />
        <ContactShade />
        {!ownCamera && <HeadingBeacon />}
      </group>
      {!ownCamera && (
        <group position={[0, 0, 0]}>
          <NeonBox
            position={[0, 0.95, 0]}
            size={[0.85, 1.9, 0.55]}
            color={air <= 0 ? "#ef4444" : "#38bdf8"}
            opacity={0.07}
          />
          <Label
            position={[0, 2.25, 0]}
            color={air <= 0 ? "#ef4444" : "#38bdf8"}
            text={air <= 0 ? "Evacuee (down)" : "Evacuee"}
          />
        </group>
      )}
    </RigidBody>
  );
}

function RemoteEvacuee() {
  const group = useRef<THREE.Group>(null);
  const hasBackpack = useSimulation((state) => state.hasBackpack);
  const equipped = useSimulation((state) => state.equipped);
  useFrame((_, rawDt) => {
    const current = runtime.netEvacuee;
    const target = group.current;
    if (!target) return;
    target.visible = !!current;
    if (!current) return;
    const factor = Math.min(1, clampDt(rawDt) * 9);
    runtime.evacuee.lerp(new THREE.Vector3(current.x, current.y, current.z), factor);
    runtime.evacueeYaw +=
      (((current.yaw - runtime.evacueeYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * factor;
    target.position.set(runtime.evacuee.x, runtime.evacuee.y - 0.85, runtime.evacuee.z);
    target.rotation.y = runtime.evacueeYaw;
  });

  return (
    <group ref={group} visible={false}>
      <Student hasBackpack={hasBackpack} heldItem={equipped} />
      <ContactShade />
      <HeadingBeacon />
      <NeonBox position={[0, 0.95, 0]} size={[0.85, 1.9, 0.55]} color="#38bdf8" opacity={0.07} />
      <Label position={[0, 2.25, 0]} color="#38bdf8" text="Evacuee" />

    </group>
  );
}

export default function Evacuee() {
  const ownsSimulation = useIsSimulationOwner();
  return ownsSimulation ? <LocalEvacuee /> : <RemoteEvacuee />;
}
