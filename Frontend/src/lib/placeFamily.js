// Decides which illustration a place gets. The dataset has no photos, so places without a Wikipedia
// photo show a generated scene for their kind of place – never presented as a photo of the place.

export const FAMILY_LABEL = {
  sea: 'ทะเล',
  mountain: 'ภูเขา',
  nature: 'ธรรมชาติ',
  cafe: 'คาเฟ่',
  culture: 'วัฒนธรรม',
  family: 'ครอบครัว',
  lodging: 'ที่พัก',
  food: 'อาหาร',
  default: 'สถานที่',
}

// Checked in order: the place's own name says more about the picture than the ML interest does
// (a "เกาะ" should look like an island even when its reviews talk mostly about food).
const NAME_RULES = [
  ['cafe', /คาเฟ่|กาแฟ|cafe|café|coffee/i],
  ['family', /สวนสนุก|สวนน้ำ|สวนสัตว์|ซาฟารี|อควาเรียม|aquarium|\bzoo\b/i],
  ['sea', /เกาะ|หาด(?!ใหญ่)|ทะเล|อ่าว|ดำน้ำ|ปะการัง|beach|island/i],
  ['culture', /วัด|พระธาตุ|เจดีย์|พิพิธภัณฑ์|พระราชวัง|โบราณ|temple|museum/i],
  ['mountain', /ดอย|ยอดเขา|ภูเขา|จุดชมวิว|เขา|ผา|^ภู(?!เก็ต)/],
  ['nature', /น้ำตก|อุทยาน|ป่า|ถ้ำ|สวน|waterfall|national park/i],
]

export function familyOf(place) {
  if (!place) return 'default'
  if (place.is_accommodation) return 'lodging'
  if (place.is_food) return 'food'
  const text = `${place.name || ''} ${place.primary_type || ''}`
  for (const [family, re] of NAME_RULES) if (re.test(text)) return family
  const ml = place.ml?.top_interest
  return ml && FAMILY_LABEL[ml] ? ml : 'default'
}
