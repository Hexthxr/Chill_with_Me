import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ErrorState, Spinner } from '../../components/States'
import { api } from '../../lib/api'
import { fmtInt, fmtPct, fmtRating } from '../../lib/format'
import { useToast } from '../../store/tripStore'
import { ACTION_LABELS, AdminShell, FIELD_LABELS, fmtDateTime, fmtValue } from './adminUi'

const TEXT_FIELDS = ['name', 'address', 'district', 'google_maps_url']

function toForm(e) {
  return {
    name: e.name || '', address: e.address || '', district: e.district || '', province: e.province || '',
    lat: e.lat ?? '', lng: e.lng ?? '', google_maps_url: e.google_maps_url || '', primary_type: e.primary_type || '',
    is_food: !!e.is_food,
  }
}

function Field({ label, children, hint, error }) {
  return (
    <label className="block">
      <span className="text-sm text-ink">{label}</span>
      <div className="mt-1">{children}</div>
      {error ? <span className="mt-1 block text-xs text-alert">{error}</span> : hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  )
}

const inputCls = 'w-full rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-forest/20 focus:ring-forest/50'

export default function AdminPlaceEdit() {
  const { id } = useParams()
  const push = useToast((s) => s.push)
  const [state, setState] = useState({ loading: true })
  const [form, setForm] = useState(null)
  const [options, setOptions] = useState({ provinces: [], primary_types: [] })
  const [note, setNote] = useState('')
  const [hideReason, setHideReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})

  const load = () => {
    setState({ loading: true })
    api.admin.place(id).then((data) => {
      setState({ data })
      setForm(toForm(data.editable))
      setHideReason(data.hidden_reason || '')
    }).catch((error) => setState({ error }))
  }
  useEffect(load, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.admin.options().then(setOptions).catch(() => {}) }, [])

  const d = state.data
  const original = useMemo(() => (d ? toForm(d.editable) : null), [d])
  const changed = form && original ? Object.keys(form).filter((k) => String(form[k]) !== String(original[k])) : []

  const send = async (body, okMsg) => {
    setSaving(true)
    setFieldErrors({})
    try {
      const res = await api.admin.updatePlace(id, { ...body, note: note.trim() || undefined })
      push(res.changed.length ? okMsg : 'ไม่มีอะไรเปลี่ยน')
      setNote('')
      load()
    } catch (e) {
      const fe = {}
      ;(Array.isArray(e.details) ? e.details : []).forEach((x) => { if (x.field) fe[x.field] = x.message })
      setFieldErrors(fe)
      push(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const save = (e) => {
    e.preventDefault()
    const body = {}
    for (const k of changed) {
      if (k === 'lat' || k === 'lng') body[k] = form[k] === '' ? undefined : Number(form[k])
      else body[k] = form[k]
    }
    send(body, 'บันทึกแล้ว')
  }

  const toggleHidden = () => {
    const hide = !d.editable.hidden
    if (hide && !window.confirm(`ซ่อน “${d.editable.name}” จากผู้ใช้? (ค้นหา แนะนำ และที่พักจะไม่แสดงที่นี้ — เลิกซ่อนได้ภายหลัง)`)) return
    send({ hidden: hide, hidden_reason: hide ? hideReason.trim() || undefined : undefined }, hide ? 'ซ่อนสถานที่แล้ว' : 'แสดงสถานที่อีกครั้งแล้ว')
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  return (
    <AdminShell
      title={d ? d.editable.name : 'แก้ไขสถานที่'}
      subtitle={d ? <span className="font-mono text-xs">{d.place_id}</span> : null}
      actions={<Link to="/admin/places" className="text-sm text-forest hover:underline">← กลับไปรายการ</Link>}
    >
      {state.loading && <Spinner />}
      {state.error && <ErrorState error={state.error} onRetry={load} />}
      {d && form && (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <form onSubmit={save} className="space-y-4 rounded-2xl bg-white p-5 ring-1 ring-forest/10">
            <h2 className="font-medium text-ink">ข้อมูลที่แก้ไขได้</h2>
            {TEXT_FIELDS.map((k) => (
              <Field key={k} label={FIELD_LABELS[k]} error={fieldErrors[k]} hint={k === 'google_maps_url' ? 'ต้องขึ้นต้นด้วย https://' : null}>
                <input value={form[k]} onChange={set(k)} className={inputCls} required={k === 'name'} maxLength={k === 'name' ? 200 : 500} />
              </Field>
            ))}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={FIELD_LABELS.province} error={fieldErrors.province}>
                <select value={form.province} onChange={set('province')} className={inputCls}>
                  {options.provinces.length === 0 && <option value={form.province}>{form.province}</option>}
                  {options.provinces.map((p) => <option key={p.province} value={p.province}>{p.province}</option>)}
                </select>
              </Field>
              <Field label={FIELD_LABELS.primary_type} error={fieldErrors.primary_type} hint="เลือกจากประเภทที่มีอยู่ หรือพิมพ์ใหม่">
                <input value={form.primary_type} onChange={set('primary_type')} list="ptypes" className={inputCls} maxLength={80} />
                <datalist id="ptypes">{options.primary_types.map((t) => <option key={t.value} value={t.value} />)}</datalist>
              </Field>
              <Field label={FIELD_LABELS.lat} error={fieldErrors.lat} hint="5 – 21 (ประเทศไทย)">
                <input type="number" step="any" min="5" max="21" value={form.lat} onChange={set('lat')} className={inputCls} required />
              </Field>
              <Field label={FIELD_LABELS.lng} error={fieldErrors.lng} hint="97 – 106 (ประเทศไทย)">
                <input type="number" step="any" min="97" max="106" value={form.lng} onChange={set('lng')} className={inputCls} required />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.is_food} onChange={set('is_food')} className="h-4 w-4 accent-forest" />
              {FIELD_LABELS.is_food}
            </label>
            <Field label="หมายเหตุการแก้ไข (ไม่บังคับ)" hint="บันทึกไว้ในประวัติการแก้ไข">
              <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} maxLength={300} placeholder="เช่น แก้ชื่อตามป้ายจริง" />
            </Field>
            <div className="flex flex-wrap items-center gap-3 border-t border-sand pt-4">
              <button disabled={saving || changed.length === 0} className="btn-primary rounded-full px-5 py-2 text-sm font-medium disabled:opacity-50">
                {saving ? 'กำลังบันทึก…' : changed.length ? `บันทึก (${changed.length} ช่อง)` : 'บันทึก'}
              </button>
              {changed.length > 0 && (
                <button type="button" onClick={() => setForm(original)} className="text-sm text-muted hover:text-ink">ยกเลิกการแก้ไข</button>
              )}
              <a href={`/place/${encodeURIComponent(d.place_id)}`} target="_blank" rel="noreferrer" className="ml-auto text-sm text-forest hover:underline">
                ดูหน้าสาธารณะ ↗
              </a>
            </div>
            <p className="text-xs text-muted">
              ชื่อ จังหวัด ประเภท และการซ่อนมีผลกับระบบแนะนำทันที ส่วนเนื้อหาที่โมเดลใช้เทียบความคล้าย (TF-IDF) จะอัปเดตเมื่อรัน <code>run data</code> ครั้งถัดไป
            </p>
          </form>

          <aside className="space-y-4">
            <section className={`rounded-2xl p-4 ring-1 ${d.editable.hidden ? 'bg-alert-soft ring-alert/30' : 'bg-white ring-forest/10'}`}>
              <h2 className="font-medium text-ink">การแสดงผล</h2>
              <p className="mt-1 text-sm">
                {d.editable.hidden
                  ? <>ซ่อนอยู่ — ผู้ใช้ไม่เห็นสถานที่นี้{d.hidden_reason ? ` (เหตุผล: ${d.hidden_reason})` : ''}</>
                  : 'แสดงอยู่ในการค้นหาและการแนะนำ'}
              </p>
              {!d.editable.hidden && (
                <input value={hideReason} onChange={(e) => setHideReason(e.target.value)} placeholder="เหตุผลที่ซ่อน (ไม่บังคับ)" maxLength={200} className={`${inputCls} mt-3`} aria-label="เหตุผลที่ซ่อน" />
              )}
              <button
                type="button"
                disabled={saving}
                onClick={toggleHidden}
                className={`mt-3 w-full rounded-full px-4 py-2 text-sm font-medium ${d.editable.hidden ? 'btn-primary' : 'bg-white text-alert ring-1 ring-alert/30 hover:bg-alert-soft'}`}
              >
                {d.editable.hidden ? 'แสดงสถานที่อีกครั้ง' : 'ซ่อนจากผู้ใช้'}
              </button>
            </section>

            <section className="rounded-2xl bg-white p-4 text-sm ring-1 ring-forest/10">
              <h2 className="font-medium text-ink">ข้อมูลจากชุดข้อมูล (แก้ไม่ได้)</h2>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted">คะแนน</dt><dd>{d.readonly.rating != null ? `${fmtRating(d.readonly.rating)} จาก ${fmtInt(d.readonly.rating_count)} รีวิว` : 'ไม่มี'}</dd>
                <dt className="text-muted">ML วิเคราะห์</dt><dd>{d.readonly.reviews_analyzed ? `${fmtInt(d.readonly.reviews_analyzed)} รีวิว · บวก ${fmtPct(d.readonly.positive_share)}` : 'ไม่มีรีวิว'}</dd>
                <dt className="text-muted">หมวด</dt><dd>{d.readonly.category || '–'}{d.readonly.is_accommodation ? ' · ที่พัก' : ''}</dd>
                <dt className="text-muted">จังหวัด (EN)</dt><dd>{d.readonly.province_en || '–'}</dd>
              </dl>
              {d.admin_edited_at && <p className="mt-3 text-xs text-muted">แก้ไขล่าสุด {fmtDateTime(d.admin_edited_at)} โดย {d.admin_edited_by}</p>}
            </section>

            <section className="rounded-2xl bg-white p-4 text-sm ring-1 ring-forest/10">
              <h2 className="font-medium text-ink">ประวัติการแก้ไข</h2>
              {d.history.length === 0 ? <p className="mt-2 text-muted">ยังไม่เคยแก้ไข</p> : (
                <ul className="mt-2 space-y-3">
                  {d.history.map((h, i) => (
                    <li key={i}>
                      <p className="text-xs text-muted">{ACTION_LABELS[h.action]} · {h.admin_name} · {fmtDateTime(h.ts)}</p>
                      <ul className="mt-0.5">
                        {Object.entries(h.changes).map(([k, c]) => (
                          <li key={k} className="break-words"><b className="font-medium">{FIELD_LABELS[k] || k}:</b> <span className="text-muted line-through">{fmtValue(c.old)}</span> → {fmtValue(c.new)}</li>
                        ))}
                      </ul>
                      {h.note && <p className="text-xs italic text-muted">“{h.note}”</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      )}
    </AdminShell>
  )
}
