import { describe, expect, it } from 'vitest'
import { familyOf } from './placeFamily'

describe('familyOf', () => {
  it('prefers lodging and food flags over the name', () => {
    expect(familyOf({ name: 'เกาะล้าน รีสอร์ท', is_accommodation: true })).toBe('lodging')
    expect(familyOf({ name: 'ร้านอาหารริมหาด', is_food: true })).toBe('food')
  })

  it('reads the kind of place from its name', () => {
    expect(familyOf({ name: 'หาดเทียน', primary_type: 'สถานที่ท่องเที่ยว' })).toBe('sea')
    expect(familyOf({ name: 'วัดพระแก้ว' })).toBe('culture')
    expect(familyOf({ name: 'ดอยสุเทพ' })).toBe('mountain')
    expect(familyOf({ name: 'น้ำตกเอราวัณ' })).toBe('nature')
    expect(familyOf({ name: 'สวนสนุกดรีมเวิลด์' })).toBe('family')
  })

  it('does not treat Phuket as a mountain', () => {
    expect(familyOf({ name: 'ย่านเมืองเก่า ภูเก็ต' })).not.toBe('mountain')
  })

  it('falls back to the ML interest, then to default', () => {
    expect(familyOf({ name: 'จุดแวะพัก', ml: { top_interest: 'cafe' } })).toBe('cafe')
    expect(familyOf({ name: 'จุดแวะพัก', ml: { top_interest: 'unknown' } })).toBe('default')
    expect(familyOf(null)).toBe('default')
  })
})
