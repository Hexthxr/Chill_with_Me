import { contourPaths, FAMILIES, familyOf } from '../lib/contour'

/** Generated contour illustration (not a photo). */
export default function PlaceArt({ place, className = '', showLabel = true, w = 400, h = 240 }) {
  const fam = FAMILIES[familyOf(place)] || FAMILIES.default
  const paths = contourPaths(place?.place_id || place?.name || 'x', w, h)
  return (
    <div className={`relative overflow-hidden ${className}`} style={{ background: fam.bg }}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" aria-hidden="true">
        {paths.map((d, i) => (
          <path key={i} d={d} fill="none" stroke={fam.line} strokeOpacity={0.18 + (i % 4) * 0.08} strokeWidth={i % 3 === 0 ? 1.6 : 1} />
        ))}
      </svg>
      {showLabel && (
        <span
          className="absolute bottom-2 left-2 rounded-full px-2.5 py-0.5 text-xs font-medium"
          style={{ background: 'rgba(255,255,255,.85)', color: fam.line }}
        >
          {place?.primary_type || fam.label}
        </span>
      )}
    </div>
  )
}
