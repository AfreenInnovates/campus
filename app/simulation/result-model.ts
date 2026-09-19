export type CompletionMode = { kind: "solo" | "evacuee" | "warden" };

export interface CompletionModelInput {
  complete: boolean;
  abandoned: boolean;
  elapsed: number;
  completedObjectives: number;
  totalObjectives: number;
  health: number;
  safeEvacuees: number;
  totalEvacuees: number;
  routeStatus: "clear" | "unsafe" | "intervened";
  smokeIntensity: number;
}

export interface CompletionMetric {
  label: string;
  value: string;
}

export type CompletionModel =
  | {
      role: "evacuee";
      tag: "Drill complete" | "Drill ended";
      headline: string;
      metrics: CompletionMetric[];
    }
  | {
      role: "warden";
      tag: "Drill complete" | "Drill ended";
      headline: "Evacuation drill summary";
      metrics: CompletionMetric[];
    };

const formatTime = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

const clampPercent = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 100);

export function buildCompletionModel(
  mode: CompletionMode,
  input: CompletionModelInput,
): CompletionModel {
  const tag = input.complete ? "Drill complete" : "Drill ended";

  if (mode.kind === "warden") {
    return {
      role: "warden",
      tag,
      headline: "Evacuation drill summary",
      metrics: [
        { label: "Evacuees", value: `${input.safeEvacuees}/${input.totalEvacuees}` },
        { label: "Route", value: input.routeStatus },
        { label: "Sector smoke", value: `${clampPercent(input.smokeIntensity)}%` },
      ],
    };
  }

  return {
    role: "evacuee",
    tag,
    headline: input.complete
      ? "You got out safely."
      : input.abandoned
        ? "A player did not return."
        : "Not this time.",
    metrics: [
      { label: "Time", value: formatTime(input.elapsed) },
      { label: "Steps", value: `${input.completedObjectives}/${input.totalObjectives}` },
      { label: "Health", value: String(Math.round(input.health)) },
    ],
  };
}
