/** One thin segment per story. Filled = moved through. Current = highlighted. */
export function ProgressSegments({ total, index, seen }: { total: number; index: number; seen: boolean[] }) {
  return (
    <div
      className="progress"
      role="progressbar"
      aria-label="Edition progress"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={Math.min(index, total)}
      aria-valuetext={index >= total ? "Finished" : `Story ${index + 1} of ${total}`}
    >
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`seg${seen[i] ? " seg-done" : ""}${i === index ? " seg-current" : ""}`} />
      ))}
    </div>
  );
}
