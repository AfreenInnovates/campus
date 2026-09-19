"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent, type ReactNode } from "react";
import Minimap from "./components/Minimap";
import TouchControls from "./components/TouchControls";
import { useCoarsePointer } from "./useCoarsePointer";
import {
  CRITICAL_SCENARIO_OBJECTS,
  nextScenarioGuidance,
  roomById,
  scenarioObjectById,
  type ScenarioObjectId,
} from "./level";
import { playSignal } from "./audio";
import BriefingArtwork from "./components/BriefingArtwork";
import {
  ALL_CLIP_IDS,
  EVACUEE_BRIEFING,
  briefingCue,
  loadBedrockBriefing,
  primeLive,
  primeNarration,
  readVoiceEnabled,
  situationCue,
  speakNarration,
  stopNarration,
  writeVoiceEnabled,
} from "./narration";
import { bucketAir, bucketSmoke, type DrillContext, type DrillEvent } from "./narration-context";
import { runtime } from "./runtime";
import { resolveRoom, useSession } from "./session";
import { drillSummary, useSimulation, watchedSector, VIEWS, type ViewMode } from "./store";
import { RECONNECT_GRACE_MS, type EvidenceStatus, type RouteMessage } from "./net/types";

const DrillCanvas = dynamic(() => import("./DrillCanvas"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center text-xs font-black uppercase tracking-[0.3em] text-paper/60">
      Loading the Science Block...
    </div>
  ),
});

const STEPS: ScenarioObjectId[] = [...CRITICAL_SCENARIO_OBJECTS, "main-exit"];
const placeName = (id: ScenarioObjectId) => roomById(scenarioObjectById(id).room).name.split(" / ").pop();

/* ------------------------------------------------------------------ pieces */

function Key({ children, light = false, small = false }: { children: ReactNode; light?: boolean; small?: boolean }) {
  const style: CSSProperties = {
    ...(light ? { borderColor: "var(--ink)", background: "var(--night)", color: "var(--paper)" } : null),
    ...(small ? { height: "1.2rem", minWidth: "1.2rem", fontSize: "0.58rem", padding: "0 0.25rem" } : null),
  };
  return (
    <kbd className="hud-key" style={style}>
      {children}
    </kbd>
  );
}

function Bar({ label, value, color, danger }: { label: string; value: number; color: string; danger?: boolean }) {
  const fill = danger ? "var(--danger)" : color;
  return (
    <div className="w-40">
      <div className="mb-1 flex items-center justify-between text-[10px] font-black uppercase tracking-[0.16em] text-paper/75">
        <span>{label}</span>
        <span className="font-mono" style={{ color: fill }}>
          {Math.round(value)}
        </span>
      </div>
      <div className="h-2.5 w-full border border-paper/25 bg-black/40">
        <div className="h-full transition-[width] duration-150" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: fill }} />
      </div>
    </div>
  );
}

function statusColor(status: EvidenceStatus) {
  return status === "VERIFIED"
    ? "var(--mint)"
    : status === "OBSERVED"
      ? "var(--sun)"
      : status === "STALE" || status === "EXPIRED"
        ? "var(--coral)"
        : "var(--violet)";
}

function LocationHeader({ tag }: { tag: string }) {
  const sector = useSimulation((state) => state.sector);
  const parts = roomById(sector).name.split(" / ");
  const block = parts.length > 1 ? parts[0] : "Campus";
  const place = parts[parts.length - 1];
  return (
    <div className="pointer-events-auto">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center border-2 border-ink bg-coral text-[10px] font-black text-ink shadow-[2px_2px_0_var(--ink)]">CE</span>
        <span className="text-lg font-black tracking-[-0.04em] text-paper [text-shadow:2px_2px_0_var(--ink)]">CampusEvac</span>
        <span className="hidden border border-paper/30 bg-night/70 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-paper/75 sm:inline">{tag}</span>
      </div>
      <div className="mt-1.5 inline-flex max-w-full items-center gap-2 bg-night/70 px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em]">
        <span className="text-sun">{block}</span>
        <span className="text-paper/35">|</span>
        <span className="truncate text-paper">{place}</span>
      </div>
    </div>
  );
}

