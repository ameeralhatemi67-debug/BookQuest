// Page turns as View Transitions.
//
// The browser snapshots the visible page (iframe and canvas included), the
// reader moves underneath, and reader-motion.css animates old and new
// snapshots as a sheet turning on its spine. No page is cloned and nothing is
// re-rendered for the animation, so a turn costs the same as a jump.
//
// Elements become leaves by name: `leaf-right` for a single page or the right
// page of a spread, `leaf-left` for the left page of a spread. `assign` runs
// once before the snapshot and once after the move, so the names can follow
// different DOM elements (PDF pages) or stay on one (the EPUB frame).

export type FlipDirection = 1 | -1;

interface Leaves {
  right: HTMLElement | null;
  left?: HTMLElement | null;
}

type ViewTransitionLike = { finished: Promise<void>; skipTransition(): void };
type DocumentWithTransitions = Document & { startViewTransition?: (update: () => Promise<void> | void) => ViewTransitionLike };

let running: ViewTransitionLike | null = null;

export function canFlip(): boolean {
  if (typeof document === "undefined") return false;
  if (!(document as DocumentWithTransitions).startViewTransition) return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function name(leaves: Leaves | null) {
  if (leaves?.right) leaves.right.style.setProperty("view-transition-name", "leaf-right");
  if (leaves?.left) leaves.left.style.setProperty("view-transition-name", "leaf-left");
}

function unname(leaves: Leaves | null) {
  leaves?.right?.style.removeProperty("view-transition-name");
  leaves?.left?.style.removeProperty("view-transition-name");
}

/**
 * Turns the page. `move` performs the real navigation and resolves once the
 * new page is on screen; `before`/`after` say which elements are the leaves in
 * the old and new state. Without View Transitions (or with reduced motion)
 * this is just `move()`.
 */
export async function flipPage(direction: FlipDirection, move: () => Promise<unknown> | unknown, leaves: { before: () => Leaves | null; after: () => Leaves | null }): Promise<void> {
  const doc = document as DocumentWithTransitions;
  if (!canFlip() || !doc.startViewTransition) {
    await move();
    return;
  }
  // A second turn while one is in flight lands the first immediately.
  running?.skipTransition();

  const root = document.documentElement;
  const old = leaves.before();
  if (!old?.right) {
    await move();
    return;
  }
  root.dataset.flip = direction > 0 ? "next" : "prev";
  name(old);
  let fresh: Leaves | null = null;
  const transition = doc.startViewTransition(async () => {
    unname(old);
    await move();
    fresh = leaves.after();
    name(fresh);
  });
  running = transition;
  try {
    await transition.finished;
  } catch {
    // Skipped or aborted: the page has still moved.
  } finally {
    unname(fresh);
    unname(old);
    if (running === transition) {
      running = null;
      delete root.dataset.flip;
    }
  }
}
