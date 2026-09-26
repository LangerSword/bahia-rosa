import { useEffect, useState, type ReactElement } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { dismiss, subscribeToasts, type ToastItem } from "../lib/toast";
import "./toast.css";

/**
 * Where the site talks back.
 *
 * Top right, under the masthead: the bottom of the screen belongs to the phone's sticky bar and to the
 * visitor's own scroll, and a notification that lands under someone's thumb is a notification they did not
 * get. `role="status"` and `aria-live="polite"` mean a screen reader hears it once, in order, without
 * being interrupted.
 */

const MARK: Record<ToastItem["tone"], string> = {
  plain: "·",
  loading: "…",
  success: "✓",
  error: "✕",
};

export function Toasts(): ReactElement {
  const [items, setItems] = useState<ToastItem[]>([]);
  const reduce = useReducedMotion();

  useEffect(() => subscribeToasts(setItems), []);

  return (
    <div className="toast-rack" role="status" aria-live="polite" data-testid="toasts">
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <motion.div
            key={item.id}
            className="toast"
            data-tone={item.tone}
            initial={reduce ? undefined : { opacity: 0, y: -10, scale: 0.985 }}
            animate={reduce ? undefined : { opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? undefined : { opacity: 0, y: -8, scale: 0.99 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="toast-mark" aria-hidden="true">
              {MARK[item.tone]}
            </span>
            <span className="toast-body">
              <b>{item.title}</b>
              {item.description ? <em>{item.description}</em> : null}
            </span>
            <button
              type="button"
              className="toast-close"
              aria-label={`Dismiss: ${item.title}`}
              onClick={() => dismiss(item.id)}
            >
              ✕
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}