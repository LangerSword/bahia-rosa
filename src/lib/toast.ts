/**
 * The site talking back.
 *
 * Headless on purpose: this file holds the store and the API, `Toasts.tsx` holds the paint. The shape is
 * the one from the promise-toast component on 21st.dev — `toast.promise(work, { loading, success, error })`
 * — because that is the right shape for this site's actions: they are long, they can fail, and the honest
 * thing is for one notification to *change its mind* rather than for two to arrive in sequence.
 *
 * Three at a time. A stack you cannot read is not feedback; it is noise with a shadow.
 */

export type ToastTone = "plain" | "loading" | "success" | "error";

export interface ToastFacts {
  title: string;
  description?: string;
  tone?: ToastTone;
}

export interface ToastItem extends Required<Pick<ToastFacts, "title">> {
  id: number;
  tone: ToastTone;
  description?: string;
}

const LIFETIMES: Record<ToastTone, number> = {
  plain: 5200,
  // A loading toast has no lifetime: it lives until the work does.
  loading: 0,
  success: 4200,
  error: 9000,
};

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<(current: ToastItem[]) => void>();

function emit(): void {
  for (const listener of listeners) listener(items);
}

export function subscribeToasts(listener: (current: ToastItem[]) => void): () => void {
  listeners.add(listener);
  listener(items);
  return () => {
    listeners.delete(listener);
  };
}

export function dismiss(id: number): void {
  items = items.filter((item) => item.id !== id);
  emit();
}

function place(id: number | null, facts: ToastFacts): number {
  const tone = facts.tone ?? "plain";
  if (id === null) {
    const fresh = nextId++;
    items = [...items.slice(-2), { id: fresh, tone, title: facts.title, description: facts.description }];
    if (LIFETIMES[tone] > 0) window.setTimeout(() => dismiss(fresh), LIFETIMES[tone]);
    emit();
    return fresh;
  }
  items = items.map((item) =>
    item.id === id ? { id, tone, title: facts.title, description: facts.description } : item,
  );
  if (LIFETIMES[tone] > 0) window.setTimeout(() => dismiss(id), LIFETIMES[tone]);
  emit();
  return id;
}

export const toast = {
  show(facts: ToastFacts): number {
    return place(null, facts);
  },

  dismiss,

  /**
   * A notification for something that takes time. It arrives saying "loading", and the outcome replaces it
   * where it stands — same toast, changed. The promise is returned untouched (including its rejection), so
   * callers keep their own error handling and this stays a *report*, not a control flow.
   */
  promise<T>(
    work: Promise<T>,
    copy: {
      loading: ToastFacts;
      success: (value: T) => ToastFacts;
      error: (failure: unknown) => ToastFacts;
    },
  ): Promise<T> {
    const id = place(null, { ...copy.loading, tone: "loading" });
    return work.then(
      (value) => {
        place(id, { ...copy.success(value), tone: "success" });
        return value;
      },
      (failure: unknown) => {
        place(id, { ...copy.error(failure), tone: "error" });
        throw failure;
      },
    );
  },
};