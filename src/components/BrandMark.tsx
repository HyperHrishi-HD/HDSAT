/**
 * The HDSAT tile: a rounded blue square carrying the wide H and the mark's
 * light-blue dot.
 *
 * The dot sits at the top of the right stroke, overlapping the round cap, so it
 * reads as part of the letter instead of a separate dot floating above it. The
 * same geometry is used by `public/favicon.svg` and the welcome emblem, so the
 * tab icon and the on-page tile are one logo.
 */
export function BrandMark({
  size = 34,
  title,
}: {
  size?: number;
  title?: string;
}) {
  return (
    <span
      className="brand-mark"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3) }}
      aria-hidden={title ? undefined : 'true'}
      aria-label={title}
      role={title ? 'img' : undefined}
    >
      <svg
        width={Math.round(size * 0.68)}
        height={Math.round(size * 0.68)}
        viewBox="0 0 64 64"
        fill="none"
      >
        <path
          d="M16 14V50M48 14V50M16 32H48"
          stroke="currentColor"
          strokeWidth="7.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="48" cy="14" r="4.5" fill="#bfdbfe" />
      </svg>
    </span>
  );
}
