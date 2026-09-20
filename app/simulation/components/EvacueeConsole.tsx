"use client";

import { useEffect, useState } from "react";
import TacticalMap from "./TacticalMap";
import {
  CRITICAL_SCENARIO_OBJECTS,
  nextScenarioGuidance,
  roomById,
  scenarioObjectById,
} from "../level";
import { presenceOf } from "../net/types";
import { resolveRoom, useSession } from "../session";
import { useSimulation } from "../store";

function connectionLabel(status: ReturnType<typeof useSession.getState>["status"]) {
  if (status === "connected") return "Live";
  if (status === "connecting") return "Connecting";
  if (status === "reconnecting" || status === "syncing") return "Reconnecting";
  if (status === "disconnected") return "Offline";
  if (status === "idle") return "Offline practice";
  return status;
}

function connectionTone(status: ReturnType<typeof useSession.getState>["status"]) {
  return status === "connected" || status === "idle" ? "ce-status-safe" : "ce-status-warning";
}

function StatusBar({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  const color = danger ? "#c43b3e" : "#147f50";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-[0.12em] text-[#48617a]">
        <span>{label}</span>
        <span className="font-mono" style={{ color }}>
          {Math.round(value)}%
        </span>
      </div>
      <div className="ce-progress-track">
        <div className="ce-progress-fill" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
      </div>
    </div>
  );
}

function EvacuationStatus() {
  const air = useSimulation((state) => state.air);
  const health = useSimulation((state) => state.health);
  const smoke = useSimulation((state) => state.smokeIntensity);
  const elapsed = useSimulation((state) => state.hazardElapsed);
  const routeStatus = useSimulation((state) => state.routeStatus);
  const complete = useSimulation((state) => state.assemblyConfirmed);
  const failed = useSimulation((state) => state.failed);

  const status = complete
    ? { label: "Assembly confirmed", tone: "ce-status-safe", detail: "You are accounted for at the assembly point." }
    : failed
      ? { label: "Drill ended", tone: "ce-status-danger", detail: "Review the outcome before starting again." }
      : routeStatus === "unsafe"
        ? { label: "Route warning", tone: "ce-status-danger", detail: "A route has been marked unsafe." }
        : smoke > 0.2
          ? { label: "Evacuating", tone: "ce-status-warning", detail: "Smoke is present. Keep moving toward clear air." }
          : { label: "Evacuating", tone: "ce-status-safe", detail: "Follow the next action and stay with the drill." };

  return (
    <section className="ce-panel ce-status-panel p-3.5" aria-labelledby="evacuation-status-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div id="evacuation-status-title" className="ce-section-label">Evacuation status</div>
          <p className="mt-1 text-xs text-[#52657d]">Your immediate drill conditions</p>
        </div>
        <span className={`ce-status ${status.tone}`}>
          <span className="ce-status-dot" aria-hidden />
          {status.label}
        </span>
      </div>
      <p className="mt-3 border-l-4 border-[#1bab68] pl-2.5 text-xs font-semibold leading-relaxed text-[#294563]">
        {status.detail}
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <StatusBar label="Air" value={air} danger={air < 35} />
        <StatusBar label="Health" value={health} danger={health < 35} />
        <div>
          <div className="mb-1 text-[10px] font-black uppercase tracking-[0.12em] text-[#48617a]">Elapsed</div>
          <div className="font-mono text-lg font-black text-[#173457]">
            {Math.floor(elapsed / 60)}:{String(Math.floor(elapsed % 60)).padStart(2, "0")}
          </div>
        </div>
      </div>
    </section>
  );
}

function EvacueeIdentity() {
  const room = useSession((state) => resolveRoom(state.room));
  const myId = useSession((state) => state.myId);
  const mode = useSimulation((state) => state.mode);
  const participant = room?.participants.find((item) => item.id === myId);
  const location = useSimulation((state) => state.sector);

  return (
    <section className="ce-panel ce-character-panel p-3.5" aria-labelledby="evacuee-card-title">
      <div className="flex items-center gap-3">
          <div className="ce-avatar ce-avatar-evacuee grid h-12 w-12 shrink-0 place-items-center" aria-hidden>
            {mode.kind === "solo" ? "YOU" : "EVA"}
        </div>
        <div className="min-w-0">
          <div id="evacuee-card-title" className="ce-section-label">Evacuation card</div>
          <div className="truncate text-lg font-black uppercase tracking-[-0.03em] text-[#13213c]">
            {participant?.name ?? (mode.kind === "solo" ? "Solo practice" : "Participant")}
          </div>
          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#607892]">
            {mode.kind === "solo" ? "training sandbox" : "evacuee role"}
          </div>
        </div>
      </div>
      <dl className="mt-4 grid gap-2 border-t border-[#a8bdcc] pt-3 text-xs">
        <div className="flex items-start justify-between gap-3">
          <dt className="font-black uppercase tracking-[0.09em] text-[#607892]">Current location</dt>
          <dd className="max-w-[12rem] text-right font-bold text-[#1d3858]">{roomById(location).name}</dd>
        </div>
        {room?.code && (
          <div className="flex items-center justify-between gap-3">
            <dt className="font-black uppercase tracking-[0.09em] text-[#607892]">Drill code</dt>
            <dd className="font-mono font-bold tracking-[0.15em] text-[#1d3858]">{room.code}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

function ProgressRail() {
  const progress = useSimulation((state) => state.scenarioProgress);
  const complete = useSimulation((state) => state.assemblyConfirmed);
  const current = nextScenarioGuidance(progress);
  const done = CRITICAL_SCENARIO_OBJECTS.filter((id) => progress[id]).length;

  return (
    <section className="ce-panel ce-objective-panel p-3.5" aria-labelledby="progress-title">
      <div className="flex items-center justify-between gap-3">
        <div id="progress-title" className="ce-section-label">Drill progress</div>
        <span className="font-mono text-[10px] font-black text-[#607892]">{done}/{CRITICAL_SCENARIO_OBJECTS.length}</span>
      </div>
      <ol className="mt-3 space-y-2">
        {[...CRITICAL_SCENARIO_OBJECTS, "main-exit" as const].map((id) => {
          const finished = progress[id];
          const active = current.id === id;
          const label = scenarioObjectById(id).label;
          return (
            <li key={id} className={`flex items-center gap-2 text-xs ${finished ? "text-[#7890a5]" : active ? "font-bold text-[#173e72]" : "text-[#49637c]"}`}>
              <span className={`grid h-5 w-5 shrink-0 place-items-center border-2 text-[10px] font-black ${finished ? "border-[#1bab68] bg-[#1bab68] text-white" : active ? "border-[#e3a63b] bg-[#fff2c9] text-[#9c6717]" : "border-[#8ba8bd] bg-[#e7f0f5] text-transparent"}`} aria-hidden>
                {finished ? "✓" : active ? "›" : ""}
              </span>
              <span className={finished ? "line-through decoration-[#9eb2c1]" : ""}>{label}</span>
              {active && <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.08em] text-[#b36d1a]">next</span>}
            </li>
          );
        })}
        <li className={`flex items-center gap-2 border-t border-[#b2c4d1] pt-2 text-xs ${complete ? "font-bold text-[#087d4b]" : "text-[#49637c]"}`}>
          <span className={`grid h-5 w-5 shrink-0 place-items-center border-2 text-[10px] font-black ${complete ? "border-[#1bab68] bg-[#1bab68] text-white" : "border-[#8ba8bd] bg-[#e7f0f5] text-transparent"}`} aria-hidden>
            {complete ? "✓" : ""}
          </span>
          Assembly confirmation
        </li>
      </ol>
    </section>
  );
}

function NextAction() {
  const progress = useSimulation((state) => state.scenarioProgress);
  const prompt = useSimulation((state) => state.prompt);
  const routeStatus = useSimulation((state) => state.routeStatus);
  const latestMessage = useSimulation((state) => state.latestMessage);
  const [now, setNow] = useState(() => Date.now());
  const guidance = nextScenarioGuidance(progress);
  const messageActive = latestMessage !== null && latestMessage.expiresAt > now;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="ce-panel ce-dialogue overflow-hidden" aria-labelledby="next-action-title">
      <div className="ce-panel-title ce-panel-title-blue px-3.5 py-2" id="next-action-title">Next action</div>
      <div className="p-3.5">
        <div className="flex items-start gap-3">
           <div className="ce-dialogue-portrait" aria-hidden>!</div>
          <div>
            <div className="font-mono text-[10px] font-black uppercase tracking-[0.12em] text-[#607892]">{guidance.label}</div>
            <p className="mt-1 text-sm font-bold leading-relaxed text-[#173457]">{prompt?.replace(/^Press E to /, "") ?? guidance.instruction}</p>
          </div>
        </div>
        <div className="mt-3 border-t border-[#b0c4d3] pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`ce-route-chip ${routeStatus === "unsafe" ? "ce-route-danger" : routeStatus === "intervened" ? "ce-route-safe" : "ce-route-warning"}`}>
              <span aria-hidden>{routeStatus === "unsafe" ? "!" : routeStatus === "intervened" ? "OK" : "?"}</span>
              Route {routeStatus}
            </span>
             {messageActive && <span className="ce-route-chip ce-route-safe">Warden message</span>}
           </div>
           {messageActive && latestMessage ? (
            <p className="mt-2 text-xs font-semibold leading-relaxed text-[#294563]">{latestMessage.caption}</p>
          ) : (
            <p className="mt-2 text-[11px] leading-relaxed text-[#607892]">Use the highlighted route on the campus map and follow physical exit signs.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function ConnectionStatus() {
  const status = useSession((state) => state.status);
  return (
    <span className={`ce-status ${connectionTone(status)} bg-[#0d1d3b] text-[#d9ebf7]`} role="status" aria-live="polite">
      <span className="ce-status-dot ce-live-dot" aria-hidden />
      {connectionLabel(status)}
    </span>
  );
}

export default function EvacueeConsole() {
  const mode = useSimulation((state) => state.mode);
  const [now, setNow] = useState(() => Date.now());
  const room = useSession((state) => resolveRoom(state.room));
  const myId = useSession((state) => state.myId);
  const participant = room?.participants.find((item) => item.id === myId);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const message = useSimulation((state) => state.latestMessage);
  const messageActive = !!message && message.expiresAt > now;

  return (
    <main className="ce-scrollbar ce-role-console ce-evacuee-console absolute inset-0 overflow-y-auto">
      <div className="ce-evacuee-content mx-auto flex min-h-full w-full max-w-[1320px] flex-col px-3 pb-6 sm:px-5 lg:px-7">
        <header className="ce-topbar -mx-3 flex min-h-14 items-center justify-between gap-3 px-3 py-2 sm:-mx-5 sm:px-5 lg:-mx-7 lg:px-7">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="ce-brand-mark h-8 w-8">CE</span>
            <div className="min-w-0">
              <div className="ce-brand truncate">CampusEvac</div>
              <div className="hidden font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-[#9bb6cf] sm:block">Evacuee tactical interface</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[#9bb6cf] md:inline">{room?.code ?? (mode.kind === "solo" ? "sandbox" : "drill")}</span>
            <ConnectionStatus />
          </div>
        </header>

        <div className="grid flex-1 gap-3 py-3 lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-4 lg:py-4">
          <div className="flex min-w-0 flex-col gap-3">
            <section className="ce-frame overflow-hidden">
              <TacticalMap />
              <div className="border-t border-[#a7bdcc] bg-[#e0ebf1] px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#516b83]">
                Current position and objective are synchronized from the drill state.
              </div>
            </section>
            <NextAction />
            {messageActive && message && (
              <div className="ce-panel border-l-4 border-l-[#1bab68] px-3.5 py-2.5" role="status" aria-live="polite">
                <div className="ce-kicker text-[#0b8050]">Verified warden message · {message.confidence}</div>
                <div className="mt-1 text-sm font-black text-[#173457]">{message.caption}</div>
              </div>
            )}
            {participant && presenceOf(participant) !== "connected" && (
              <div className="ce-panel border-l-4 border-l-[#d94b4b] px-3.5 py-2.5 text-xs font-semibold text-[#7c292e]" role="status">
                Your drill seat is reconnecting. The current drill state is being preserved.
              </div>
            )}
          </div>

          <aside className="ce-role-rail flex min-w-0 flex-col gap-3">
            <EvacuationStatus />
            <EvacueeIdentity />
            <ProgressRail />
          </aside>
        </div>
      </div>
    </main>
  );
}
