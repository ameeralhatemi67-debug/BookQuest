"use client";

// Accessible overlays built on Radix primitives (focus trap, Escape, aria
// wiring, scroll lock) with this app's styling.
import { X } from "lucide-react";
import { Dialog as RDialog, DropdownMenu as RMenu, Popover as RPopover, Tooltip as RTooltip } from "radix-ui";
import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/format";

/**
 * Where overlays are portalled. The reader sets this to its own root so that
 * dialogs, panels and popovers inherit the reader's page theme (and its
 * full-screen stacking context) instead of the app shell's.
 */
export const PortalContainerContext = createContext<HTMLElement | null>(null);
const usePortalContainer = () => useContext(PortalContainerContext) ?? undefined;

// ---------------------------------------------------------------- Dialog
export const Dialog = RDialog.Root;
export const DialogTrigger = RDialog.Trigger;
export const DialogClose = RDialog.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
  hideClose,
  ...props
}: Omit<ComponentProps<typeof RDialog.Content>, "title"> & { title: ReactNode; description?: ReactNode; hideClose?: boolean }) {
  const container = usePortalContainer();
  return (
    <RDialog.Portal container={container}>
      <RDialog.Overlay className="fixed inset-0 z-50 bg-ink/35 backdrop-blur-[2px] data-[state=open]:animate-fade-in dark:bg-black/60" />
      <RDialog.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 flex max-h-[min(90dvh,760px)] w-[calc(100vw-1.5rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col",
          "rounded-3xl border border-line bg-raised shadow-lift data-[state=open]:animate-pop-in focus:outline-none",
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <div className="min-w-0">
            <RDialog.Title className="font-display text-2xl leading-tight text-ink">{title}</RDialog.Title>
            {description ? (
              <RDialog.Description className="mt-1.5 text-sm leading-relaxed text-ink-soft">{description}</RDialog.Description>
            ) : (
              <RDialog.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</RDialog.Description>
            )}
          </div>
          {!hideClose && (
            <RDialog.Close
              className="-mr-2 -mt-2 inline-flex size-10 shrink-0 items-center justify-center rounded-full text-ink-faint hover:bg-sunk hover:text-ink"
              aria-label="Close"
            >
              <X className="size-5" aria-hidden />
            </RDialog.Close>
          )}
        </div>
        <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4">{children}</div>
      </RDialog.Content>
    </RDialog.Portal>
  );
}

// ---------------------------------------------------------------- Sheet
// A panel that unfolds from the right on wide screens and rises from the
// bottom on phones. Used for the note thread so the book stays in view.
export const Sheet = RDialog.Root;
export const SheetClose = RDialog.Close;

export function SheetContent({
  title,
  children,
  className,
  modal = true,
  ...props
}: Omit<ComponentProps<typeof RDialog.Content>, "title"> & { title: string; modal?: boolean }) {
  const container = usePortalContainer();
  return (
    <RDialog.Portal container={container}>
      {modal && <RDialog.Overlay className="fixed inset-0 z-40 bg-ink/20 data-[state=open]:animate-fade-in dark:bg-black/50" />}
      <RDialog.Content
        className={cn(
          "fixed z-50 flex flex-col border-line bg-raised shadow-lift focus:outline-none",
          // phone: bottom sheet
          "inset-x-0 bottom-0 max-h-[82dvh] rounded-t-3xl border-t data-[state=open]:animate-slide-in-up",
          // ≥ sm: margin panel
          "sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[min(420px,92vw)] sm:rounded-none sm:rounded-l-3xl sm:border-l sm:border-t-0 sm:data-[state=open]:animate-slide-in-right",
          className,
        )}
        {...props}
      >
        <RDialog.Title className="sr-only">{title}</RDialog.Title>
        <RDialog.Description className="sr-only">{title}</RDialog.Description>
        {children}
      </RDialog.Content>
    </RDialog.Portal>
  );
}

// ---------------------------------------------------------------- Popover
export const Popover = RPopover.Root;
export const PopoverTrigger = RPopover.Trigger;
export const PopoverArrow = RPopover.Arrow;
export const PopoverAnchor = RPopover.Anchor;
export const PopoverClose = RPopover.Close;

export function PopoverContent({ className, sideOffset = 8, collisionPadding = 12, ...props }: ComponentProps<typeof RPopover.Content>) {
  const container = usePortalContainer();
  return (
    <RPopover.Portal container={container}>
      <RPopover.Content
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          "z-50 w-[min(340px,calc(100vw-1.5rem))] rounded-2xl border border-line bg-raised p-4 text-ink shadow-lift",
          "data-[state=open]:animate-pop-in focus:outline-none",
          className,
        )}
        {...props}
      />
    </RPopover.Portal>
  );
}

// ---------------------------------------------------------------- Menu
export const Menu = RMenu.Root;
export const MenuTrigger = RMenu.Trigger;

export function MenuContent({ className, sideOffset = 8, ...props }: ComponentProps<typeof RMenu.Content>) {
  const container = usePortalContainer();
  return (
    <RMenu.Portal container={container}>
      <RMenu.Content
        sideOffset={sideOffset}
        collisionPadding={12}
        className={cn(
          "z-50 min-w-52 rounded-2xl border border-line bg-raised p-1.5 text-ink shadow-lift data-[state=open]:animate-pop-in",
          className,
        )}
        {...props}
      />
    </RMenu.Portal>
  );
}

export function MenuItem({ className, danger, ...props }: ComponentProps<typeof RMenu.Item> & { danger?: boolean }) {
  return (
    <RMenu.Item
      className={cn(
        "flex min-h-10 cursor-default select-none items-center gap-2.5 rounded-xl px-3 text-sm outline-none",
        "data-[highlighted]:bg-sunk data-[disabled]:opacity-50",
        danger ? "text-danger" : "text-ink",
        className,
      )}
      {...props}
    />
  );
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof RMenu.Label>) {
  return <RMenu.Label className={cn("px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wider text-ink-faint", className)} {...props} />;
}

export function MenuSeparator() {
  return <RMenu.Separator className="my-1.5 h-px bg-line" />;
}

// ---------------------------------------------------------------- Tooltip
export const TooltipProvider = RTooltip.Provider;

/** Supplementary only: nothing essential is ever available solely on hover. */
export function Tooltip({ label, children, side = "top" }: { label: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  const container = usePortalContainer();
  return (
    <RTooltip.Root delayDuration={250}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal container={container}>
        <RTooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-[60] max-w-64 rounded-lg bg-ink px-2.5 py-1.5 text-xs text-paper shadow-lift data-[state=delayed-open]:animate-fade-in"
        >
          {label}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}
