/** Mouse double-click and touch double-tap, without treating a drag or long press as a tap. */
export function bindDoubleTap(root: HTMLElement | Document, onDouble: (event: MouseEvent | PointerEvent) => void, onSingle?: (event: MouseEvent) => void) {
  let down: { x: number; y: number; at: number } | null = null;
  let previous: { x: number; y: number; at: number } | null = null;
  let lastDouble = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const eligible = (event: Event) => !(event.target as Element | null)?.closest?.("a[href], button, input, textarea, select, [contenteditable='true']");
  const double = (event: MouseEvent | PointerEvent) => {
    if (!eligible(event)) return;
    clearTimeout(timer);
    lastDouble = Date.now();
    event.preventDefault();
    onDouble(event);
  };
  const pointerDown = (event: PointerEvent) => {
    if (event.pointerType === "touch") down = { x: event.clientX, y: event.clientY, at: Date.now() };
  };
  const pointerUp = (event: PointerEvent) => {
    if (event.pointerType !== "touch" || !down) return;
    const tap = { x: event.clientX, y: event.clientY, at: Date.now() };
    if (tap.at - down.at > 300 || Math.hypot(tap.x - down.x, tap.y - down.y) > 12) { previous = null; return; }
    if (previous && tap.at - previous.at < 350 && Math.hypot(tap.x - previous.x, tap.y - previous.y) < 24) { previous = null; double(event); }
    else previous = tap;
    down = null;
  };
  const cancel = () => { down = null; previous = null; };
  const click = (event: MouseEvent) => {
    if (!eligible(event) || Date.now() - lastDouble < 500 || event.detail > 1) return;
    clearTimeout(timer);
    if (onSingle) timer = setTimeout(() => onSingle(event), 350);
  };
  // Document and HTMLElement have different listener overloads for the same native events.
  const target = root as HTMLElement;
  target.addEventListener("dblclick", double);
  target.addEventListener("pointerdown", pointerDown);
  target.addEventListener("pointerup", pointerUp);
  target.addEventListener("pointercancel", cancel);
  target.addEventListener("click", click);
  return () => {
    clearTimeout(timer);
    target.removeEventListener("dblclick", double);
    target.removeEventListener("pointerdown", pointerDown);
    target.removeEventListener("pointerup", pointerUp);
    target.removeEventListener("pointercancel", cancel);
    target.removeEventListener("click", click);
  };
}