function ObjectivesPanel() {
  const progress = useSimulation((state) => state.scenarioProgress);
  const guidance = nextScenarioGuidance(progress);
  const done = CRITICAL_SCENARIO_OBJECTS.filter((id) => progress[id]).length;
  return (
    <section className="hud-panel pointer-events-auto w-[min(19.5rem,calc(100vw-1.5rem))] p-3" aria-label="Objectives">
      <div className="flex items-center justify-between border-b border-paper/15 pb-2">
        <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-sun">Objectives</h2>
        <span className="font-mono text-[10px] text-paper/60">
          {done}/{CRITICAL_SCENARIO_OBJECTS.length} done
        </span>
      </div>
      <ol className="mt-2 space-y-1.5">
        {STEPS.map((id) => {
          const complete = progress[id];
          const current = guidance.id === id;
          return (
            <li key={id} className={`${current ? "flex" : "hidden sm:flex"} items-start gap-2 text-[12px] leading-snug`}>
              <span
                className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center border-2 text-[9px] font-black ${
                  complete ? "border-mint bg-mint text-ink" : current ? "border-sun text-sun" : "border-paper/30 text-transparent"
                }`}
                aria-hidden
              >
                {complete ? "✓" : current ? "›" : ""}
              </span>
              <div className="min-w-0">
                <div className={complete ? "text-paper/40 line-through decoration-paper/30" : current ? "font-bold text-paper" : "text-paper/70"}>
                  {scenarioObjectById(id).label}
                  <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider text-paper/40">{placeName(id)}</span>
                </div>
                {current && <p className="mt-1 text-[11px] leading-snug text-sun">{guidance.instruction}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Vitals() {
  const health = useSimulation((state) => state.health);
  const air = useSimulation((state) => state.air);
  const cameraMode = useSimulation((state) => state.cameraMode);
  return (
    <div className="hud-panel flex flex-col gap-2 p-3" style={{ borderLeftColor: "var(--mint)" }}>
      <Bar label="Health" value={health} color="var(--mint)" danger={health < 35} />
      <Bar label="Air" value={air} color="#6fb8ff" danger={air < 35} />
      <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-paper/45">
        Camera: {cameraMode === "third" ? "over the shoulder" : "first person"}
      </div>
    </div>
  );
}

function PromptBar() {
  const prompt = useSimulation((state) => state.prompt);
  if (!prompt) return null;
  const action = prompt.match(/^Press E to (.+)$/);
  return (
    <div key={prompt} className="hud-rise flex max-w-[min(34rem,calc(100vw-2rem))] items-center gap-2 border-2 border-ink bg-paper px-3 py-2 text-[13px] font-bold text-ink shadow-[4px_4px_0_var(--ink)]">
      {action ? (
        <>
          Press <Key light>E</Key> to {action[1]}
        </>
      ) : (
        <>
          <span className="bg-coral px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest">Heads up</span>
          {prompt}
        </>
      )}
    </div>
  );
}

function ControlsHint() {
  const items: [string, string][] = [
    ["WASD", "move"],
    ["Shift", "sprint"],
    ["Space", "jump"],
    ["E", "interact"],
    ["V", "camera"],
    ["Esc", "menu"],
  ];
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-night/60 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-paper/70">
      {items.map(([key, label]) => (
        <span key={key} className="flex items-center gap-1.5">
          <Key small>{key}</Key>
          {label}
        </span>
      ))}
    </div>
  );
}

/** Spoken and captioned lines when a room is first entered or a step is completed. */
function NarrationCaption() {
  const mode = useSimulation((state) => state.mode.kind);
  const [caption, setCaption] = useState<{ id: number; text: string } | null>(null);

  useEffect(() => {
    if (mode === "warden") return;
    // ~840KB for the whole script: pull it once up front so no line ever waits on a fetch
    primeNarration(ALL_CLIP_IDS);
    let seq = 0;
    let timer: number | undefined;
    const say = (context: DrillContext) => {
      const id = ++seq;
      const cue = situationCue(context);
      window.clearTimeout(timer);
      // caption first: composed locally, so it lands the instant the event does and never
      // waits on the voice, which arrives a few hundred milliseconds later
      setCaption({ id, text: cue.text });
      speakNarration(cue, () => {
        timer = window.setTimeout(() => setCaption((current) => (current?.id === id ? null : current)), 1500);
      });
    };
    /** What the narrator can see right now, bucketed so repeated readings reuse one clip. */
    const situation = (state: ReturnType<typeof useSimulation.getState>, event: DrillEvent): DrillContext => ({
      event,
      progress: state.scenarioProgress,
      airPercent: bucketAir(state.air),
      smokeLevel: bucketSmoke(state.smokeIntensity),
      routeStatus: state.routeStatus,
    });
    const unsubscribe = useSimulation.subscribe((state, previous) => {
      if (state.briefingStatus !== "complete" || state.resetSeq !== previous.resetSeq) return;
      const finished = STEPS.find((id) => state.scenarioProgress[id] && !previous.scenarioProgress[id]);
      if (finished) {
        say(situation(state, { kind: "objective", objective: finished }));
        return;
      }
      if (state.sector !== previous.sector && !previous.explored[state.sector]) {
        say(situation(state, { kind: "room", sector: state.sector }));
        return;
      }
      // the objective tells us which room the evacuee is heading for, so render that line
      // now and the voice is already decoded when they walk through the door
      if (state.sector !== previous.sector) {
        const heading = nextScenarioGuidance(state.scenarioProgress);
        if (heading.id !== "complete" && !state.explored[heading.room]) {
          primeLive(situation(state, { kind: "room", sector: heading.room }));
        }
      }
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, [mode]);

  if (!caption) return null;
  return (
    <div key={caption.id} className="hud-rise max-w-[min(40rem,calc(100vw-2rem))] bg-night/85 px-4 py-2.5 text-center text-[14px] leading-snug text-paper" role="status" aria-live="polite">
      <span className="mr-2 text-[10px] font-black uppercase tracking-[0.2em] text-sun">Narrator</span>
      {caption.text}
    </div>
  );
}

/* ------------------------------------------------------------ warden panels */

/** Read-only sector feed. Every warden action lives in the command deck instead. */
function EvidencePanel() {
  const mode = useSimulation((state) => state.mode);
  const view = useSimulation((state) => state.view);
  const evidenceMap = useSimulation((state) => state.evidence);
  const evidence = Object.values(evidenceMap);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (view === "evacuee" || (mode.kind !== "warden" && evidence.length === 0)) return null;

  return (
    <div className="hud-panel pointer-events-auto w-[min(19rem,calc(100vw-1.5rem))] p-3">
      <div className="flex items-baseline justify-between border-b border-paper/15 pb-2">
        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-sun">Sector feed</span>
        <span className="font-mono text-[10px] text-paper/50">{evidence.length}</span>
      </div>
      {evidence.length === 0 ? (
        <p className="mt-3 text-[11px] text-paper/55">Waiting for the sector feed.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {evidence.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2">
              <span className="truncate text-[11px] text-paper/80">{item.label}</span>
              <span className="flex shrink-0 items-center gap-2 font-mono text-[9px]">
                <span className="text-paper/40">
                  {item.observedAt ? `${Math.max(0, Math.floor((now - item.observedAt) / 1000))}s` : "--"}
                </span>
                <span className="font-black" style={{ color: statusColor(item.status) }}>
                  {item.status}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Log() {
  const log = useSimulation((state) => state.log);
  if (!log.length) return null;
  return (
    <div className="hud-panel w-[min(20rem,calc(100vw-1.5rem))] p-3">
      <div className="mb-2 flex items-center justify-between border-b border-paper/15 pb-2 text-[9px] font-black uppercase tracking-[0.18em] text-paper/55">
        <span>Drill log</span>
        <span>{log.length}/6</span>
      </div>
      <div className="space-y-1.5 text-right">
        {log.map((entry, index) => (
          <div
            key={entry.id}
            className="border-b border-paper/5 pb-1.5 text-[11px] leading-snug last:border-0 last:pb-0"
            style={{
              color: entry.tone === "bad" ? "var(--danger)" : entry.tone === "good" ? "var(--mint)" : "rgba(248,242,234,0.7)",
              opacity: 1 - index * 0.1,
            }}
          >
            {entry.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function ConnectionBadge() {
  const status = useSession((state) => state.status);
  const label = status === "connected" ? "Live" : status === "connecting" ? "Connecting" : status === "idle" ? "Offline practice" : status;
  const color = status === "connected" ? "var(--mint)" : status === "idle" ? "var(--violet)" : "var(--sun)";
  return (
    <span className="flex items-center gap-1.5 bg-night/70 px-2 py-1.5 font-mono text-[9px] font-bold uppercase" style={{ color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function RouteMessageCard() {
  const mode = useSimulation((state) => state.mode);
  const message = useSimulation((state) => state.latestMessage);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);
  if (mode.kind !== "evacuee" || !message || message.expiresAt <= now) return null;
  return (
    <div className="hud-rise max-w-[min(30rem,calc(100vw-1.5rem))] border-2 border-mint bg-night/95 px-4 py-3 shadow-[5px_5px_0_var(--mint)]" role="status" aria-live="polite">
      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-mint">Message from the warden · {message.confidence}</div>
      <div className="mt-1 text-sm font-black uppercase text-paper">{message.caption}</div>
      <div className="mt-0.5 text-[10px] text-paper/55">Disappears in {Math.ceil((message.expiresAt - now) / 1000)}s · you choose the route</div>
    </div>
  );
}

function HazardBanner() {
  const mode = useSimulation((state) => state.mode);
  const air = useSimulation((state) => state.air);
  const smoke = useSimulation((state) => state.smokeIntensity);
  const routeStatus = useSimulation((state) => state.routeStatus);
  const failed = useSimulation((state) => state.failed);
  const complete = useSimulation((state) => state.assemblyConfirmed);
  const previous = useRef<string | null>(null);
  const warden = mode.kind === "warden";
  const alert = complete
    ? null
    : failed
      ? { label: "Drill ended", detail: "See the debrief to try again.", color: "var(--danger)" }
      : air <= 30
        ? { label: "Air getting thin", detail: "Leave the smoke. Head for a clear room.", color: "var(--danger)" }
        : routeStatus === "unsafe" && warden
          ? { label: "East passage unsafe", detail: "Verify the evidence, then send the west route.", color: "var(--danger)" }
          : smoke > 0.2 && !warden
            ? { label: "Smoke in this area", detail: "Keep moving and watch for warden messages.", color: "var(--coral)" }
            : null;
  const alertLabel = alert?.label ?? null;
  useEffect(() => {
    if (alertLabel && previous.current !== alertLabel) playSignal("alert");
    previous.current = alertLabel;
  }, [alertLabel]);
  if (!alert) return null;
  return (
    <div className="flex max-w-[min(26rem,calc(100vw-1.5rem))] items-center gap-3 border-2 bg-night/90 px-4 py-2.5 shadow-[4px_4px_0_rgba(0,0,0,0.5)]" style={{ borderColor: alert.color }} role="status" aria-live="polite">
      <span className="signal-pulse h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: alert.color }} />
      <div>
        <div className="text-[11px] font-black uppercase tracking-[0.17em]" style={{ color: alert.color }}>
          {alert.label}
        </div>
        <div className="mt-0.5 text-[11px] text-paper/80">{alert.detail}</div>
      </div>
    </div>
  );
}

/**
 * The warden's only set of controls: observe, verify, then act.
 *
 * Every action starts locked because the sector evidence starts UNKNOWN, so each tile
 * carries the reason it is not available yet. Without that the deck reads as broken.
 */
function CommandDeck() {
  const mode = useSimulation((state) => state.mode);
  const evidence = useSimulation((state) => state.evidence["east-route-evidence"]);
  const interventionApplied = useSimulation((state) => state.interventionApplied);
  const scenarioProgress = useSimulation((state) => state.scenarioProgress);
  const lastAcknowledgement = useSimulation((state) => state.lastAcknowledgement);
  const sendCommand = useSession((state) => state.sendCommand);
  const observeEvidence = useSession((state) => state.observeEvidence);
  const guidance = nextScenarioGuidance(scenarioProgress);
  const [sent, setSent] = useState<string | null>(null);
  if (mode.kind !== "warden") return null;

  const status = evidence?.status ?? null;
  const observed = status === "OBSERVED";
  const verified = status === "VERIFIED";

  const act = (key: string, run: () => void) => () => {
    run();
    setSent(key);
    playSignal("command");
    window.setTimeout(() => setSent((current) => (current === key ? null : current)), 900);
  };

  const steps = [
    {
      key: "OBSERVE",
      label: "Observe",
      ready: status === "UNKNOWN",
      hint: "Read the sector sensor.",
      locked: evidence ? "Already read" : "Waiting for the feed",
      color: "#facc15",
      run: act("OBSERVE", () => evidence && observeEvidence(evidence.id)),
    },
    {
      key: "VERIFY_EAST_ROUTE",
      label: "Verify",
      ready: observed,
      hint: "Confirm it before you act.",
      locked: verified ? "Confirmed" : "Observe first",
      color: "#10b981",
      run: act("VERIFY_EAST_ROUTE", () => sendCommand("VERIFY_EAST_ROUTE", "east-route-evidence")),
    },
    {
      key: "SEND_WEST_ROUTE",
      label: "Send route",
      ready: verified,
      hint: "Send them west, away from the block.",
      locked: "Verify first",
      color: "#38bdf8",
      run: act("SEND_WEST_ROUTE", () => sendCommand("SEND_WEST_ROUTE", "east-route-evidence")),
    },
    {
      key: "APPLY_VENTILATION",
      label: "Clear smoke",
      ready: verified && !interventionApplied,
      hint: "One ventilation override.",
      locked: interventionApplied ? "Already used" : "Verify first",
      color: "#a78bfa",
      run: act("APPLY_VENTILATION", () => sendCommand("APPLY_VENTILATION")),
    },
  ];

  return (
    <div className="hud-panel w-full p-2.5 sm:w-[min(36rem,calc(100vw-1.5rem))]">
      <div className="flex items-center justify-between gap-3 border-b border-paper/15 pb-1.5">
        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-sun">Warden commands</span>
        <span className="font-mono text-[9px] text-paper/50">{status ? status.toLowerCase() : "no feed"}</span>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        {steps.map((item, index) => (
          <button
            key={item.key}
            disabled={!item.ready}
            onClick={item.run}
            title={item.ready ? item.hint : item.locked}
            className="min-w-0 border-2 border-paper/15 bg-night/60 px-1.5 py-2 text-left transition enabled:hover:border-paper/60 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ borderLeftColor: item.color, borderLeftWidth: 4 }}
          >
            <span className="flex items-baseline gap-1.5">
              <span className="font-mono text-[9px] text-paper/40">{index + 1}</span>
              <span
                className="truncate font-mono text-[10px] font-black"
                style={{ color: item.ready ? item.color : "var(--paper)" }}
              >
                {sent === item.key ? "SENT" : item.label}
              </span>
            </span>
            <span className="mt-0.5 block truncate text-[9px] text-paper/50">
              {item.ready ? item.hint : item.locked}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 border-t border-paper/15 pt-1.5 text-[10px]">
        <span className="truncate text-paper/65">
          Next: <b className="text-paper">{guidance.label}</b>{" "}
          <span className="font-mono text-[9px] uppercase text-paper/45">/ {roomById(guidance.room).name}</span>
        </span>
        {lastAcknowledgement && !lastAcknowledgement.accepted && (
          <span className="shrink-0 font-mono text-[9px] font-black text-danger">
            {lastAcknowledgement.reason ?? "denied"}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Collapses a warden panel down to a toggle on a phone.
 *
 * Stacked, the evidence panel and the log push the minimap and the command deck off a 400px
 * screen entirely. On a desktop they stay exactly as they were.
 */
function PhoneCollapsible({ label, children }: { label: string; children: ReactNode }) {
  const touch = useCoarsePointer();
  const [open, setOpen] = useState(false);
  if (!touch) return <>{children}</>;
  return (
    <div className="pointer-events-auto flex flex-col items-end gap-2">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex items-center gap-2 border-2 border-paper/30 bg-night/85 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-paper"
      >
        {label}
        <span aria-hidden className="text-sun">{open ? "–" : "+"}</span>
      </button>
      {open && children}
    </div>
  );
}

/* --------------------------------------------------------------- overlays */

function formatTime(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

type Verdict = { verified: boolean; reasons: string[] };

/**
 * Advisory badge on the end card.
 *
 * Checks the finished drill against its own recorded history. It never changes the result
 * and never explains itself when the check could not run: if AWS is not configured, the
 * query fails or the route is slow, this renders nothing at all rather than accusing a
 * player of cheating because of an infrastructure problem.
 */
function VerificationBadge({ code }: { code: string | null }) {
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  useEffect(() => {
    if (!code) return;
    const abort = new AbortController();
    // a slow check is a check that did not happen; the end screen never waits on it
    const giveUp = window.setTimeout(() => abort.abort(), 6_000);
    fetch(`/api/verify/${code}`, { signal: abort.signal })
      .then((response) => (response.ok ? (response.json() as Promise<Verdict>) : null))
      .then((value) => {
        if (value && typeof value.verified === "boolean") setVerdict(value);
      })
      .catch(() => {
        /* unavailable is not a finding */
      })
      .finally(() => window.clearTimeout(giveUp));
    return () => {
      window.clearTimeout(giveUp);
      abort.abort();
    };
  }, [code]);

  if (!verdict) return null;
  return (
    <div
      className={`mt-5 border-2 border-ink p-3 ${verdict.verified ? "bg-mint/25" : "bg-coral/25"}`}
      role="status"
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 border-2 border-ink"
          style={{ background: verdict.verified ? "var(--mint)" : "var(--coral)" }}
          aria-hidden
        />
        <span className="text-[11px] font-black uppercase tracking-[0.16em]">
          {verdict.verified ? "Verified against the drill record" : "Unverified"}
        </span>
      </div>
      {!verdict.verified && (
        <ul className="mt-2 space-y-1 pl-4 text-[11px] leading-relaxed text-ink-soft">
          {verdict.reasons.map((reason) => (
            <li key={reason} className="list-disc">
              {reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type MailerStage = "idle" | "sending" | "verify" | "sent" | "error";

/** How long the end card keeps watching for the participant to confirm their address. */
const VERIFY_POLL_MS = 3_000;
const VERIFY_WINDOW_MS = 10 * 60_000;

/**
 * Emails the participant their own report.
 *
 * SES will not deliver to an unverified address while the account is in the sandbox, so an
 * unknown address is sent a confirmation link and the run is held server-side. This then
 * polls until it lands, which is why the wait is explained on screen rather than silent.
 */
function ReportMailer() {
  const warden = useSimulation((state) => state.mode.kind === "warden");
  const code = useSession((state) => state.code);
  const [email, setEmail] = useState("");
  const [stage, setStage] = useState<MailerStage>("idle");
  // A returning player is already verified, so the report goes out without the extra step.
  const [knownAddress, setKnownAddress] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const address = email.trim();

  useEffect(() => {
    if (stage !== "verify" || !address) return;
    const startedAt = Date.now();
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      if (Date.now() - startedAt > VERIFY_WINDOW_MS) {
        setTimedOut(true);
        return;
      }
      try {
        const response = await fetch(`/api/report/status?email=${encodeURIComponent(address)}`);
        const body = (await response.json().catch(() => ({}))) as { status?: string };
        if (!cancelled && body.status === "sent") {
          setKnownAddress(false);
          setStage("sent");
          return;
        }
      } catch {
        /* offline or a blip: the next tick tries again */
      }
      if (!cancelled) timer = window.setTimeout(poll, VERIFY_POLL_MS);
    };

    let timer = window.setTimeout(poll, VERIFY_POLL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [stage, address]);

  if (warden) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (stage === "sending" || !address) return;
    setStage("sending");
    setError(null);
    setTimedOut(false);
    try {
      const response = await fetch("/api/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: address, summary: drillSummary(code) }),
      });
      const body = (await response.json().catch(() => ({}))) as { status?: string; error?: string };
      if (response.ok && body.status === "sent") {
        setKnownAddress(true);
        setStage("sent");
      } else if (response.ok && body.status === "verify") setStage("verify");
      else {
        setStage("error");
        setError(body.error ?? "Could not send the report.");
      }
    } catch {
      setStage("error");
      setError("Could not reach the server. Check your connection.");
    }
  };

  if (stage === "sent")
    return (
      <div className="mt-5 border-2 border-ink bg-mint/25 px-3 py-2.5">
        <div className="text-[10px] font-black uppercase tracking-[0.16em]">
          {knownAddress ? "Address already verified - sending now" : "Verified - report sent"}
        </div>
        <p className="mt-0.5 text-[12px] leading-snug">
          {knownAddress ? "No confirmation needed this time. " : "Thanks for confirming. "}
          On its way to <b>{address}</b>. If it is not there in a minute, check spam.
        </p>
      </div>
    );

  if (stage === "verify")
    return (
      <div className="mt-5 border-2 border-ink bg-sun/25 px-3 py-2.5">
        <div className="text-[10px] font-black uppercase tracking-[0.16em]">One step first</div>
        <p className="mt-0.5 text-[12px] leading-snug">
          We sent a confirmation link to <b>{address}</b>. Open it, and your report arrives here within
          a few seconds. Keep this page open.
        </p>
        {timedOut ? (
          <button
            onClick={() => {
              setTimedOut(false);
              setStage("verify");
            }}
            className="mt-2 border-2 border-ink px-2.5 py-1 text-[10px] font-black uppercase tracking-wider"
          >
            Still waiting - check again
          </button>
        ) : (
          <div className="mt-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-ink-soft">
            <span className="inline-block h-2 w-2 animate-pulse bg-ink" aria-hidden />
            Waiting for confirmation
          </div>
        )}
      </div>
    );

  return (
    <form onSubmit={submit} className="mt-5 border-2 border-ink bg-paper-light p-3">
      <label htmlFor="report-email" className="block text-[10px] font-black uppercase tracking-[0.16em]">
        Email me this report
      </label>
      <p className="mt-0.5 text-[11px] leading-snug text-ink-soft">
        Your times, splits and what to practise next. Sent once, to this address only.
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          id="report-email"
          type="email"
          required
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            if (stage === "error") setStage("idle");
          }}
          placeholder="you@example.com"
          autoComplete="email"
          className="min-w-0 flex-1 border-2 border-ink bg-paper px-2.5 py-2 font-mono text-[13px] text-ink outline-none placeholder:text-ink-soft/60 focus:bg-white"
        />
        <button
          type="submit"
          disabled={stage === "sending"}
          className="brutal-button shrink-0 px-4 py-2 text-[12px] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {stage === "sending" ? "Sending..." : "Send report"}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 border-l-4 border-danger pl-2 text-[11px] leading-snug text-ink">
          {error}
        </p>
      )}
    </form>
  );
}

function EndCard({ onReset, onLeave, onHome }: { onReset: () => void; onLeave: () => void; onHome: () => void }) {
  const complete = useSimulation((state) => state.assemblyConfirmed);
  const failed = useSimulation((state) => state.failed);
  const solo = useSimulation((state) => state.mode.kind === "solo");
  const warden = useSimulation((state) => state.mode.kind === "warden");
  const routeStatus = useSimulation((state) => state.routeStatus);
  const interventionApplied = useSimulation((state) => state.interventionApplied);
  const latestMessage = useSimulation((state) => state.latestMessage);
  const progress = useSimulation((state) => state.scenarioProgress);
  const elapsed = useSimulation((state) => state.hazardElapsed);
  const health = useSimulation((state) => state.health);
  const reset = useSimulation((state) => state.reset);
  const room = useSession((state) => state.room);
  const code = useSession((state) => state.code);
  const abandoned = resolveRoom(room)?.outcome === "participant-left";
  if (!complete && !failed) return null;
  const done = CRITICAL_SCENARIO_OBJECTS.filter((id) => progress[id]).length;
  const coordination = abandoned
    ? "A participant disconnected and did not come back before the countdown ran out, so the drill was ended."
    : failed
    ? "The evacuee did not reach the exit before their air or health ran out."
    : latestMessage
      ? "A route message was delivered. Was it early enough to matter?"
      : "The drill finished without a route message from a warden.";
  const practice = interventionApplied
    ? "Verify the route evidence before applying the ventilation override."
    : routeStatus === "unsafe"
      ? "Decide on the alternate route earlier."
      : "Verify the evidence before sending a route message.";
  const debrief: [string, string, string][] = [
    [
      "Did we get out safely?",
      complete
        ? "Yes. The evacuee left through the marked exit."
        : abandoned
          ? "No. The drill ended when a participant dropped out mid-run."
          : "No. The drill ended before the exit.",
      "var(--mint)",
    ],
    ["Where did coordination slip?", coordination, "var(--sun)"],
    ["What do we practise next?", practice, "var(--violet)"],
  ];
  return (
    <div className="pointer-events-auto absolute inset-0 z-50 grid place-items-center overflow-y-auto bg-night/75 p-4 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" aria-labelledby="end-title" className="brutal-panel w-full max-w-lg p-5 text-ink sm:p-7">
        <span className={`brutal-tag ${complete ? "bg-mint" : "bg-coral"}`}>{complete ? "Drill complete" : "Drill ended"}</span>
        <h2 id="end-title" className="mt-3 text-4xl font-black uppercase leading-[0.95] tracking-[-0.05em]">
          {complete ? (warden ? "They got out safely." : "You got out safely.") : abandoned ? "A player did not return." : "Not this time."}
        </h2>
        <dl className="mt-5 grid grid-cols-3 border-2 border-ink bg-paper">
          {(
            [
              ["Time", formatTime(elapsed)],
              ["Steps", `${done}/${CRITICAL_SCENARIO_OBJECTS.length}`],
              ["Health", String(Math.round(health))],
            ] as const
          ).map(([label, value], index) => (
            <div key={label} className={`p-3 ${index ? "border-l-2 border-ink" : ""}`}>
              <dt className="text-[9px] font-black uppercase tracking-[0.18em] text-ink-soft">{label}</dt>
              <dd className="mt-1 font-mono text-2xl font-black">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-5 space-y-3">
          {debrief.map(([question, answer, color]) => (
            <div key={question} className="border-l-4 pl-3" style={{ borderColor: color }}>
              <div className="text-[10px] font-black uppercase tracking-[0.16em]">{question}</div>
              <div className="mt-0.5 text-sm text-ink-soft">{answer}</div>
            </div>
          ))}
        </div>
        {!solo && <VerificationBadge code={code} />}
        <ReportMailer />
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {solo ? (
            <button
              onClick={() => {
                reset();
                onReset();
              }}
              className="brutal-button px-4 py-3"
            >
              Play again
            </button>
          ) : (
            <button onClick={onLeave} className="brutal-button px-4 py-3">
              Back to lobby
            </button>
          )}
          <button onClick={onHome} className="brutal-button px-4 py-3" style={{ background: "var(--paper-light)" }}>
            Exit to home
          </button>
        </div>
      </section>
    </div>
  );
}

const noExternalStoreSubscribe = () => () => {};

function readOnboardingOpen() {
  try {
    return localStorage.getItem("campusevac:onboarding:v2") !== "complete";
  } catch {
    return true;
  }
}

function Onboarding() {
  const mode = useSimulation((state) => state.mode);
  const storedOpen = useSyncExternalStore(noExternalStoreSubscribe, readOnboardingOpen, () => false);
  const [dismissed, setDismissed] = useState(false);
  const open = storedOpen && !dismissed;
  if (!open) return null;
  const warden = mode.kind === "warden";
  const finish = () => {
    try {
      localStorage.setItem("campusevac:onboarding:v2", "complete");
    } catch {
      /* session-only dismissal */
    }
    window.dispatchEvent(new Event("start-briefing"));
    setDismissed(true);
  };
  return (
    <div className="pointer-events-auto absolute inset-0 z-50 grid place-items-center overflow-y-auto bg-night/70 p-4 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" aria-labelledby="onboarding-title" className="brutal-panel w-full max-w-xl p-5 text-ink sm:p-7">
        <span className="brutal-tag bg-sun">How to play</span>
        <h2 id="onboarding-title" className="mt-3 text-3xl font-black uppercase leading-[0.95] tracking-[-0.05em]">
          {warden ? "You see the danger. Talk them out." : "Six steps. Then get out."}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          {warden
            ? "You watch the evacuee's sector, check the evidence and send route messages. They cannot see the hazards you see."
            : "A short narrated briefing plays first. Your controls unlock when it ends. The steps stay on screen the whole time."}
        </p>
        {warden ? (
          <ol className="mt-5 grid gap-2 text-sm">
            {[
              ["Watch", "Follow the evacuee through your sector."],
              ["Observe", "Open Evidence and inspect what changed."],
              ["Verify", "Confirm it before you act on it."],
              ["Message", "Send one clear route message."],
            ].map(([title, detail], index) => (
              <li key={title} className="flex gap-3 border-2 border-ink bg-paper px-3 py-2">
                <span className="font-mono font-black text-coral">{index + 1}</span>
                <span>
                  <b className="uppercase">{title}.</b> {detail}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <ol className="space-y-1.5 text-sm">
              {STEPS.map((id, index) => (
                <li key={id} className="flex gap-2">
                  <span className="w-4 font-mono font-black text-coral">{index + 1}</span>
                  <span>
                    <b>{scenarioObjectById(id).label}</b> <span className="text-ink-soft">· {placeName(id)}</span>
                  </span>
                </li>
              ))}
            </ol>
            <div className="space-y-2 border-2 border-ink bg-paper p-3 text-[11px] font-bold uppercase tracking-wider">
              {(
                [
                  ["WASD", "Move"],
                  ["Shift", "Sprint"],
                  ["Space", "Jump"],
                  ["E", "Interact"],
                  ["V", "Switch camera"],
                  ["Esc", "Pause menu"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="flex items-center gap-2">
                  <Key light small>
                    {key}
                  </Key>
                  {label}
                </div>
              ))}
            </div>
          </div>
        )}
        <button onClick={finish} className="brutal-button mt-6 w-full px-4 py-3">
          {warden ? "Open warden station" : "Start the briefing"}
        </button>
      </section>
    </div>
  );
}

function Briefing() {
  const mode = useSimulation((state) => state.mode);
  const beginBriefing = useSimulation((state) => state.beginBriefing);
  const completeBriefing = useSimulation((state) => state.completeBriefing);
  const [line, setLine] = useState("");
  const [open, setOpen] = useState(false);
  const [slide, setSlide] = useState(0);
  const [lines, setLines] = useState(EVACUEE_BRIEFING);
  const [provider, setProvider] = useState<"bedrock" | "authored">("authored");
  const [voice, setVoice] = useState(true);
  const step = useRef(0);
  const run = useRef(0);

  useEffect(() => {
    if (mode.kind === "warden") return;
    let disposed = false;
    const start = () => {
      if (useSimulation.getState().briefingStatus === "playing") return;
      const token = ++run.current;
      const live = () => !disposed && run.current === token;
      beginBriefing();
      setOpen(true);
      setSlide(0);
      setVoice(readVoiceEnabled());
      setProvider("authored");
      setLine("Preparing your briefing...");
      void loadBedrockBriefing().then((briefing) => {
        if (!live()) return;
        setLines(briefing.lines);
        setProvider(briefing.provider);
        step.current = 0;
        const speakNext = () => {
          if (!live()) return;
          const next = briefing.lines[step.current];
          if (!next) {
            setLine("Briefing complete. You can move now.");
            window.setTimeout(() => {
              if (!live()) return;
              run.current += 1;
              completeBriefing();
              setOpen(false);
            }, 900);
            return;
          }
          setSlide(step.current);
          setLine(next);
          const cue = briefingCue(step.current, next);
          step.current += 1;
          speakNarration(cue, speakNext);
        };
        playSignal("command");
        speakNext();
      });
    };
    window.addEventListener("start-briefing", start);

    // A returning player skips the onboarding card, so the briefing used to begin on a timer
    // 700ms after mount — which in solo practice is simply "the page loaded". Opening the tab
    // would start talking at you. Wait for the player to actually touch the game instead.
    // That is also the gesture the browser requires before any audio may play, so the voice
    // can never be queued up now and erupt later.
    let waitForPlayer: (() => void) | undefined;
    try {
      if (localStorage.getItem("campusevac:onboarding:v2") === "complete") {
        const begin = () => {
          waitForPlayer?.();
          waitForPlayer = undefined;
          start();
        };
        for (const event of ["pointerdown", "keydown", "touchstart"]) {
          window.addEventListener(event, begin, { once: true, passive: true });
        }
        waitForPlayer = () => {
          for (const event of ["pointerdown", "keydown", "touchstart"]) {
            window.removeEventListener(event, begin);
          }
        };
      }
    } catch {
      /* transcript remains available from the mission brief */
    }

    return () => {
      disposed = true;
      window.removeEventListener("start-briefing", start);
      waitForPlayer?.();
      stopNarration();
    };
  }, [beginBriefing, completeBriefing, mode.kind]);

  if (mode.kind === "warden" || !open) return null;

  const skip = () => {
    run.current += 1;
    stopNarration();
    completeBriefing();
    setOpen(false);
  };

  return (
    <div className="pointer-events-auto absolute inset-0 z-50 grid place-items-center overflow-y-auto bg-night/85 p-4 backdrop-blur-md">
      <section className="brutal-panel-dark w-full max-w-2xl p-4 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="briefing-title">
        <div className="flex items-start justify-between gap-4 border-b border-paper/15 pb-4">
          <div>
            <span className="brutal-tag bg-sun text-ink">Briefing</span>
            <h2 id="briefing-title" className="mt-2 text-2xl font-black uppercase tracking-[-0.04em] sm:text-3xl">
              Listen first. Then move.
            </h2>
          </div>
          <div className="shrink-0 text-right font-mono text-[10px] uppercase tracking-widest text-paper/55">
            <div className="text-lg font-black text-sun">
              {Math.min(slide + 1, lines.length)}/{lines.length}
            </div>
            <div>controls locked</div>
          </div>
        </div>
        <div className="mt-4">
          <BriefingArtwork slide={slide} />
        </div>
        <div className="mt-4 border-l-4 border-sun bg-paper/5 px-4 py-3" aria-live="polite">
          <div className="flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-[0.18em] text-sun">
            <span>Narrator</span>
            {provider === "bedrock" && <span className="text-paper/50">Amazon Bedrock</span>}
          </div>
          <div className="mt-1 text-base leading-relaxed text-paper sm:text-lg">{line}</div>
        </div>
        <div className="mt-4 h-2 border border-paper/20 bg-black/40">
          <div className="h-full bg-sun transition-[width] duration-500" style={{ width: `${Math.min(100, ((slide + 1) / Math.max(1, lines.length)) * 100)}%` }} />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={() => {
              writeVoiceEnabled(!voice);
              setVoice(!voice);
            }}
            className="border-2 border-paper/25 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-paper/80 hover:border-paper/60"
            aria-pressed={voice}
          >
            Voice: {voice ? "on" : "off"}
          </button>
          <button onClick={skip} className="brutal-button-dark px-4 py-2.5">
            Skip briefing
          </button>
        </div>
      </section>
    </div>
  );
}

function requestCanvasLock() {
  const canvas = document.querySelector<HTMLCanvasElement>(".drill-surface canvas");
  if (!canvas) return;
  try {
    const result = canvas.requestPointerLock() as unknown as Promise<void> | void;
    if (result && typeof result.catch === "function") result.catch(() => {});
  } catch {
    /* the next click on the canvas locks it */
  }
}

/**
 * Shown on every screen while a participant is missing.
 *
 * The drill is frozen through the existing `paused` flag rather than a second mechanism, so
 * movement, interaction and the hazard clock all stop for free. The countdown is local: it
 * starts when this client first sees the drop, which is close enough on a two-seat drill and
 * avoids putting a deadline into the room snapshot for clients to disagree about.
 */
/**
 * Nudge to turn the phone. Advisory only: play is never blocked or the orientation locked,
 * because a player who wants to stay in portrait — or has rotation locked at the OS level —
 * still has every control reachable, just with less of the building in view.
 */
function RotateHint() {
  const touch = useCoarsePointer();
  const briefingStatus = useSimulation((state) => state.briefingStatus);
  const failed = useSimulation((state) => state.failed);
  const complete = useSimulation((state) => state.assemblyConfirmed);
  const [portrait, setPortrait] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!touch) return;
    const query = window.matchMedia("(orientation: portrait)");
    const apply = () => setPortrait(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [touch]);

  if (!touch || !portrait || dismissed || briefingStatus !== "complete" || failed || complete) return null;

  return (
    <div className="safe-top pointer-events-none absolute inset-x-0 top-0 z-40 flex justify-center px-3">
      <div className="pointer-events-auto flex items-center gap-3 border-2 border-ink bg-sun px-3 py-2 shadow-[4px_4px_0_var(--ink)]">
        <span className="text-[11px] font-black uppercase tracking-[0.12em] text-ink">
          Turn your phone sideways for more of the floor
        </span>
        <button
          onClick={() => setDismissed(true)}
          className="border-2 border-ink px-2 py-1 text-[10px] font-black uppercase tracking-widest text-ink"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function WaitingForPlayer() {
  const room = useSession((state) => state.room);
  const setPaused = useSimulation((state) => state.setPaused);
  const resolved = resolveRoom(room);
  const missing =
    resolved?.phase === "active" ? resolved.participants.find((item) => item.connected === false) : undefined;

  const [remaining, setRemaining] = useState(RECONNECT_GRACE_MS);
  const autoPaused = useRef(false);

  // the room is what knows the grace period expired; the local sim drives the end card
  const failSim = useSimulation((state) => state.fail);
  const outcome = resolved?.outcome;
  useEffect(() => {
    if (outcome === "participant-left") failSim("a participant did not return");
  }, [outcome, failSim]);

  // Show a full ten seconds on the first paint rather than the previous run's zero. This is
  // the derived-state-during-render pattern, so it stays pure: the deadline itself is read
  // from the clock inside the effect.
  const missingId = missing?.id ?? null;
  const [trackedId, setTrackedId] = useState<string | null>(null);
  if (missingId !== trackedId) {
    setTrackedId(missingId);
    setRemaining(RECONNECT_GRACE_MS);
  }

  useEffect(() => {
    if (!missingId) {
      // only lift the pause this overlay put in place, never the player's own pause menu
      if (autoPaused.current) {
        autoPaused.current = false;
        setPaused(false);
      }
      return;
    }
    autoPaused.current = true;
    setPaused(true);
    const endsAt = Date.now() + RECONNECT_GRACE_MS;
    const tick = window.setInterval(() => setRemaining(Math.max(0, endsAt - Date.now())), 100);
    return () => window.clearInterval(tick);
  }, [missingId, setPaused]);

  if (!missing) return null;
  const seconds = Math.ceil(remaining / 1000);

  return (
    <div className="pointer-events-auto absolute inset-0 z-[60] grid place-items-center overflow-y-auto bg-night/85 p-4 backdrop-blur-sm">
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="waiting-title"
        className="brutal-panel-dark w-full max-w-md p-5 text-center sm:p-6"
      >
        <span className="brutal-tag bg-danger text-paper">Connection lost</span>
        <h2 id="waiting-title" className="mt-4 text-3xl font-black uppercase leading-none tracking-[-0.05em]">
          Waiting for {missing.name}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-paper/70">
          The drill is paused. Air and smoke are frozen until they are back.
        </p>
        <div className="mt-6 font-mono text-6xl font-black leading-none text-sun" aria-live="polite">
          {seconds}
        </div>
        <div className="mt-3 h-2 w-full border-2 border-paper/25">
          <div
            className="h-full bg-sun transition-[width] duration-100 ease-linear"
            style={{ width: `${(remaining / RECONNECT_GRACE_MS) * 100}%` }}
          />
        </div>
        <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.14em] text-paper/45">
          The drill ends if they do not return
        </p>
      </section>
    </div>
  );
}

function PauseMenu({ onRestart, onLeave, onHome }: { onRestart: () => void; onLeave: () => void; onHome: () => void }) {
  const paused = useSimulation((state) => state.paused);
  const setPaused = useSimulation((state) => state.setPaused);
  const mode = useSimulation((state) => state.mode);
  const view = useSimulation((state) => state.view);
  const setView = useSimulation((state) => state.setView);
  const cameraMode = useSimulation((state) => state.cameraMode);
  const toggleCameraMode = useSimulation((state) => state.toggleCameraMode);
  const touch = useCoarsePointer();
  const [voice, setVoice] = useState(true);
  const [wasPaused, setWasPaused] = useState(paused);
  if (paused !== wasPaused) {
    setWasPaused(paused);
    if (paused) setVoice(readVoiceEnabled());
  }
  if (!paused) return null;
  const solo = mode.kind === "solo";
  const warden = mode.kind === "warden";
  const resume = () => {
    setPaused(false);
    if (view === "evacuee" && !touch) requestCanvasLock();
  };
  const row = "flex w-full items-center justify-between border-2 border-paper/20 px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.14em] text-paper hover:border-paper/60";

  return (
    <div className="pointer-events-auto absolute inset-0 z-50 grid place-items-center overflow-y-auto bg-night/75 p-4 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" aria-labelledby="pause-title" className="brutal-panel-dark w-full max-w-md p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <span className="brutal-tag bg-sun text-ink">Paused</span>
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-paper/55">
            {touch ? "Tap resume to continue" : <><Key small>Esc</Key> to resume</>}
          </span>
        </div>
        <h2 id="pause-title" className="mt-3 text-3xl font-black uppercase tracking-[-0.05em]">
          Take a breath.
        </h2>
        <div className="mt-5 space-y-2.5">
          <button onClick={resume} className="brutal-button w-full px-4 py-3">
            Resume
          </button>
          {solo && (
            <button
              onClick={() => {
                setPaused(false);
                onRestart();
              }}
              className={row}
            >
              Restart drill <span className="text-paper/50">from the entrance</span>
            </button>
          )}
          {!warden && (
            <button onClick={toggleCameraMode} className={row}>
              Camera <span className="text-sun">{cameraMode === "third" ? "Over the shoulder" : "First person"}</span>
            </button>
          )}
          <button
            onClick={() => {
              writeVoiceEnabled(!voice);
              setVoice(!voice);
            }}
            className={row}
            aria-pressed={voice}
          >
            Voice narration <span className="text-sun">{voice ? "On" : "Off"}</span>
          </button>
          {solo && (
            <div className="grid grid-cols-3 gap-2">
              {VIEWS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setView(item.id)}
                  className={`border-2 px-2 py-2 text-[9px] font-black uppercase tracking-wider ${view === item.id ? "border-sun bg-sun text-ink" : "border-paper/20 text-paper/75 hover:border-paper/60"}`}
                >
                  {item.title}
                </button>
              ))}
            </div>
          )}
        </div>
        {!warden && (
          <details className="mt-4 border-2 border-paper/15 px-4 py-3 text-sm text-paper/80">
            <summary className="cursor-pointer text-[11px] font-black uppercase tracking-[0.14em] text-paper">How to play</summary>
            <ol className="mt-3 space-y-1">
              {STEPS.map((id, index) => (
                <li key={id}>
                  <span className="mr-2 font-mono text-coral">{index + 1}</span>
                  {scenarioObjectById(id).label} <span className="text-paper/45">· {placeName(id)}</span>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-[11px] text-paper/55">WASD move · Shift sprint · Space jump · E interact · V camera · Esc menu</p>
          </details>
        )}
        <div className="mt-5 grid gap-2.5 border-t border-paper/15 pt-5 sm:grid-cols-2">
          {!solo && (
            <button onClick={onLeave} className="border-2 border-coral px-4 py-3 text-[11px] font-black uppercase tracking-[0.14em] text-coral hover:bg-coral hover:text-ink">
              Leave drill
            </button>
          )}
          <button onClick={onHome} className={`border-2 border-coral px-4 py-3 text-[11px] font-black uppercase tracking-[0.14em] text-coral hover:bg-coral hover:text-ink ${solo ? "sm:col-span-2" : ""}`}>
            Exit to home
          </button>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------- shell */

export default function DrillShell({ title }: { title?: string }) {
  const router = useRouter();
  const mode = useSimulation((state) => state.mode);
  const view = useSimulation((state) => state.view);
  const setView = useSimulation((state) => state.setView);
  const setPaused = useSimulation((state) => state.setPaused);
  const air = useSimulation((state) => state.air);
  const health = useSimulation((state) => state.health);
  const smoke = useSimulation((state) => state.smokeIntensity);
  const sector = useSimulation((state) => state.sector);
  const routeStatus = useSimulation((state) => state.routeStatus);
  const reset = useSimulation((state) => state.reset);
  const leave = useSession((state) => state.leave);
  const onRouteMessage = useSession((state) => state.onRouteMessage);
  const onAcknowledgement = useSession((state) => state.onAcknowledgement);
  const onWardenState = useSession((state) => state.onWardenState);
  const observeEvidence = useSession((state) => state.observeEvidence);
  const touch = useCoarsePointer();
  const solo = mode.kind === "solo";
  const warden = mode.kind === "warden";
  const showStick = touch && view === "evacuee";

  useEffect(() => {
    if (!solo) return;
    const onKey = (event: KeyboardEvent) => {
      const index = ["Digit1", "Digit2", "Digit3"].indexOf(event.code);
      if (index >= 0) setView(VIEWS[index].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setView, solo]);

  // Esc opens the menu. While the mouse is captured the browser eats that Esc to release the
  // pointer, so losing the lock mid-drill opens the menu too.
  useEffect(() => {
    const idle = () => {
      const state = useSimulation.getState();
      return state.failed || state.assemblyConfirmed || state.briefingStatus !== "complete";
    };
    const onLockChange = () => {
      const state = useSimulation.getState();
      if (document.pointerLockElement || state.view !== "evacuee" || idle()) return;
      state.setPaused(true);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Escape" && event.code !== "KeyP") return;
      const state = useSimulation.getState();
      if (document.pointerLockElement) {
        if (event.code === "KeyP") document.exitPointerLock();
        return;
      }
      if (!state.paused && idle()) return;
      state.setPaused(!state.paused);
    };
    document.addEventListener("pointerlockchange", onLockChange);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerlockchange", onLockChange);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    return onRouteMessage((message: RouteMessage) => useSimulation.getState().receiveRouteMessage(message));
  }, [onRouteMessage]);

  useEffect(() => {
    return onAcknowledgement((acknowledgement) => useSimulation.getState().receiveAcknowledgement(acknowledgement));
  }, [onAcknowledgement]);

  // Warden snapshots drive the HUD and the remote evacuee marker. They are applied
  // here, outside the canvas, so the station stays live before the 3D view mounts.
  useEffect(() => {
    if (!warden) return;
    return onWardenState((state) => {
      runtime.netEvacuee = state.evacuee
        ? {
            x: state.evacuee.position[0],
            y: state.evacuee.position[1],
            z: state.evacuee.position[2],
            yaw: state.evacuee.position[3],
            hasBackpack: state.hasBackpack,
            equipped: state.equipped,
            scenarioProgress: state.scenarioProgress,
          }
        : null;
      if (state.evacuee) {
        runtime.sector = state.evacuee.sectorId;
        runtime.evacueeYaw = state.evacuee.position[3];
      }
      runtime.alert = state.smokeIntensity * 100;
      useSimulation.getState().applyWardenState(state);
    });
  }, [onWardenState, warden]);

  useEffect(() => {
    const inspect = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string }>).detail;
      if (detail?.id && warden) {
        observeEvidence(detail.id);
        playSignal("evidence");
      }
    };
    window.addEventListener("inspect-evidence", inspect);
    return () => window.removeEventListener("inspect-evidence", inspect);
  }, [observeEvidence, warden]);

  const exitLock = () => {
    if (document.pointerLockElement) document.exitPointerLock();
  };
  const restart = () => {
    reset();
    setView("evacuee");
    window.dispatchEvent(new Event("start-briefing"));
  };
  const leaveDrill = () => {
    stopNarration();
    leave();
    router.push("/simulation/rooms");
  };
  const goHome = () => {
    stopNarration();
    if (!solo) leave();
    router.push("/");
  };

  const watched = watchedSector(mode);
  const tag = title ?? (warden ? "Warden" : mode.kind === "evacuee" ? "Evacuee" : "Solo practice");
  const evacueeHud = !warden && view === "evacuee";

  return (
    <div className="drill-surface absolute inset-0 overflow-hidden bg-night text-paper">
      <DrillCanvas />
      <Briefing />

      {/* top left: brand, location, objectives */}
      <div className="safe-top pointer-events-none absolute left-3 top-0 z-10 flex max-w-[58vw] flex-col items-start gap-3 sm:left-4 sm:max-w-none">
        <LocationHeader tag={tag} />
        {evacueeHud ? (
          // 19.5rem of checklist collides with the minimap on a 360px screen, so on a phone
          // the list folds away and the objective the player is actually on is carried by
          // the prompt and the narration instead
          <PhoneCollapsible label="Objectives">
            <ObjectivesPanel />
          </PhoneCollapsible>
        ) : (
          <div className="hud-panel max-w-xs px-3 py-2 text-[11px] leading-snug text-paper/75">
            {warden
              ? `Warden station · watching ${roomById(watched ?? sector).name}. Verify before you message.`
              : view === "warden"
                ? "Warden view · drag to orbit, scroll to zoom. Press 1 for the evacuee."
                : "Evidence view · click the markers to inspect. Press 1 for the evacuee."}
          </div>
        )}
      </div>

      {/* top right: status, menu, map, warden panels */}
      <div className="safe-top pointer-events-none absolute right-3 top-0 z-10 flex max-h-[calc(100%-1.5rem)] max-w-[52vw] flex-col items-end gap-2 overflow-y-auto sm:right-4 sm:max-w-none">
        <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-2">
          <ConnectionBadge />
          {warden && (
            <div className="flex overflow-hidden border-2 border-paper/30">
              {(["warden", "evidence"] as ViewMode[]).map((id) => (
                <button
                  key={id}
                  onClick={() => setView(id)}
                  className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest ${view === id ? "bg-sun text-ink" : "bg-night/85 text-paper/65 hover:bg-paper/10"}`}
                >
                  {id === "warden" ? "Watch" : "Evidence"}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => {
              exitLock();
              setPaused(true);
            }}
            className="flex items-center gap-2 border-2 border-paper/30 bg-night/85 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-paper hover:border-paper/70"
            aria-label="Open the menu"
          >
            <span aria-hidden className="text-sun">
              ❚❚
            </span>
            Menu
          </button>
        </div>
        <Minimap />
        {view !== "evacuee" && (
          <PhoneCollapsible label="Evidence">
            <EvidencePanel />
          </PhoneCollapsible>
        )}
        {view === "evidence" && (
          <PhoneCollapsible label="Log">
            <Log />
          </PhoneCollapsible>
        )}
      </div>

      {/* alerts */}
      <div className="pointer-events-none absolute inset-x-0 top-[34%] z-10 flex flex-col items-center gap-2 px-3 xl:top-4">
        <HazardBanner />
        <RouteMessageCard />
      </div>

      {warden && (
        <div className="pointer-events-auto absolute inset-x-2 bottom-3 z-10 sm:inset-x-auto sm:bottom-4 sm:left-1/2 sm:-translate-x-1/2">
          <CommandDeck />
        </div>
      )}

      {/* bottom left: vitals */}
      <div className={`pointer-events-none absolute left-3 z-10 sm:left-4 ${showStick ? "top-[40%]" : warden ? "bottom-[10rem] sm:bottom-4" : "bottom-3 sm:bottom-4"}`}>
        {evacueeHud ? (
          <Vitals />
        ) : (
          <div className="hud-panel hidden flex-col gap-2 p-3 sm:flex">
            <Bar label="Evacuee health" value={health} color="var(--mint)" danger={health < 35} />
            <Bar label="Evacuee air" value={air} color="#6fb8ff" danger={air < 35} />
            <div className="flex flex-wrap gap-3 font-mono text-[10px] uppercase tracking-wider text-paper/60">
              <span style={{ color: routeStatus === "unsafe" ? "var(--danger)" : routeStatus === "intervened" ? "var(--mint)" : "var(--sun)" }}>route / {routeStatus}</span>
              <span>smoke / {Math.round(smoke * 100)}%</span>
            </div>
          </div>
        )}
      </div>

      {/* bottom centre: narration, interaction prompt, controls */}
      {!warden && (
        <div className={`pointer-events-none absolute inset-x-0 z-10 flex flex-col items-center gap-2 px-3 ${showStick ? "above-dock" : "bottom-3 sm:bottom-4"} ${view === "evacuee" ? "" : "hidden"}`}>
          <NarrationCaption />
          {!showStick && <PromptBar />}
          {!touch && <div className="hidden lg:block"><ControlsHint /></div>}
        </div>
      )}

      {view === "evacuee" && !showStick && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <span className="block h-1.5 w-1.5 rounded-full bg-paper shadow-[0_0_0_2px_rgba(22,17,30,0.6)]" />
        </div>
      )}
      {showStick && <TouchControls />}
      <Onboarding />
      <RotateHint />
      <WaitingForPlayer />
      <PauseMenu onRestart={restart} onLeave={leaveDrill} onHome={goHome} />
      <EndCard onReset={restart} onLeave={leaveDrill} onHome={goHome} />
    </div>
  );
}
