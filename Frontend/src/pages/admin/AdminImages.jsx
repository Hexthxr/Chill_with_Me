import { useEffect, useRef, useState } from 'react'
import { forgetPlacePhoto } from '../../components/PlaceArt'
import { Spinner } from '../../components/States'
import { api, assetUrl } from '../../lib/api'
import { useToast } from '../../store/tripStore'

const MAX_MB = 10
const ACCEPT = 'image/jpeg,image/png,image/webp'
const inputCls = 'w-full rounded-lg bg-white px-2.5 py-1.5 text-sm ring-1 ring-forest/20 focus:ring-forest/50'
const smallBtn = 'btn-ripple rounded-full px-2.5 py-1 text-xs font-medium text-forest ring-1 ring-forest/20 transition hover:bg-mist disabled:opacity-40'

/** Problems we can tell without uploading. The server checks again and has the final word. */
function fileProblem(file) {
  if (!ACCEPT.split(',').includes(file.type)) return `${file.name}: ใช้ได้เฉพาะ JPG, PNG หรือ WebP`
  if (file.size > MAX_MB * 1024 * 1024) return `${file.name}: ไฟล์ใหญ่เกิน ${MAX_MB} MB`
  return null
}

function ImageCard({ image, index, total, busy, onMove, onMain, onSave, onReplace, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [caption, setCaption] = useState(image.caption || '')
  const [credit, setCredit] = useState(image.author || '')
  const replaceInput = useRef(null)
  const isMain = index === 0

  const save = async (e) => {
    e.preventDefault()
    if (await onSave(image, { caption, credit })) setEditing(false)
  }

  return (
    <li className="fade-up flex flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-forest/10">
      <div className="relative aspect-[4/3] bg-mist">
        <img src={assetUrl(image.thumb_url)} alt={image.caption || `รูปที่ ${index + 1}`} loading="lazy" className="h-full w-full object-cover" />
        {isMain && <span className="absolute left-2 top-2 rounded-full bg-forest px-2.5 py-0.5 text-xs font-medium text-white shadow">รูปหลัก</span>}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        {editing ? (
          <form onSubmit={save} className="space-y-2">
            <label className="block text-xs text-muted">
              คำบรรยายรูป
              <input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={200} className={`${inputCls} mt-0.5`} placeholder="เช่น วิวจากจุดชมวิวตอนเช้า" autoFocus />
            </label>
            <label className="block text-xs text-muted">
              เครดิตผู้ถ่าย
              <input value={credit} onChange={(e) => setCredit(e.target.value)} maxLength={120} className={`${inputCls} mt-0.5`} placeholder="ชื่อผู้ถ่าย (ถ้าต้องให้เครดิต)" />
            </label>
            <div className="flex gap-2">
              <button disabled={busy} className="btn-primary rounded-full px-3 py-1 text-xs font-medium disabled:opacity-50">บันทึก</button>
              <button type="button" onClick={() => setEditing(false)} className="text-xs text-muted hover:text-ink">ยกเลิก</button>
            </div>
          </form>
        ) : (
          <div className="min-h-10 text-sm">
            <p className={image.caption ? 'text-ink' : 'text-muted'}>{image.caption || 'ยังไม่มีคำบรรยาย'}</p>
            {image.author && <p className="text-xs text-muted">ภาพ: {image.author}</p>}
          </div>
        )}
        <div className="mt-auto flex flex-wrap gap-1.5 border-t border-sand pt-2">
          {!isMain && <button type="button" disabled={busy} onClick={() => onMain(image)} className={smallBtn}>ตั้งเป็นรูปหลัก</button>}
          <button type="button" disabled={busy || index === 0} onClick={() => onMove(index, -1)} className={smallBtn} aria-label={`เลื่อนรูปที่ ${index + 1} ไปก่อนหน้า`}>←</button>
          <button type="button" disabled={busy || index === total - 1} onClick={() => onMove(index, 1)} className={smallBtn} aria-label={`เลื่อนรูปที่ ${index + 1} ไปถัดไป`}>→</button>
          <button type="button" disabled={busy} onClick={() => setEditing(!editing)} className={smallBtn}>แก้ข้อความ</button>
          <button type="button" disabled={busy} onClick={() => replaceInput.current?.click()} className={smallBtn}>เปลี่ยนรูป</button>
          <input
            ref={replaceInput}
            type="file"
            accept={ACCEPT}
            className="hidden"
            aria-label={`เลือกไฟล์ใหม่แทนรูปที่ ${index + 1}`}
            onChange={(e) => {
              const f = e.target.files[0]
              e.target.value = ''
              if (f) onReplace(image, f)
            }}
          />
          <button type="button" disabled={busy} onClick={() => onDelete(image, index)} className="btn-ripple rounded-full px-2.5 py-1 text-xs font-medium text-alert ring-1 ring-alert/30 transition hover:bg-alert-soft disabled:opacity-40">ลบ</button>
        </div>
      </div>
    </li>
  )
}

function WikipediaPhoto({ wiki, hasOwn, busy, onToggle }) {
  if (wiki.unavailable) return <p className="mt-4 rounded-xl bg-mist px-3 py-2 text-xs text-muted">ตอนนี้เช็กรูปจาก Wikipedia ไม่ได้ ลองเปิดหน้านี้ใหม่ภายหลัง</p>
  if (!wiki.photo) return null
  const status = wiki.disabled ? 'ปิดอยู่ ผู้ใช้จะไม่เห็นรูปนี้' : hasOwn ? 'ไม่แสดง เพราะมีรูปที่แอดมินเพิ่มแล้ว' : 'กำลังแสดงเป็นรูปของสถานที่นี้'
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-mist/70 p-3">
      <img src={wiki.photo.url} alt="" referrerPolicy="no-referrer" className={`h-16 w-24 rounded-lg object-cover ${wiki.disabled ? 'opacity-50 grayscale' : ''}`} />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium text-ink">รูปจาก Wikipedia: {wiki.photo.title}</p>
        <p className="text-xs text-muted">{status}</p>
      </div>
      <button type="button" disabled={busy} onClick={onToggle} className={smallBtn}>
        {wiki.disabled ? 'ใช้รูปนี้อีกครั้ง' : 'รูปนี้ไม่ตรง ไม่ต้องใช้'}
      </button>
    </div>
  )
}

