/** Shared geometry for Dialog and destructive AlertDialog semantics. */
export const dialogOverlayClassName = "okhub-dialog-overlay-motion fixed inset-0 z-50 bg-[var(--color-overlay)] transition-opacity duration-[var(--motion-control-duration)] ease-[var(--motion-control-easing)] motion-reduce:animate-none motion-reduce:transition-none";
export const dialogSurfaceClassName = "okhub-dialog-content-motion fixed z-50 flex flex-col rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--dialog-padding)] shadow-[var(--shadow-overlay)] transition-[opacity,transform] duration-[var(--motion-control-duration)] ease-[var(--motion-control-easing)] motion-reduce:animate-none motion-reduce:transition-none";
export const dialogPositionClassName = "top-1/2 left-1/2 max-h-[calc(100dvh-3rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden";
export const dialogDefaultWidthClassName = "w-[min(calc(100vw-3rem),35rem)]";
export const dialogTitleClassName = "m-0 font-[number:var(--font-weight-section-title)] text-[length:var(--font-section-size)] leading-[var(--font-section-line)] text-[var(--color-text-strong)]";
export const dialogDescriptionClassName = "m-0 mt-[var(--space-1)] font-[number:var(--font-weight-description)] text-[length:var(--font-meta-size)] leading-[var(--font-meta-line)] text-[var(--color-text-muted)]";
