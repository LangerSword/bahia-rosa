import { useEffect, useState, type ReactElement } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { dismissAlert, subscribeAlerts, type Alert } from "../lib/alerts";
import "./alerts.css";

/**
 * The alert stack — conditions that wait for the visitor instead of a toast that leaves on a timer.
 *
 * Painted like everything else here: ink ground, hairline, one accent edge that says how serious it is. A
 * `stop` interrupts (role="alert"); a `warn` is read out when the screen reader reaches it (role="status"),
 * so a warning never hijacks the page the way an error does.
 */
export function Alerts(): ReactElement {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const reduce = useReducedMotion();

  useEffect(() => subscribeAlerts(setAlerts), []);

  return (
    <div className="alert-stack" data-testid="alert-stack" aria-label="Messages">
      <AnimatePresence initial={false}>
        {alerts.map((alert) => (
          <motion.div
            key={alert.id}
            layout={!reduce}
            initial={reduce ? undefined : { opacity: 0, y: -10 }}
            animate={reduce ? undefined : { opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="alert"
            data-tone={alert.tone}
            data-testid={`alert-${alert.id}`}
            role={alert.tone === "stop" ? "alert" : "status"}
          >
            <div className="alert-body">
              <p className="alert-title">{alert.title}</p>
              {alert.detail ? <p className="alert-detail">{alert.detail}</p> : null}
            </div>
            <button
              type="button"
              className="alert-dismiss"
              aria-label={`Dismiss: ${alert.title}`}
              data-testid={`dismiss-${alert.id}`}
              onClick={() => dismissAlert(alert.id)}
            >
              Dismiss
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}