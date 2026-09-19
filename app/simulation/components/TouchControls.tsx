"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pressJump, pressUse } from "../controls";
import { runtime } from "../runtime";
import { useSimulation } from "../store";

/**
 * Phone controls for the evacuee: a stick on the left thumb, look on the right.
 *
 * Both halves write straight into `runtime`, which is where the simulation
 * already reads input from - nothing here re-renders React per frame. Each
 * surface tracks its own pointer id, so a thumb on the stick and a thumb on the
 * look pad do not steal each other's moves.
 */

const STICK_RADIUS = 56;
/** Fraction of the stick radius that counts as "sprint". */
const SPRINT_THRESHOLD = 0.85;

function Stick() {
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const sprinting = useRef(false);

  useEffect(() => {
    const el = base.current;
    if (!el) return;

    const setKnob = (dx: number, dy: number) => {
      if (knob.current)
        knob.current.style.transform = `translate(${dx}px, ${dy}px)`;
    };

    const move = (e: PointerEvent) => {
      if (pointer.current !== e.pointerId) return;
      const r = el.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2);
      let dy = e.clientY - (r.top + r.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > STICK_RADIUS) {
        dx = (dx / len) * STICK_RADIUS;
        dy = (dy / len) * STICK_RADIUS;
      }
      setKnob(dx, dy);
      // screen-down is "back", so y is inverted into forward/back
      runtime.touchMove.x = dx / STICK_RADIUS;
      runtime.touchMove.y = -dy / STICK_RADIUS;
      // pushing to the rim is the thumb's version of holding Shift, so sprinting needs no
      // second control competing for space next to the stick
      const pushed = Math.hypot(dx, dy) / STICK_RADIUS >= SPRINT_THRESHOLD;
      if (pushed !== sprinting.current) {
        sprinting.current = pushed;
        runtime.touchSprint = pushed;
        if (ring.current) ring.current.style.opacity = pushed ? "1" : "0";
      }
    };

    const end = (e: PointerEvent) => {
      if (pointer.current !== e.pointerId) return;
      pointer.current = null;
      runtime.touchMove.x = 0;
      runtime.touchMove.y = 0;
      runtime.touchSprint = false;
      sprinting.current = false;
      if (ring.current) ring.current.style.opacity = "0";
      setKnob(0, 0);
    };

    const start = (e: PointerEvent) => {
      pointer.current = e.pointerId;
      el.setPointerCapture(e.pointerId);
      move(e);
    };

    el.addEventListener("pointerdown", start);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    return () => {
      el.removeEventListener("pointerdown", start);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      runtime.touchMove.x = 0;
      runtime.touchMove.y = 0;
      runtime.touchSprint = false;
    };
  }, []);

  return (
    <div
      ref={base}
      aria-label="Move"
      className="pointer-events-auto relative grid h-[132px] w-[132px] touch-none place-items-center rounded-full border-2 border-white/25 bg-black/35 backdrop-blur-sm"
    >
      <div className="absolute inset-3 rounded-full border border-white/10" />
      <div
        ref={ring}
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full border-2 border-sun opacity-0 transition-opacity duration-150"
      />
      <div
        ref={knob}
        className="h-14 w-14 rounded-full border-2 border-sun bg-sun/25"
      />
      <span className="pointer-events-none absolute -top-5 text-[9px] font-black uppercase tracking-[0.18em] text-white/45">
        move
      </span>
      <span className="pointer-events-none absolute -bottom-5 text-[9px] font-black uppercase tracking-[0.18em] text-white/40">
        push to run
      </span>
    </div>
  );
}

/** Everything not under a control is a look surface. */
function LookPad() {
  const pad = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const last = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const el = pad.current;
    if (!el) return;

    const start = (e: PointerEvent) => {
      if (pointer.current !== null) return;
      pointer.current = e.pointerId;
      last.current = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (pointer.current !== e.pointerId) return;
      runtime.touchLook.dx += e.clientX - last.current.x;
      runtime.touchLook.dy += e.clientY - last.current.y;
      last.current = { x: e.clientX, y: e.clientY };
    };
    const end = (e: PointerEvent) => {
      if (pointer.current !== e.pointerId) return;
      pointer.current = null;
    };

    el.addEventListener("pointerdown", start);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    return () => {
      el.removeEventListener("pointerdown", start);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
    };
  }, []);

  return (
    <div
      ref={pad}
      aria-label="Look around"
      className="pointer-events-auto absolute inset-0 touch-none"
    />
  );
}

