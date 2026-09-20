"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import EvacueeConsole from "./components/EvacueeConsole";
import WardenConsole from "./components/WardenConsole";
import TouchControls from "./components/TouchControls";
import SimulationDriver from "./SimulationDriver";
import { useCoarsePointer } from "./useCoarsePointer";
import { commandByCode } from "./commands";
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
import { buildCompletionModel } from "./result-model";
import { runtime } from "./runtime";
import { resolveRoom, useSession } from "./session";
import { useSimulation, VIEWS } from "./store";
import { RECONNECT_GRACE_MS, presenceOf, type RouteMessage } from "./net/types";

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
    <div key={caption.id} className="ce-narration-caption hud-rise max-w-[min(40rem,calc(100vw-2rem))] px-4 py-2.5 text-center text-[14px] leading-snug text-paper" role="status" aria-live="polite">
      <span className="mr-2 text-[10px] font-black uppercase tracking-[0.2em] text-sun">Narrator</span>
      {caption.text}
    </div>
  );
}

/* --------------------------------------------------------------- overlays */

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

function EndDialog({
  tag,
  headline,
  children,
}: {
  tag: string;
  headline: string;
  children: ReactNode;
}) {
  return (
    <div className="ce-overlay-scrim pointer-events-auto absolute inset-0 z-50 grid place-items-center overflow-y-auto p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="end-title" className="ce-overlay-panel brutal-panel w-full max-w-lg p-5 text-ink sm:p-7">
        <span className={`brutal-tag ${tag === "Drill complete" ? "bg-mint" : "bg-coral"}`}>{tag}</span>
        <h2 id="end-title" className="mt-3 text-4xl font-black uppercase leading-[0.95] tracking-[-0.05em]">
          {headline}
        </h2>
        {children}
      </section>
    </div>
  );
}

