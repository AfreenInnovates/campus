"use client";

import { useEffect } from "react";
import { pressUse } from "./controls";
import { clampDt, runtime } from "./runtime";
import { resetSimulationRuntime, stepSimulation } from "./simulation-loop";
import { useSimulation } from "./store";

const KEY_TO_INPUT = {
  KeyW: "forward",
  ArrowUp: "forward",
  KeyS: "back",
  ArrowDown: "back",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  ShiftLeft: "sprint",
  ShiftRight: "sprint",
} as const;

type InputKey = keyof typeof runtime.keys;

export default function SimulationDriver() {
  const resetSeq = useSimulation((state) => state.resetSeq);

  useEffect(() => {
    resetSimulationRuntime();
  }, [resetSeq]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return;
      const input = KEY_TO_INPUT[event.code as keyof typeof KEY_TO_INPUT] as InputKey | undefined;
      if (input) runtime.keys[input] = true;
      if (event.code === "KeyE" && !event.repeat) pressUse();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const input = KEY_TO_INPUT[event.code as keyof typeof KEY_TO_INPUT] as InputKey | undefined;
      if (input) runtime.keys[input] = false;
    };
    const clear = () => {
      for (const key of Object.keys(runtime.keys) as InputKey[]) runtime.keys[key] = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clear);
      clear();
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const tick = (time: number) => {
      const dt = clampDt((time - last) / 1000);
      last = time;
      stepSimulation(dt);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return null;
}
