"use client";

import { code128B } from "./barcode";

/**
 * A request's number with its Code 128 barcode (owner request, 2026-10-14),
 * shown once a request is created. The bars rise in from left to right and a
 * scan line passes over them once; under reduced motion the barcode is simply
 * there. The number is also plain text, so the barcode is never the only way
 * to read it.
 */
export function RequestNumberBarcode({ number, label = "Request number" }: { number: string; label?: string }) {
  const widths = code128B(number);
  const quiet = 10;
  const total = widths.reduce((s, w) => s + w, 0) + quiet * 2;
  const bars: { x: number; w: number }[] = [];
  let x = quiet;
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push({ x, w });
    x += w;
  });
  return (
    <figure className="wa-barcode inline-flex flex-col items-center rounded-lg border border-border bg-card px-4 pb-3 pt-4 text-card-foreground shadow-sm">
      <div className="relative overflow-hidden rounded-sm bg-white px-1 py-1">
        <svg viewBox={`0 0 ${total} 60`} preserveAspectRatio="none" className="block h-16 w-64 max-w-full" role="img" aria-label={`Barcode for ${number}`}>
          {bars.map((b, i) => (
            <rect key={i} x={b.x} y={0} width={b.w} height={60} fill="#000" className="wa-barcode-bar" style={{ animationDelay: `${Math.round((b.x / total) * 450)}ms` }} />
          ))}
        </svg>
        <span aria-hidden="true" className="wa-barcode-scan pointer-events-none absolute inset-y-0 left-0 w-1 bg-primary/70 shadow-[0_0_8px_2px] shadow-primary/50" />
      </div>
      <figcaption className="mt-2 text-center">
        <span className="block text-xs text-muted-foreground">{label}</span>
        <span className="wa-barcode-number block font-mono text-lg font-semibold tracking-[0.2em] text-foreground">{number}</span>
      </figcaption>
    </figure>
  );
}
