"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The depth effects on the landing page.
 *
 * All three write CSS custom properties and let the compositor do the rest — no layout is
 * ever read during a pointer move, and nothing re-renders React. Each one bails out
 * completely under `prefers-reduced-motion`, and on coarse pointers where there is no
 * cursor to track and a tilt would only cost battery.
 */

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const coarsePointer = () =>
  typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

/**
 * Publishes the pointer position, as -1..1 from the centre, to every `.depth-layer` inside.
 * Layers pick how far they drift with `--depth`, so the mascot, the screen and the
 * background move at different rates and read as separate planes.
 */
export function DepthScene({ children, className = "" }: { children: ReactNode; className?: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = host.current;
    if (!node || reducedMotion() || coarsePointer()) return;

    let frame = 0;
    let x = 0;
    let y = 0;

    const apply = () => {
      frame = 0;
      node.style.setProperty("--pointer-x", x.toFixed(3));
      node.style.setProperty("--pointer-y", y.toFixed(3));
    };

    const onMove = (event: PointerEvent) => {
      // viewport-relative on purpose: the whole scene should answer to the cursor, not just
      // the part of it the pointer happens to be over
      x = (event.clientX / window.innerWidth) * 2 - 1;
      y = (event.clientY / window.innerHeight) * 2 - 1;
      frame ||= requestAnimationFrame(apply);
    };

    const onLeave = () => {
      x = 0;
      y = 0;
      frame ||= requestAnimationFrame(apply);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={host} className={`depth-scene ${className}`}>
      {children}
    </div>
  );
}

/** A card that leans toward the cursor while it is over it, shadow swinging the other way. */
export function Tilt({
  children,
  className = "",
  max = 7,
}: {
  children: ReactNode;
  className?: string;
  max?: number;
}) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = host.current;
    if (!node || reducedMotion() || coarsePointer()) return;

    let frame = 0;
    let x = 0;
    let y = 0;
    let lift = 0;

    const apply = () => {
      frame = 0;
      node.style.setProperty("--tilt-x", x.toFixed(3));
      node.style.setProperty("--tilt-y", y.toFixed(3));
      node.style.setProperty("--tilt-lift", lift.toFixed(3));
    };

    const onMove = (event: PointerEvent) => {
      const box = node.getBoundingClientRect();
      x = ((event.clientX - box.left) / box.width) * 2 - 1;
      y = ((event.clientY - box.top) / box.height) * 2 - 1;
      lift = 1;
      frame ||= requestAnimationFrame(apply);
    };

    const onLeave = () => {
      x = 0;
      y = 0;
      lift = 0;
      frame ||= requestAnimationFrame(apply);
    };

    node.addEventListener("pointermove", onMove, { passive: true });
    node.addEventListener("pointerleave", onLeave);
    return () => {
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerleave", onLeave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={host} className={`tilt ${className}`} style={{ "--tilt-max": `${max}deg` } as React.CSSProperties}>
      {children}
    </div>
  );
}

/**
 * Fades and lifts its children into place the first time they scroll into view, then stops
 * observing. `delay` staggers a row so items arrive in sequence rather than as a block.
 */
export function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    if (reducedMotion()) {
      node.classList.add("is-visible");
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        node.classList.add("is-visible");
        observer.disconnect(); // one-shot: nothing re-hides on the way back up
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.1 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={host} className={`reveal ${className}`} style={{ "--reveal-delay": `${delay}ms` } as React.CSSProperties}>
      {children}
    </div>
  );
}
