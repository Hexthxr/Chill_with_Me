import L from 'leaflet'
import { Fragment, useEffect, useMemo } from 'react'
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet'

const TILE_URL = import.meta.env.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTRIBUTION = import.meta.env.VITE_MAP_ATTRIBUTION || '&copy; OpenStreetMap contributors'
const TH_CENTER = [13.4, 100.9]

// Icons are shared so a re-render doesn't rebuild the marker (and replay its drop-in animation).
const iconCache = new Map()
function numIcon(label, kind, start) {
  const key = `${label}|${kind}|${start}`
  if (!iconCache.has(key))
    iconCache.set(
      key,
      L.divIcon({
        className: '',
        html: `<div class="num-marker kind-${kind || 'place'} ${start ? 'start' : ''}">${label}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      }),
    )
  return iconCache.get(key)
}

function FitBounds({ points }) {
  const map = useMap()
  const key = points.map((p) => p.join(',')).join('|')
  useEffect(() => {
    if (!points.length) return
    if (points.length === 1) map.setView(points[0], 13)
    else map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 14 })
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

/**
 * markers: [{lat, lng, label, kind, title, subtitle, start}]
 * routes:  [{positions: [[lat,lng],...], estimate: bool, color}]
 * dots:    [{lat, lng, title}] small circle markers
 */
export default function MapView({ markers = [], routes = [], dots = [], className = 'h-80', onMapClick }) {
  const points = useMemo(
    () => [...markers.map((m) => [m.lat, m.lng]), ...dots.map((d) => [d.lat, d.lng])].filter((p) => p[0] != null),
    [markers, dots],
  )
  return (
    <div className={`overflow-hidden rounded-2xl ring-1 ring-forest/10 ${className}`}>
      <MapContainer center={TH_CENTER} zoom={6} scrollWheelZoom className="h-full w-full">
        <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
        <FitBounds points={points} />
        {onMapClick && <ClickHandler onClick={onMapClick} />}
        {routes.map((r, i) => (
          <Fragment key={i}>
            <Polyline
              positions={r.positions}
              className={r.estimate ? 'route-flow-dashed' : undefined}
              pathOptions={{ color: r.color || '#0e7490', weight: 4, opacity: 0.85, dashArray: r.estimate ? '6 8' : undefined }}
            />
            {/* travelling dots show the direction of a real road route */}
            {!r.estimate && <Polyline positions={r.positions} className="route-flow" interactive={false} pathOptions={{ color: '#fff', weight: 2, opacity: 0.9 }} />}
          </Fragment>
        ))}
        {dots.map((d, i) => (
          <CircleMarker key={`d${i}`} center={[d.lat, d.lng]} radius={6} pathOptions={{ color: '#fff', weight: 2, fillColor: d.color || '#2a9db5', fillOpacity: 1 }}>
            {d.title && <Popup>{d.title}</Popup>}
          </CircleMarker>
        ))}
        {markers.map((m, i) => (
          <Marker key={`m${i}`} position={[m.lat, m.lng]} icon={numIcon(m.label ?? i + 1, m.kind, m.start)}>
            {(m.title || m.subtitle) && (
              <Popup>
                <b>{m.title}</b>
                {m.subtitle && <div>{m.subtitle}</div>}
              </Popup>
            )}
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}

function ClickHandler({ onClick }) {
  const map = useMap()
  useEffect(() => {
    const h = (e) => onClick({ lat: e.latlng.lat, lng: e.latlng.lng })
    map.on('click', h)
    return () => map.off('click', h)
  }, [map, onClick])
  return null
}
