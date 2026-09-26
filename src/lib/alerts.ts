/**
 * Alerts.
 *
 * A toast is a moment — it arrives, it says something, it goes. An alert is a *condition*: the photo that
 * could not be pressed, the thing that needs the visitor's attention and will still be true in ten seconds.
 * Those should not evaporate on a timer, so they stack, they wait, and the visitor dismisses them.
 *
 * Headless store, painted by `Alerts.tsx`, same shape as the toasts so the site has one way of doing this.
 */

export type AlertTone = "stop" | "warn";

export interface Alert {
  id: string;
  tone: AlertTone;
  title: string;
  detail?: string;
}

/** More than three conditions on screen at once is not information, it is a wall. The oldest falls off. */
export const ALERT_LIMIT = 3;

let alerts: Alert[] = [];
let nextId = 0;
const listeners = new Set<(current: Alert[]) => void>();

function announce(): void {
  for (const listener of listeners) listener(alerts);
}

export function pushAlert(alert: Omit<Alert, "id"> & { id?: string }): string {
  const id = alert.id ?? `alert-${++nextId}`;
  const entry: Alert = { id, tone: alert.tone, title: alert.title, detail: alert.detail };
  alerts = [...alerts.filter((existing) => existing.id !== id), entry].slice(-ALERT_LIMIT);
  announce();
  return id;
}

export function dismissAlert(id: string): void {
  const next = alerts.filter((alert) => alert.id !== id);
  if (next.length === alerts.length) return;
  alerts = next;
  announce();
}

export function readAlerts(): Alert[] {
  return alerts;
}

export function clearAlerts(): void {
  alerts = [];
  announce();
}

export function subscribeAlerts(listener: (current: Alert[]) => void): () => void {
  listeners.add(listener);
  listener(alerts);
  return () => {
    listeners.delete(listener);
  };
}