function ActionButton({
  label,
  hint,
  color,
  onPress,
}: {
  label: string;
  hint?: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <button
      onPointerDown={(e) => {
        e.preventDefault();
        onPress();
      }}
      className="pointer-events-auto grid h-[74px] w-[74px] touch-none place-items-center rounded-full border-2 bg-black/45 backdrop-blur-sm active:scale-95"
      style={{ borderColor: color }}
    >
      <span
        className="text-[11px] font-black uppercase tracking-[0.08em]"
        style={{ color }}
      >
        {label}
      </span>
      {hint && (
        <span className="text-[8px] font-bold uppercase tracking-wider text-white/50">
          {hint}
        </span>
      )}
    </button>
  );
}

export default function TouchControls() {
  const prompt = useSimulation((s) => s.prompt);
  const air = useSimulation((s) => s.air);
  const health = useSimulation((s) => s.health);
  const failed = useSimulation((s) => s.failed);
  const assemblyConfirmed = useSimulation((s) => s.assemblyConfirmed);
  const briefingStatus = useSimulation((s) => s.briefingStatus);
  const paused = useSimulation((s) => s.paused);
  const cameraMode = useSimulation((s) => s.cameraMode);
  const toggleCameraMode = useSimulation((s) => s.toggleCameraMode);
  // only label the interact button with what it would actually do
  const [action, setAction] = useState<string | null>(null);

  const observer = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => {
      setAction(runtime.useTarget?.kind ?? null);
    }, 200);
    return () => window.clearInterval(id);
  }, []);

  // Publish the real control height instead of hard-coding it. The old fixed offsets were
  // measured on one tall phone and pushed the prompt off the top of a 360x640 screen.
  //
  // A callback ref rather than useEffect: this component returns null until the briefing
  // finishes, so an effect with an empty dependency list runs while the dock does not exist
  // yet and would never see it appear.
  const dock = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) {
      document.documentElement.style.removeProperty("--touch-dock-h");
      return;
    }
    const publish = () =>
      document.documentElement.style.setProperty(
        "--touch-dock-h",
        `${Math.round(node.getBoundingClientRect().height)}px`,
      );
    publish();
    observer.current = new ResizeObserver(publish);
    observer.current.observe(node);
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  if (briefingStatus !== "complete" || paused || air <= 0 || health <= 0 || failed || assemblyConfirmed) return null;
  const assemblyHere = action === "assembly";

  return (
    <div className="pointer-events-none absolute inset-0 z-20 select-none">
      <LookPad />

      {/* the prompt sits above the thumbs where it can be read mid-move */}
      {prompt && (
        <div className="above-dock pointer-events-none absolute inset-x-0 flex justify-center px-4">
          <div className="border-2 border-ink bg-paper px-3 py-1.5 text-center text-[12px] font-bold text-ink shadow-[3px_3px_0_var(--ink)]">
            {prompt}
          </div>
        </div>
      )}

      {/* one dock, measured, so nothing downstream has to guess how tall the controls are */}
      <div ref={dock} className="safe-bottom safe-x absolute inset-x-0 bottom-0 flex items-end justify-between">
        <Stick />

        <div className="flex flex-col items-end gap-3">
          <ActionButton
            label="CAM"
            hint={cameraMode === "third" ? "first" : "third"}
            color="#c9b8ff"
            onPress={toggleCameraMode}
          />
          <ActionButton
            label="E"
            hint="use"
            color={action === "intervention" ? "#7b5cff" : action === "scenario" ? "#ffc44d" : "#9a8fa3"}
            onPress={pressUse}
          />
          <ActionButton
            label={assemblyHere ? "READY" : "JUMP"}
            hint={assemblyHere ? "assembly" : undefined}
            color={assemblyHere ? "#2fd18f" : "#ffc44d"}
            onPress={pressJump}
          />
        </div>
      </div>
    </div>
  );
}
