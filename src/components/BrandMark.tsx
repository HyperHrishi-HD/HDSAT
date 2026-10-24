/**
 * The HDSAT tile: a rounded blue square with a white H.
 *
 * The glyph is drawn symmetrically inside its 64-unit view box (ink from 13 to
 * 51 on both axes), so the letter sits dead centre in the tile at every size.
 * It used to carry a light-blue dot on the top-right stroke, which read as a
 * clipped or half-drawn letter at 22 px.
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
        width={Math.round(size * 0.66)}
        height={Math.round(size * 0.66)}
        viewBox="0 0 64 64"
        fill="none"
      >
        <path
          d="M17 15V49M47 15V49M17 32H47"
          stroke="currentColor"
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
