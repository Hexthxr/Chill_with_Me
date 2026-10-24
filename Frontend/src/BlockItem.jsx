import { describe, expect, it } from 'vitest'
import { blockFromPlace, emptyBlock, moveBlock, resizeDays, toPayload } from './planUtils'

const mk = (id) => ({ ...emptyBlock('place', id), id })

describe('planUtils', () => {
  it('moves within a day', () => {
    const days = [{ blocks: [mk('a'), mk('b'), mk('c')] }]
    expect(moveBlock(days, 'a', 0, 2)[0].blocks.map((b) => b.id)).toEqual(['b', 'c', 'a'])
  })
  it('moves across days immutably', () => {
    const days = [{ blocks: [mk('a'), mk('b')] }, { blocks: [mk('c')] }]
    const next = moveBlock(days, 'b', 1, 0)
    expect(next[0].blocks.map((b) => b.id)).toEqual(['a'])
    expect(next[1].blocks.map((b) => b.id)).toEqual(['b', 'c'])
    expect(days[0].blocks.length).toBe(2)
  })
  it('shrinking days keeps blocks', () => {
    const days = [{ blocks: [mk('a')] }, { blocks: [mk('b')] }]
    const next = resizeDays(days, 1)
    expect(next[0].blocks.map((b) => b.id)).toEqual(['a', 'b'])
  })
  it('builds payload: lock requires time, hotel kind from place', () => {
    const hotel = blockFromPlace({ place_id: 'x', name: 'H', lat: 13, lng: 100, is_accommodation: true })
    expect(hotel.kind).toBe('hotel')
    const p = toPayload({
      name: ' ', start_date: '2026-11-01', start_time: '08:00', day_end_time: '20:00',
      days: [{ blocks: [{ ...hotel, locked: true, locked_start: null }] }],
    })
    expect(p.name).toBe('ทริปของฉัน')
    expect(p.days[0].blocks[0].locked).toBe(false)
  })
})