export default function AdminImages({ placeId, onChanged }) {
  const push = useToast((s) => s.push)
  const [state, setState] = useState({ loading: true })
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)
  const [dragging, setDragging] = useState(false)
  const picker = useRef(null)

  const [wiki, setWiki] = useState(null)

  const load = () => api.admin.images(placeId).then((data) => setState({ data })).catch((error) => setState({ error }))
  useEffect(() => {
    setState({ loading: true })
    setWiki(null)
    load()
    // may wait in the Wikipedia queue, so it fills in by itself and never holds up the list above
    let alive = true
    api.admin.wikiPhoto(placeId).then((w) => alive && setWiki(w)).catch(() => {})
    return () => {
      alive = false
    }
  }, [placeId]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Runs one change, then refreshes this list, the audit history, and the cached photo on cards. */
  const run = async (work, okMessage) => {
    setBusy(true)
    try {
      await work()
      if (okMessage) push(okMessage)
      forgetPlacePhoto(placeId)
      await load()
      onChanged?.()
      return true
    } catch (e) {
      push(e.message, 'error')
      await load() // the list may have changed elsewhere
      return false
    } finally {
      setBusy(false)
    }
  }

  const d = state.data
  const items = d?.items || []
  const room = d ? d.max_images - items.length : 0

  const uploadFiles = async (fileList) => {
    const files = [...fileList]
    const good = files.filter((f) => {
      const problem = fileProblem(f)
      if (problem) push(problem, 'error')
      return !problem
    })
    if (good.length > room) push(`เพิ่มได้อีก ${room} รูป จึงอัปโหลดเฉพาะ ${room} รูปแรก`, 'error')
    const batch = good.slice(0, Math.max(0, room))
    if (!batch.length) return
    setBusy(true)
    let done = 0
    for (const [i, file] of batch.entries()) {
      setProgress(`กำลังอัปโหลด ${i + 1} จาก ${batch.length}`)
      try {
        await api.admin.uploadImage(placeId, file)
        done += 1
      } catch (e) {
        push(`${file.name}: ${e.message}`, 'error') // one bad file shouldn't stop the others
      }
    }
    setProgress(null)
    setBusy(false)
    if (done) {
      push(`เพิ่มรูปแล้ว ${done} รูป`)
      forgetPlacePhoto(placeId)
      onChanged?.()
    }
    await load()
  }

  const setOrder = (ids, msg) => run(() => api.admin.orderImages(placeId, ids), msg)
  const ids = items.map((i) => i.id)
  const move = (index, delta) => {
    const next = [...ids]
    next.splice(index + delta, 0, next.splice(index, 1)[0])
    setOrder(next)
  }
  const makeMain = (image) => setOrder([image.id, ...ids.filter((x) => x !== image.id)], 'ตั้งเป็นรูปหลักแล้ว')
  const saveText = (image, body) => run(() => api.admin.updateImage(image.id, body), 'บันทึกข้อความแล้ว')
  const replace = (image, file) => {
    const problem = fileProblem(file)
    if (problem) return push(problem, 'error')
    return run(() => api.admin.replaceImage(image.id, file), 'เปลี่ยนรูปแล้ว')
  }
  const remove = (image, index) => {
    if (!window.confirm(`ลบรูปที่ ${index + 1}? ลบแล้วกู้คืนไม่ได้`)) return
    run(() => api.admin.deleteImage(image.id), 'ลบรูปแล้ว')
  }
  const toggleWiki = () => {
    const disabled = !wiki.disabled
    return run(async () => {
      await api.admin.setWikiPhoto(placeId, disabled)
      setWiki({ ...wiki, disabled })
    }, disabled ? 'ปิดรูปจาก Wikipedia แล้ว' : 'ใช้รูปจาก Wikipedia อีกครั้งแล้ว')
  }

  return (
    <section className="mb-6 rounded-2xl bg-white p-5 ring-1 ring-forest/10" aria-label="รูปภาพสถานที่">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium text-ink">รูปภาพสถานที่ {d && <span className="text-sm font-normal text-muted">({items.length}/{d.max_images} รูป)</span>}</h2>
        <p className="text-xs text-muted">รูปแรกคือรูปหลักที่แสดงบนการ์ด</p>
      </div>

      {state.loading && <div className="mt-3"><Spinner label="กำลังโหลดรูป…" /></div>}
      {state.error && <p role="alert" className="mt-3 rounded-xl bg-alert-soft px-4 py-2.5 text-sm text-alert">{state.error.message}</p>}

      {d && (
        <>
          {items.length > 0 && (
            <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((image, i) => (
                <ImageCard key={image.id} image={image} index={i} total={items.length} busy={busy} onMove={move} onMain={makeMain} onSave={saveText} onReplace={replace} onDelete={remove} />
              ))}
            </ul>
          )}

          {room > 0 ? (
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                if (!busy) uploadFiles(e.dataTransfer.files)
              }}
              className={`mt-4 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition ${dragging ? 'border-forest bg-leaf/50' : 'border-forest/25 bg-mist/40'}`}
            >
              <p className="text-sm text-ink">ลากรูปมาวางที่นี่ หรือ</p>
              <button type="button" disabled={busy} aria-busy={!!progress || undefined} onClick={() => picker.current?.click()} className="btn-primary mt-2 rounded-full px-5 py-2 text-sm font-medium disabled:opacity-60">
                {progress || 'เลือกรูปจากเครื่อง'}
              </button>
              <input
                ref={picker}
                type="file"
                accept={ACCEPT}
                multiple
                className="hidden"
                aria-label="เลือกไฟล์รูป"
                onChange={(e) => {
                  const files = [...e.target.files]
                  e.target.value = ''
                  uploadFiles(files)
                }}
              />
              <p className="mt-2 text-xs text-muted">JPG, PNG หรือ WebP ไม่เกิน {MAX_MB} MB ต่อรูป เลือกหลายรูปพร้อมกันได้ ระบบจะลบข้อมูลแฝงอย่างพิกัด GPS ออกจากรูปให้</p>
              <p className="mt-1 text-xs text-muted">ใช้เฉพาะรูปที่คุณมีสิทธิ์เผยแพร่ เช่น ถ่ายเองหรือได้รับอนุญาตแล้ว</p>
            </div>
          ) : (
            <p className="mt-4 rounded-xl bg-sun-soft px-4 py-2.5 text-sm text-[#6b4f0e]">ครบ {d.max_images} รูปแล้ว ลบรูปเดิมก่อนจึงจะเพิ่มใหม่ได้</p>
          )}

          {wiki && <WikipediaPhoto wiki={wiki} hasOwn={items.length > 0} busy={busy} onToggle={toggleWiki} />}
        </>
      )}
    </section>
  )
}
