"use client";

import { useEffect, useState } from "react";
import TacticalMap from "./TacticalMap";
import { COMMANDS, type CommandCode } from "../commands";
import { roomById } from "../level";
import { presenceOf } from "../net/types";
import { resolveRoom, useSession } from "../session";
import { useSimulation, type ViewMode } from "../store";

function ConnectionStatus() {
  const status = useSession((state) => state.status);
  const label =
    status === "connected"
      ? "Live"
      : status === "connecting"
        ? "Connecting"
        : status === "reconnecting" || status === "syncing"
          ? "Reconnecting"
          : status === "disconnected"
            ? "Offline"
            : status === "idle"
              ? "Offline practice"
              : status;
  const tone = status === "connected" || status === "idle" ? "ce-status-safe" : "ce-status-warning";
  return (
    <span className={`ce-status ${tone} bg-[#0d1d3b] text-[#d9ebf7]`} role="status" aria-live="polite">
      <span className="ce-status-dot ce-live-dot" aria-hidden />
      {label}
    </span>
  );
}

function Metric({ label, value, tone = "text-[#173457]" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="ce-metric px-3 py-2">
      <div className="ce-kicker">{label}</div>
      <div className={`mt-1 font-mono text-lg font-black uppercase ${tone}`}>{value}</div>
    </div>
  );
}

