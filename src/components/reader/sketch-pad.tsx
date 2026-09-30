"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Button } from "@/components/ui/button";

export function SketchPad({ onSave, onCancel }: { onSave(file: File): void; onCancel(): void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pad = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const [color, setColor] = useState("#8a3d1d");
  const [size, setSize] = useState(4);
  const [hasInk, setHasInk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clear = () => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, context.canvas.width, context.canvas.height);
    setHasInk(false);
  };
  useEffect(() => { clear(); pad.current?.scrollIntoView({ block: "nearest" }); }, []);
  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - box.left) * event.currentTarget.width / box.width, y: (event.clientY - box.top) * event.currentTarget.height / box.height, ratio: event.currentTarget.width / box.width };
  };
  const start = (event: PointerEvent<HTMLCanvasElement>) => {
    if (saving || pointer.current !== null || (event.pointerType === "mouse" && event.button !== 0)) return;
    const context = event.currentTarget.getContext("2d");
    if (!context) { setError("Drawing isn't available in this browser."); return; }
    pointer.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    const { x, y, ratio } = point(event);
    context.strokeStyle = color; context.fillStyle = color; context.lineWidth = size * ratio;
    context.lineCap = "round"; context.lineJoin = "round";
    context.beginPath(); context.arc(x, y, size * ratio / 2, 0, Math.PI * 2); context.fill();
    context.beginPath(); context.moveTo(x, y);
    setHasInk(true); setError(null);
  };
  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    if (pointer.current !== event.pointerId) return;
    const context = event.currentTarget.getContext("2d");
    const { x, y } = point(event);
    context?.lineTo(x, y); context?.stroke();
  };
  const finish = (event: PointerEvent<HTMLCanvasElement>) => {
    if (pointer.current !== event.pointerId) return;
    pointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const save = () => {
    setSaving(true);
    canvas.current?.toBlob(blob => {
      if (!blob) { setError("Couldn't save the drawing. Your sketch is still here; try again."); setSaving(false); return; }
      onSave(new File([blob], `drawing-${Date.now()}.png`, { type: "image/png" }));
    }, "image/png");
  };
  return (
    <div ref={pad} className="space-y-3 rounded-xl border border-line bg-sunk/40 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">Color <input type="color" aria-label="Stroke color" value={color} onChange={event => setColor(event.target.value)} className="size-11 cursor-pointer rounded border border-line" disabled={saving} /></label>
        <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">Stroke <input type="range" aria-label="Stroke size" min={1} max={16} value={size} onChange={event => setSize(Number(event.target.value))} className="min-w-0 flex-1 accent-accent" disabled={saving} /><span className="w-8 text-xs tabular-nums">{size}px</span></label>
      </div>
      <canvas ref={canvas} width={800} height={480} aria-label="Drawing canvas" className="block aspect-[5/3] w-full touch-none rounded-lg bg-white" style={{ cursor: "crosshair" }} onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} />
      <p className="text-xs text-ink-faint">Draw with your finger, pen, or mouse. Add it to this page&apos;s note when you&apos;re done.</p>
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={clear} disabled={!hasInk || saving}>Clear drawing</Button>
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving}>Cancel drawing</Button>
        <Button size="sm" onClick={save} disabled={!hasInk} loading={saving}>Add drawing</Button>
      </div>
    </div>
  );
}