function EndActions({
  solo,
  onReset,
  onLeave,
  onHome,
}: {
  solo: boolean;
  onReset: () => void;
  onLeave: () => void;
  onHome: () => void;
}) {
  return (
    <div className="mt-6 grid gap-3 sm:grid-cols-2">
      {solo ? (
        <button onClick={onReset} className="brutal-button px-4 py-3">
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
  );
}

function EndCard({ onReset, onLeave, onHome }: { onReset: () => void; onLeave: () => void; onHome: () => void }) {
  const complete = useSimulation((state) => state.assemblyConfirmed);
  const failed = useSimulation((state) => state.failed);
  const mode = useSimulation((state) => state.mode);
  const solo = mode.kind === "solo";
  const routeStatus = useSimulation((state) => state.routeStatus);
  const interventionApplied = useSimulation((state) => state.interventionApplied);
  const latestMessage = useSimulation((state) => state.latestMessage);
  const progress = useSimulation((state) => state.scenarioProgress);
  const elapsed = useSimulation((state) => state.hazardElapsed);
  const health = useSimulation((state) => state.health);
  const smokeIntensity = useSimulation((state) => state.smokeIntensity);
  const evidence = useSimulation((state) => state.evidence);
  const lastAcknowledgement = useSimulation((state) => state.lastAcknowledgement);
  const reset = useSimulation((state) => state.reset);
  const room = useSession((state) => state.room);
  const code = useSession((state) => state.code);
  const abandoned = resolveRoom(room)?.outcome === "participant-left";
  if (!complete && !failed) return null;

  const done = CRITICAL_SCENARIO_OBJECTS.filter((id) => progress[id]).length;
  const evacuees = room?.participants.filter((participant) => participant.role === "evacuee") ?? [];
  const result = buildCompletionModel(mode, {
    complete,
    abandoned,
    elapsed,
    completedObjectives: done,
    totalObjectives: CRITICAL_SCENARIO_OBJECTS.length,
    health,
    safeEvacuees: complete ? evacuees.length : 0,
    totalEvacuees: evacuees.length,
    routeStatus,
    smokeIntensity,
  });

  if (result.role === "warden") {
    const evidenceItems = Object.values(evidence);
    const verified = evidenceItems.filter((item) => item.status === "VERIFIED").length;
    const observed = evidenceItems.filter((item) => item.status === "OBSERVED").length;
    const pending = evidenceItems.filter((item) => item.status === "UNKNOWN").length;
    const assignedSector = mode.kind === "warden" ? mode.sectorId : "sec";
    const outcome = complete
      ? "The evacuee reached the marked assembly point."
      : abandoned
        ? "The drill ended because the participant did not return."
        : "The evacuee did not reach the marked assembly point.";
    const incident = interventionApplied
      ? "Ventilation override was applied to reduce smoke exposure."
      : routeStatus === "unsafe"
        ? "The east route was marked unsafe during the drill."
        : "No route intervention was recorded.";
    const coordination = latestMessage
      ? `Route guidance delivered: ${latestMessage.caption}`
      : "No route guidance message was delivered to the evacuee.";
    const acknowledgement = lastAcknowledgement
      ? `${lastAcknowledgement.accepted ? "Accepted" : "Denied"}: ${commandByCode(lastAcknowledgement.command).label}.`
      : "No coordination command acknowledgement was recorded.";
    const evidenceSummary = `${verified} verified · ${observed} observed · ${pending} awaiting review.`;

    return (
      <EndDialog tag={result.tag} headline={result.headline}>
        <dl className="mt-5 grid grid-cols-3 border-2 border-ink bg-paper">
          {result.metrics.map((metric, index) => (
            <div key={metric.label} className={`p-3 ${index ? "border-l-2 border-ink" : ""}`}>
              <dt className="text-[9px] font-black uppercase tracking-[0.18em] text-ink-soft">{metric.label}</dt>
              <dd className="mt-1 truncate font-mono text-xl font-black uppercase">{metric.value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-5 space-y-3">
          {(
            [
              ["Evacuation status", outcome, "var(--mint)"],
              ["Incident state", `${incident} Assigned sector: ${roomById(assignedSector).name}.`, "var(--danger)"],
              ["Coordination", `${coordination} ${acknowledgement}`, "var(--sun)"],
              ["Evidence review", evidenceSummary, "var(--violet)"],
            ] as [string, string, string][]
          ).map(([label, detail, color]) => (
            <div key={label} className="border-l-4 pl-3" style={{ borderColor: color }}>
              <div className="text-[10px] font-black uppercase tracking-[0.16em]">{label}</div>
              <div className="mt-0.5 text-sm text-ink-soft">{detail}</div>
            </div>
          ))}
        </div>
        <VerificationBadge code={code} />
        <EndActions solo={false} onReset={onReset} onLeave={onLeave} onHome={onHome} />
      </EndDialog>
    );
  }

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
    <EndDialog tag={result.tag} headline={result.headline}>
      <dl className="mt-5 grid grid-cols-3 border-2 border-ink bg-paper">
        {result.metrics.map((metric, index) => (
          <div key={metric.label} className={`p-3 ${index ? "border-l-2 border-ink" : ""}`}>
            <dt className="text-[9px] font-black uppercase tracking-[0.18em] text-ink-soft">{metric.label}</dt>
            <dd className="mt-1 font-mono text-2xl font-black">{metric.value}</dd>
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
      <EndActions
        solo={solo}
        onReset={() => {
          reset();
          onReset();
        }}
        onLeave={onLeave}
        onHome={onHome}
      />
    </EndDialog>
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
    <div className="ce-overlay-scrim pointer-events-auto absolute inset-0 z-50 grid place-items-center overflow-y-auto p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="onboarding-title" className="ce-overlay-panel brutal-panel w-full max-w-xl p-5 text-ink sm:p-7">
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
                  ["E", "Interact"],
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
    <div className="ce-overlay-scrim pointer-events-auto absolute inset-0 z-50 grid place-items-center overflow-y-auto p-4">
      <section className="ce-overlay-panel ce-briefing-panel brutal-panel-dark w-full p-4 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="briefing-title">
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
        <div className="ce-briefing-caption mt-4 border-l-4 border-sun px-4 py-3" aria-live="polite">
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
  const myId = useSession((state) => state.myId);
  const connectionStatus = useSession((state) => state.status);
  const setPaused = useSimulation((state) => state.setPaused);
  const resolved = resolveRoom(room);
  const missing =
    resolved?.phase === "active"
      ? resolved.participants.find(
          (item) => item.id !== myId && presenceOf(item) !== "connected",
        )
      : undefined;
  const selfRecovering =
    resolved?.phase === "active" &&
    (connectionStatus === "reconnecting" ||
      connectionStatus === "syncing" ||
      connectionStatus === "disconnected");

  const [now, setNow] = useState(() => Date.now());
  const [fallbackDeadline, setFallbackDeadline] = useState<number | null>(null);
  const autoPaused = useRef(false);

  // the room is what knows the grace period expired; the local sim drives the end card
  const failSim = useSimulation((state) => state.fail);
  const outcome = resolved?.outcome;
  useEffect(() => {
    if (outcome === "participant-left") failSim("a participant did not return");
  }, [outcome, failSim]);

  const missingId = missing?.id ?? null;
  const waiting = !!missing || selfRecovering;
  const deadline = missing?.reconnectUntil ?? fallbackDeadline;

  useEffect(() => {
    const nextDeadline = missingId ? Date.now() + RECONNECT_GRACE_MS : null;
    const timer = window.setTimeout(() => setFallbackDeadline(nextDeadline), 0);
    return () => window.clearTimeout(timer);
  }, [missingId]);

  useEffect(() => {
    if (!waiting) return;
    const tick = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(tick);
  }, [waiting]);

  useEffect(() => {
    if (!waiting) {
      // only lift the pause this overlay put in place, never the player's own pause menu
      if (autoPaused.current) {
        autoPaused.current = false;
        setPaused(false);
      }
      return;
    }
    autoPaused.current = true;
    setPaused(true);
  }, [setPaused, waiting]);

  if (!waiting) return null;
  const remaining = deadline === null ? null : Math.max(0, deadline - now);
  const seconds = remaining === null ? null : Math.ceil(remaining / 1000);

  return (
    <div className="ce-overlay-scrim pointer-events-auto absolute inset-0 z-[60] grid place-items-center overflow-y-auto p-4">
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="waiting-title"
        className="ce-overlay-panel brutal-panel-dark w-full max-w-md p-5 text-center sm:p-6"
      >
        <span className="brutal-tag bg-danger text-paper">{selfRecovering ? "Reconnecting" : "Connection lost"}</span>
        <h2 id="waiting-title" className="mt-4 text-3xl font-black uppercase leading-none tracking-[-0.05em]">
          {selfRecovering ? "Reconnecting to the drill" : `Waiting for ${missing?.name}`}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-paper/70">
          {selfRecovering
            ? "The drill is paused while realtime state is synchronized."
            : "The drill is paused. Air and smoke are frozen until they are back."}
        </p>
        {seconds !== null ? (
          <>
            <div className="mt-6 font-mono text-6xl font-black leading-none text-sun" aria-live="polite">
              {seconds}
            </div>
            <div className="mt-3 h-2 w-full border-2 border-paper/25">
              <div
                className="h-full bg-sun transition-[width] duration-100 ease-linear"
                style={{ width: `${Math.min(100, (remaining! / RECONNECT_GRACE_MS) * 100)}%` }}
              />
            </div>
          </>
        ) : (
          <div className="mt-6 font-mono text-sm font-black uppercase tracking-[0.2em] text-sun" aria-live="polite">
            Synchronizing...
          </div>
        )}
        <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.14em] text-paper/45">
          {selfRecovering ? "Your progress is being held locally until the room is live" : "The drill ends if they do not return"}
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
  const resume = () => setPaused(false);
  const row = "flex w-full items-center justify-between border-2 border-paper/20 px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.14em] text-paper hover:border-paper/60";

  return (
    <div className="ce-overlay-scrim pointer-events-auto absolute inset-0 z-50 grid place-items-center overflow-y-auto p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="pause-title" className="ce-overlay-panel brutal-panel-dark w-full max-w-md p-5 sm:p-6">
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
            <p className="mt-3 text-[11px] text-paper/55">WASD move · Shift sprint · E interact · Esc menu</p>
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
  const tacticalEvacuee = !warden && view === "evacuee";
  const tacticalWarden = warden || view !== "evacuee";

  useEffect(() => {
    if (!solo) return;
    const onKey = (event: KeyboardEvent) => {
      const index = ["Digit1", "Digit2", "Digit3"].indexOf(event.code);
      if (index >= 0) setView(VIEWS[index].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setView, solo]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Escape" && event.code !== "KeyP") return;
      const state = useSimulation.getState();
      if (!state.paused && (state.failed || state.assemblyConfirmed || state.briefingStatus !== "complete")) return;
      state.setPaused(!state.paused);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    return onRouteMessage((message: RouteMessage) => useSimulation.getState().receiveRouteMessage(message));
  }, [onRouteMessage]);

  useEffect(() => {
    return onAcknowledgement((acknowledgement) => useSimulation.getState().receiveAcknowledgement(acknowledgement));
  }, [onAcknowledgement]);

  // Warden snapshots drive the console and the remote evacuee marker.
  useEffect(() => {
    if (!warden) return;
    return onWardenState((state) => {
      runtime.netEvacuee = state.evacuee
          ? {
            x: state.evacuee.position[0],
            z: state.evacuee.position[1],
            yaw: state.evacuee.position[2],
            sectorId: state.evacuee.sectorId,
            hasBackpack: state.hasBackpack,
            equipped: state.equipped,
            scenarioProgress: state.scenarioProgress,
          }
        : null;
      if (state.evacuee) {
        runtime.sector = state.evacuee.sectorId;
      }
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

  return (
    <div className="ce-tactical-shell absolute inset-0 overflow-hidden text-paper" data-drill-title={title}>
      <SimulationDriver />
      {tacticalEvacuee && <EvacueeConsole />}
      {tacticalWarden && <WardenConsole view={view} setView={setView} />}
      <Briefing />
      {!warden && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3 sm:bottom-4">
          <NarrationCaption />
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
