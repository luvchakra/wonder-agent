"use client";

/**
 * A request's number under a barcode-style picture (owner request,
 * 2026-10-14), shown once a request is created. The bars are decoration
 * only, a fixed pattern that encodes nothing: the number below is what
 * people read and quote. The bars rise in from left to right and a scan
 * line passes over them once; under reduced motion the picture is simply
 * there.
 */
const BARS = [2, 1, 1, 3, 1, 2, 3, 1, 1, 1, 2, 2, 1, 3, 2, 1, 1, 2, 1, 1, 3, 1, 2, 1, 1, 2, 2, 3, 1, 1, 2, 1, 3, 2, 1, 1, 1, 2, 1, 3, 2, 1, 2, 1, 1, 3, 1, 2];

export function RequestNumberBarcode({ number, label = "Request number" }: { number: string; label?: string }) {
  const bars: { x: number; w: number }[] = [];
  let x = 0;
  BARS.forEach((w, i) => {
    if (i % 2 === 0) bars.push({ x, w });
    x += w;
  });
  return (
    <figure className="wa-barcode inline-flex flex-col items-center rounded-lg border border-border bg-card px-4 pb-3 pt-4 text-card-foreground shadow-sm">
      <div aria-hidden="true" className="relative overflow-hidden rounded-sm bg-white px-2 py-1">
        <svg viewBox={`0 0 ${x} 40`} preserveAspectRatio="none" className="block h-14 w-56 max-w-full">
          {bars.map((b, i) => (
            <rect key={i} x={b.x} y={0} width={b.w} height={40} fill="#000" className="wa-barcode-bar" style={{ animationDelay: `${Math.round((b.x / x) * 450)}ms` }} />
          ))}
        </svg>
        <span className="wa-barcode-scan pointer-events-none absolute inset-y-0 left-0 w-1 bg-primary/70 shadow-[0_0_8px_2px] shadow-primary/50" />
      </div>
      <figcaption className="mt-2 text-center">
        <span className="block text-xs text-muted-foreground">{label}</span>
        <span className="wa-barcode-number block font-mono text-lg font-semibold tracking-[0.2em] text-foreground">{number}</span>
      </figcaption>
    </figure>
  );
}
