import { describe, expect, it } from "vitest";
import { buildCompletionModel, type CompletionModelInput } from "./result-model";

const input: CompletionModelInput = {
  complete: true,
  abandoned: false,
  elapsed: 272,
  completedObjectives: 6,
  totalObjectives: 6,
  health: 84,
  safeEvacuees: 1,
  totalEvacuees: 1,
  routeStatus: "intervened",
  smokeIntensity: 0.42,
};

describe("completion result models", () => {
  it("routes an evacuee to personal completion metrics", () => {
    const result = buildCompletionModel({ kind: "evacuee" }, input);

    expect(result.role).toBe("evacuee");
    expect(result.headline).toBe("You got out safely.");
    expect(result.metrics.map((metric) => metric.label)).toEqual(["Time", "Steps", "Health"]);
    expect(result.metrics.map((metric) => metric.value)).toEqual(["4:32", "6/6", "84"]);
  });

  it("routes a warden to drill-level summary metrics", () => {
    const result = buildCompletionModel({ kind: "warden" }, input);

    expect(result.role).toBe("warden");
    expect(result.headline).toBe("Evacuation drill summary");
    expect(result.metrics.map((metric) => metric.label)).toEqual([
      "Evacuees",
      "Route",
      "Sector smoke",
    ]);
    expect(result.metrics.some((metric) => ["Time", "Steps", "Health"].includes(metric.label))).toBe(false);
  });

  it("keeps an abandoned evacuee result separate from the warden result", () => {
    const result = buildCompletionModel(
      { kind: "evacuee" },
      { ...input, complete: false, abandoned: true, safeEvacuees: 0 },
    );

    expect(result.role).toBe("evacuee");
    expect(result.headline).toBe("A player did not return.");
    expect(result.metrics.map((metric) => metric.label)).not.toContain("Evacuees");
  });
});
