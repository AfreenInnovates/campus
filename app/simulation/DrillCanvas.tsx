"use client";

import { Suspense, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { KeyboardControls } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import Building from "./components/Building";
import Exterior from "./components/Exterior";
import Rooms from "./components/Rooms";
import Interactables from "./components/Interactables";
import Evacuee from "./components/Evacuee";
import Systems from "./components/Systems";
import NetSync from "./components/NetSync";
import ViewRig from "./components/ViewRig";
import { useIsSimulationOwner } from "./store";

const MAP = [
  { name: "forward", keys: ["ArrowUp", "KeyW"] },
  { name: "back", keys: ["ArrowDown", "KeyS"] },
  { name: "left", keys: ["ArrowLeft", "KeyA"] },
  { name: "right", keys: ["ArrowRight", "KeyD"] },
  { name: "sprint", keys: ["ShiftLeft", "ShiftRight"] },
  { name: "use", keys: ["KeyE"] },
  { name: "jump", keys: ["Space"] },
  { name: "camera", keys: ["KeyV"] },
];

/**
 * Space is the jump key, and the browser has its own ideas about it: it scrolls
 * the page, and if the player last clicked a HUD button it re-presses that
 * button. Swallow it over the drill canvas, but leave it alone in a text field.
 */
function useSpaceForJumpOnly() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el?.isContentEditable
      )
        return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

export default function DrillCanvas() {
  const ownsSimulation = useIsSimulationOwner();
  useSpaceForJumpOnly();

  return (
    <KeyboardControls map={MAP}>
      <Canvas
        shadows="soft"
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        style={{ position: "absolute", inset: 0 }}
      >
        <Suspense fallback={null}>
          <ViewRig />
          {/* Only the evacuee/solo client steps physics; the warden receives a marker. */}
          <Physics gravity={[0, -18, 0]} paused={!ownsSimulation}>
            <Exterior />
            <Building />
            <Rooms />
            <Interactables />
            <Evacuee />
            {ownsSimulation && <Systems />}
          </Physics>
          <NetSync />
        </Suspense>
      </Canvas>
    </KeyboardControls>
  );
}
