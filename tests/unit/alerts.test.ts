import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALERT_LIMIT,
  clearAlerts,
  dismissAlert,
  pushAlert,
  readAlerts,
  subscribeAlerts,
} from "../../src/lib/alerts";

describe("the alert stack", () => {
  beforeEach(() => {
    clearAlerts();
  });

  it("keeps what it was told, in the order it was told", () => {
    pushAlert({ tone: "warn", title: "first" });
    pushAlert({ tone: "stop", title: "second" });
    expect(readAlerts().map((alert) => alert.title)).toEqual(["first", "second"]);
  });

  it("carries a reason with the condition", () => {
    pushAlert({ tone: "stop", title: "that photograph could not be pressed", detail: "the image was not readable" });
    const [alert] = readAlerts();
    expect(alert.detail).toBe("the image was not readable");
    expect(alert.tone).toBe("stop");
  });

  it("replaces a condition rather than stacking the same one twice", () => {
    pushAlert({ id: "press-failure", tone: "stop", title: "first failure" });
    pushAlert({ id: "press-failure", tone: "stop", title: "second failure" });
    expect(readAlerts()).toHaveLength(1);
    expect(readAlerts()[0].title).toBe("second failure");
  });

  it("lets a condition be dismissed, and does nothing when it is already gone", () => {
    const id = pushAlert({ tone: "warn", title: "a warning" });
    dismissAlert(id);
    expect(readAlerts()).toHaveLength(0);
    expect(() => dismissAlert(id)).not.toThrow();
    expect(readAlerts()).toHaveLength(0);
  });

  it("caps the stack instead of becoming a wall of messages", () => {
    for (let index = 0; index < ALERT_LIMIT + 3; index += 1) {
      pushAlert({ tone: "warn", title: `condition ${index}` });
    }
    const alerts = readAlerts();
    expect(alerts).toHaveLength(ALERT_LIMIT);
    expect(alerts[alerts.length - 1].title).toBe(`condition ${ALERT_LIMIT + 2}`);
  });

  it("tells every listener, including one that arrives late", () => {
    const early = vi.fn();
    const unsubscribe = subscribeAlerts(early);
    expect(early).toHaveBeenCalledWith([]);
    pushAlert({ tone: "warn", title: "hello" });
    expect(early).toHaveBeenLastCalledWith([expect.objectContaining({ title: "hello" })]);

    const late = vi.fn();
    subscribeAlerts(late);
    expect(late).toHaveBeenCalledWith([expect.objectContaining({ title: "hello" })]);

    unsubscribe();
    pushAlert({ tone: "warn", title: "second" });
    expect(early).toHaveBeenCalledTimes(2);
  });
});