function Roster() {
  const room = useSession((state) => resolveRoom(state.room));
  const myId = useSession((state) => state.myId);
  const evacuee = room?.participants.find((participant) => participant.role === "evacuee");
  const warden = room?.participants.find((participant) => participant.role === "warden");
  const evacueeState = useSimulation((state) => state.assemblyConfirmed ? "assembled" : state.failed ? "drill ended" : "in progress");

  return (
    <section className="ce-panel ce-roster overflow-hidden" aria-labelledby="roster-title">
      <div className="ce-panel-title px-3.5 py-2" id="roster-title">People in this drill</div>
      <div className="divide-y divide-[#b8cad6]">
        {[evacuee, warden].filter(Boolean).map((participant) => {
          const item = participant!;
          const isSelf = item.id === myId;
          const stateLabel = item.role === "evacuee" ? evacueeState : presenceOf(item);
          return (
            <div key={item.id} className="flex items-center justify-between gap-3 px-3.5 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className={`grid h-8 w-8 shrink-0 place-items-center border-2 ${item.role === "warden" ? "border-[#3978c8] bg-[#d9e9f8]" : "border-[#218052] bg-[#d9f0e3]"} font-mono text-xs font-black text-[#173457]`} aria-hidden>
                  {item.role === "warden" ? "W" : "E"}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-xs font-black uppercase text-[#173457]">{item.name}{isSelf ? " / you" : ""}</div>
                  <div className="font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-[#607892]">{item.role ?? "seat pending"}</div>
                </div>
              </div>
              <span className={`shrink-0 font-mono text-[9px] font-black uppercase tracking-[0.08em] ${stateLabel === "assembled" ? "text-[#0a8751]" : stateLabel === "drill ended" ? "text-[#bf3a3e]" : "text-[#607892]"}`}>
                {stateLabel}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Alerts() {
  const smoke = useSimulation((state) => state.smokeIntensity);
  const routeStatus = useSimulation((state) => state.routeStatus);
  const sector = useSimulation((state) => state.sector);
  const mode = useSimulation((state) => state.mode);
  const failed = useSimulation((state) => state.failed);
  const evidenceMap = useSimulation((state) => state.evidence);
  const evidence = Object.values(evidenceMap);
  const alerts: { label: string; detail: string; tone: "danger" | "warning" | "info" }[] = [];

  if (failed) alerts.push({ label: "Drill ended", detail: "The simulation has recorded a failed outcome.", tone: "danger" });
  if (routeStatus === "unsafe") alerts.push({ label: "Route unsafe", detail: "The authored east route is unsafe at the current hazard time.", tone: "danger" });
  if (smoke > 0.2) {
    const monitoredSector = mode.kind === "warden" ? mode.sectorId : sector;
    alerts.push({ label: "Smoke detected", detail: `${roomById(monitoredSector).name} is reporting smoke exposure.`, tone: "warning" });
  }
  const pendingEvidence = evidence.filter((item) => item.status !== "VERIFIED");
  if (pendingEvidence.length > 0) alerts.push({ label: "Evidence needs review", detail: `${pendingEvidence.length} sector record${pendingEvidence.length === 1 ? "" : "s"} is not verified.`, tone: "info" });

  return (
    <section className="ce-panel ce-alert-panel overflow-hidden" aria-labelledby="alerts-title">
      <div className="ce-panel-title flex items-center justify-between gap-3 px-3.5 py-2" id="alerts-title">
        <span>Active alerts</span>
        <span className="font-mono text-[9px] font-bold normal-case tracking-normal text-[#607892]">{alerts.length}</span>
      </div>
      {alerts.length === 0 ? (
        <div className="px-3.5 py-4 text-xs font-semibold text-[#607892]">No active alert is present in the assigned feed.</div>
      ) : (
        <ul className="divide-y divide-[#b8cad6]">
          {alerts.map((alert) => (
            <li key={alert.label} className="flex gap-2.5 px-3.5 py-3">
              <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center border-2 text-xs font-black ${alert.tone === "danger" ? "border-[#c24343] bg-[#f8dddd] text-[#b22f34]" : alert.tone === "warning" ? "border-[#c68a2a] bg-[#fff0c8] text-[#966019]" : "border-[#3978c8] bg-[#dcebf8] text-[#245e9f]"}`} aria-hidden>
                {alert.tone === "danger" ? "!" : alert.tone === "warning" ? "!" : "i"}
              </span>
              <div>
                <div className="text-xs font-black uppercase text-[#173457]">{alert.label}</div>
                <div className="mt-1 text-[11px] leading-relaxed text-[#526b83]">{alert.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EvidenceReview() {
  const evidenceMap = useSimulation((state) => state.evidence);
  const observeEvidence = useSession((state) => state.observeEvidence);
  const evidence = Object.values(evidenceMap);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="ce-panel ce-evidence-panel overflow-hidden" aria-labelledby="evidence-title">
      <div className="ce-panel-title flex items-center justify-between gap-3 px-3.5 py-2" id="evidence-title">
        <span>Sector evidence</span>
        <span className="font-mono text-[9px] font-bold normal-case tracking-normal text-[#607892]">{evidence.length} records</span>
      </div>
      {evidence.length === 0 ? (
        <div className="px-3.5 py-4 text-xs text-[#607892]">Waiting for the assigned sector feed.</div>
      ) : (
        <ul className="divide-y divide-[#b8cad6]">
          {evidence.map((item) => {
            const age = item.observedAt ? `${Math.max(0, Math.floor((now - item.observedAt) / 1000))}s ago` : "not observed";
            const color = item.status === "VERIFIED" ? "text-[#0b8751]" : item.status === "OBSERVED" ? "text-[#9b6718]" : "text-[#b13a3f]";
            return (
              <li key={item.id} className="px-3.5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-black text-[#173457]">{item.label}</div>
                    <div className="mt-1 text-[10px] text-[#607892]">{item.source} · {age}</div>
                  </div>
                  <span className={`font-mono text-[9px] font-black ${color}`}>{item.status}</span>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-[#526b83]">{item.nextAction}</p>
                {item.status === "UNKNOWN" && (
                  <button onClick={() => observeEvidence(item.id)} className="ce-button-secondary mt-2 min-h-8 px-2.5 py-1 text-[9px]">
                    Observe record
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function CommandPanel() {
  const evidence = useSimulation((state) => state.evidence["east-route-evidence"]);
  const interventionApplied = useSimulation((state) => state.interventionApplied);
  const acknowledgement = useSimulation((state) => state.lastAcknowledgement);
  const sendCommand = useSession((state) => state.sendCommand);
  const [sent, setSent] = useState<CommandCode | null>(null);

  return (
    <section className="ce-panel ce-command-panel overflow-hidden" aria-labelledby="commands-title">
      <div className="ce-panel-title px-3.5 py-2" id="commands-title">Warden actions</div>
      <div className="grid gap-2 p-3">
        {COMMANDS.map((command) => {
          const disabled =
            command.code === "VERIFY_EAST_ROUTE"
              ? evidence?.status !== "OBSERVED"
              : command.code === "SEND_WEST_ROUTE" || command.code === "MARK_EAST_UNSAFE"
                ? evidence?.status !== "VERIFIED"
                : interventionApplied || evidence?.status !== "VERIFIED";
          return (
            <button
              key={command.code}
              disabled={disabled}
              onClick={() => {
                sendCommand(command.code, command.code === "APPLY_VENTILATION" ? undefined : "east-route-evidence");
                setSent(command.code);
                window.setTimeout(() => setSent((current) => current === command.code ? null : current), 900);
              }}
              className="ce-command-button flex min-h-11 items-center justify-between gap-3 border-2 border-[#91abc0] bg-[#eff5f8] px-3 text-left transition enabled:hover:border-[#3978c8] enabled:hover:bg-[#e1edf5] disabled:cursor-not-allowed disabled:opacity-45"
              style={{ borderLeftColor: command.color, borderLeftWidth: 5 }}
            >
              <span>
                <span className="block font-mono text-[10px] font-black uppercase text-[#173457]">{sent === command.code ? "Command sent" : command.label}</span>
                <span className="mt-0.5 block text-[10px] leading-snug text-[#607892]">{command.detail}</span>
              </span>
              <span className="font-mono text-[9px] font-black uppercase text-[#3978c8]">{disabled ? "locked" : "ready"}</span>
            </button>
          );
        })}
      </div>
      {acknowledgement && (
        <div className={`border-t-2 px-3.5 py-2.5 text-[11px] font-semibold ${acknowledgement.accepted ? "border-[#8cc4a8] bg-[#e2f3e9] text-[#126b46]" : "border-[#e6a8a8] bg-[#f9e5e5] text-[#9b3036]"}`} role="status">
          {acknowledgement.accepted ? "Accepted" : "Denied"}: {acknowledgement.reason ?? "State update recorded."}
        </div>
      )}
    </section>
  );
}

function WardenMap() {
  const mode = useSimulation((state) => state.mode);
  const sector = useSimulation((state) => state.sector);
  const assigned = mode.kind === "warden" ? mode.sectorId : sector;
  return (
    <section className="ce-frame overflow-hidden" aria-labelledby="warden-map-title">
      <div id="warden-map-title" className="sr-only">Live sector map for {roomById(assigned).name}</div>
      <TacticalMap />
      <div className="border-t border-[#a7bdcc] bg-[#e0ebf1] px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#516b83]">
        Map data is scoped to the live drill and assigned warden sector.
      </div>
    </section>
  );
}

export default function WardenConsole({ view, setView }: { view: ViewMode; setView: (view: ViewMode) => void }) {
  const mode = useSimulation((state) => state.mode);
  const room = useSession((state) => resolveRoom(state.room));
  const routeStatus = useSimulation((state) => state.routeStatus);
  const smoke = useSimulation((state) => state.smokeIntensity);
  const complete = useSimulation((state) => state.assemblyConfirmed);
  const failed = useSimulation((state) => state.failed);
  const evacueeState = complete ? "assembled" : failed ? "drill ended" : "moving";
  const sector = mode.kind === "warden" ? mode.sectorId : "sec";

  return (
    <main className="ce-scrollbar ce-role-console absolute inset-0 overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-[1380px] flex-col px-3 pb-6 sm:px-5 lg:px-7">
        <header className="ce-topbar -mx-3 flex min-h-14 flex-wrap items-center justify-between gap-3 px-3 py-2 sm:-mx-5 sm:px-5 lg:-mx-7 lg:px-7">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="ce-brand-mark h-8 w-8">CE</span>
            <div className="min-w-0">
              <div className="ce-brand truncate">CampusEvac</div>
              <div className="hidden font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-[#9bb6cf] sm:block">Warden command console</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[#9bb6cf] md:inline">Sector / {sector}</span>
            <ConnectionStatus />
          </div>
        </header>

        <nav className="ce-view-tabs flex flex-wrap items-center gap-1 border-x-2 border-b-2 border-[#557da5] bg-[#132b50] p-1.5" aria-label="Warden console views">
          {(["warden", "evidence"] as ViewMode[]).map((item) => (
            <button key={item} onClick={() => setView(item)} className={`ce-view-tab min-h-9 border-2 px-3 font-mono text-[10px] font-black uppercase tracking-[0.1em] ${view === item ? "border-[#f2c14e] bg-[#f2c14e] text-[#13213c]" : "border-transparent text-[#c6d9e8] hover:border-[#6d9bc2]"}`} aria-pressed={view === item}>
              {item === "warden" ? "Overview" : "Evidence review"}
            </button>
          ))}
        </nav>

        <div className="grid flex-1 gap-3 py-3 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-4 lg:py-4">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="Evacuee state" value={evacueeState} tone={complete ? "text-[#0b8751]" : failed ? "text-[#bd383c]" : "text-[#173457]"} />
              <Metric label="Route state" value={routeStatus} tone={routeStatus === "unsafe" ? "text-[#bd383c]" : routeStatus === "intervened" ? "text-[#0b8751]" : "text-[#173457]"} />
              <Metric label="Sector smoke" value={`${Math.round(smoke * 100)}%`} tone={smoke > 0.2 ? "text-[#bd383c]" : "text-[#173457]"} />
            </div>
            <WardenMap />
            {view === "evidence" && <EvidenceReview />}
          </div>

          <aside className="ce-role-rail flex min-w-0 flex-col gap-3">
            <section className="ce-panel ce-assignment-panel p-3.5" aria-labelledby="assignment-title">
              <div id="assignment-title" className="ce-section-label">Supervisor assignment</div>
              <div className="mt-2 text-base font-black uppercase text-[#173457]">{roomById(sector).name}</div>
              <p className="mt-1 text-xs leading-relaxed text-[#526b83]">Monitor the evacuee, verify sector evidence, and communicate only confirmed route changes.</p>
              <div className="mt-3 border-t border-[#b8cad6] pt-3 text-[10px] font-bold uppercase tracking-[0.08em] text-[#607892]">Drill seats: {room?.participants.length ?? 0}/{room?.maxPlayers ?? 0}</div>
            </section>
            <Alerts />
            <Roster />
            {view === "warden" && <CommandPanel />}
            {view === "evidence" && <CommandPanel />}
          </aside>
        </div>
      </div>
    </main>
  );
}
