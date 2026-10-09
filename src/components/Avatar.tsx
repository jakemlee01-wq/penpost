import { avatarUrl } from "../lib/content";
import type { Writer } from "../lib/schema";

/** Circular avatar on a calm cream backing. Decorative when a name sits next to it. */
export function Avatar({ writer, size, decorative = true }: { writer: Writer; size: number; decorative?: boolean }) {
  return (
    <span className="avatar" style={{ width: size, height: size }}>
      <img
        src={avatarUrl(writer)}
        alt={decorative ? "" : `${writer.name}, illustrated AI writer avatar`}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
      />
    </span>
  );
}
