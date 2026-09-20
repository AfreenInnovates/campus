import { describe, expect, it } from "vitest";
import { PresenceTracker } from "./presence";
import { PRESENCE_TIMEOUT_MS, RECONNECT_GRACE_MS } from "./types";

describe("PresenceTracker", () => {
  it("ignores a delayed leave or ping from an older connection", () => {
    const tracker = new PresenceTracker();

    expect(tracker.observe("p1", "old", 100, 100)).toBe(true);
    expect(tracker.observe("p1", "new", 200, 200)).toBe(true);
    expect(tracker.disconnect("p1", "old", 300)).toBeNull();
    expect(tracker.observe("p1", "old", 400, 100)).toBe(false);
    expect(tracker.get("p1")?.connectionId).toBe("new");
  });

  it("moves a silent participant through reconnect grace into expiry", () => {
    const tracker = new PresenceTracker();
    tracker.observe("p1", "c1", 1_000, 1_000);

    const reconnecting = tracker.sweep(1_000 + PRESENCE_TIMEOUT_MS);
    expect(reconnecting).toHaveLength(1);
    expect(reconnecting[0]).toMatchObject({ participantId: "p1", state: "reconnecting" });
    expect(reconnecting[0].reconnectUntil).toBe(
      1_000 + PRESENCE_TIMEOUT_MS + RECONNECT_GRACE_MS,
    );
    expect(tracker.sweep(reconnecting[0].reconnectUntil! - 1)).toEqual([]);

    const expired = tracker.sweep(reconnecting[0].reconnectUntil!);
    expect(expired).toHaveLength(1);
    expect(expired[0]).toMatchObject({ participantId: "p1", state: "expired" });
  });

  it("restores a participant before the shared deadline expires", () => {
    const tracker = new PresenceTracker();
    tracker.observe("p1", "c1", 1_000, 1_000);
    const [reconnecting] = tracker.sweep(1_000 + PRESENCE_TIMEOUT_MS);

    expect(tracker.observe("p1", "c2", reconnecting.reconnectUntil! - 1, 2_000)).toBe(true);
    expect(tracker.get("p1")).toMatchObject({
      connectionId: "c2",
      state: "connected",
      reconnectUntil: null,
    });
    expect(tracker.sweep(reconnecting.reconnectUntil! + 1)).toEqual([]);
  });
});
