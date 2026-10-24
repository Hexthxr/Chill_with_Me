# Chill with me

เว็บแอปแนะนำที่เที่ยวในไทยด้วย Machine Learning และวางแผนทริปแบบลากวาง Block
(React + Vite + Tailwind / FastAPI / MongoDB / scikit-learn + PyThaiNLP)

```
chill-with-me/
├── data/                     ← วาง thailand_master_places.csv, thailand_master_reviews.csv ที่นี่
├── backend/
│   ├── app/                  ← FastAPI (REST API, validation, error handling)
│   │   ├── routers/          meta, places, recommend, hotels, planner, trips
│   │   ├── services/         routing (Map API + mock), planner (ตารางเวลา), route_optimizer, ml_service
│   │   └── schemas/          Pydantic models
│   ├── ml/                   ← ML service (ไม่ขึ้นกับ FastAPI)
│   │   ├── sentiment.py      TF-IDF + Logistic Regression
│   │   ├── recommender.py    Content-Based Filtering
│   │   ├── aspects.py        ประเด็นสำคัญจากรีวิว
│   │   ├── interests.py      โปรไฟล์ความสนใจ
│   │   ├── pipeline.py       train → score → aggregate → เขียนลง MongoDB
│   │   └── artifacts/        โมเดลที่ train แล้ว + metrics.json
│   ├── scripts/              import_csv.py, verify_import.py, build_ml.py
│   └── tests/                pytest (unit + integration)
├── frontend/                 ← React app
├── docker-compose.yml        MongoDB สำหรับ dev
└── .env.example
```

## ติดตั้งและรัน

ต้องมี Python 3.11+, Node 18+ และ MongoDB 6+ (ทดสอบกับ Python 3.13, Node 22, MongoDB 8.0)

```bash
# 1) MongoDB
docker compose up -d                 # หรือใช้ MongoDB ที่มีอยู่ / Atlas แล้วแก้ MONGODB_URI

# 2) ตั้งค่า
cp .env.example backend/.env         # แก้ค่าได้ตามต้องการ
cp frontend/.env.example frontend/.env

# 3) Backend
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m scripts.import_csv --drop  # นำเข้า CSV (~1 นาที)
python -m scripts.build_ml           # train sentiment + สร้าง recommender (~3 นาที)
python -m scripts.verify_import      # ตรวจผลนำเข้า (17 checks)
uvicorn app.main:app --reload --port 8000
# API docs: http://localhost:8000/docs

# 4) Frontend (อีกหน้าต่าง)
cd frontend
npm install
npm run dev                          # http://localhost:5173 (proxy /api → :8000)
```

ทดสอบ: `cd backend && pytest` (17 tests; integration tests ข้ามเองถ้ายังไม่ได้ import ข้อมูล) และ `cd frontend && npm test`

## ข้อค้นพบจาก Dataset จริง (ตรวจก่อนเขียน import)

| | ผล |
|---|---|
| places | 22,947 แถว, 77 จังหวัด, `place_id` ไม่ซ้ำ, พิกัดครบและอยู่ในไทยทุกแถว |
| places ที่ไม่มีคะแนน | 5,673 แถว (ใช้ค่ากลางในการจัดอันดับ และบอกผู้ใช้ในเหตุผล) |
| reviews | 103,441 แถว: Google 69,922 / Booking 33,519 |
| การเชื่อม `place_id` | รีวิว Google **ทั้ง 69,922 แถว** เชื่อมกับ places ได้ (17,264 สถานที่) |
| รีวิว Booking | **ไม่มี place_id ชื่อ หรือพิกัด** → เก็บไว้เป็น `linked=false` ไม่นำไปผูกกับสถานที่ใด |
| รีวิวซ้ำ | ลบ 5 แถว (Booking เนื้อหาซ้ำ); รีวิวไม่มีข้อความ 9,393 แถว |
| จำนวนรีวิวต่อสถานที่ | ไม่เกินประมาณ 5 ต่อแห่ง (ข้อจำกัดของชุดข้อมูล) |
| ที่พัก | 3,391 แห่ง (category resort หรือ type lodging) — **มีราคาเพียง 9 แห่ง** |
| ไม่มีในชุดข้อมูล | รูปภาพ, เวลาเปิด–ปิด (มีแค่ flag `has_hours`), เวลาเดินทาง |

สิ่งที่ไม่มีในข้อมูลจะไม่ถูกสร้างขึ้นเอง: การ์ดใช้ลายเส้น contour ที่สร้างจาก `place_id` (มีข้อความบอกว่าไม่ใช่ภาพถ่าย), เวลาเปิด–ปิดให้ผู้ใช้กรอกเองใน Block, ตัวกรองงบประมาณใช้ได้เฉพาะที่พักที่มีราคาและแจ้งจำนวนให้ทราบ

## MongoDB Collections

| collection | เนื้อหา | Index |
|---|---|---|
| `places` | สถานที่ + `location` (GeoJSON) + `ml` (sentiment, aspects, คะแนน) | 2dsphere `location`, `category`, `primary_type`, `province`, `province_en`, `place_id` (unique) |
| `reviews` | รีวิวทั้งหมด, `linked`, `sentiment {label, pos_prob}` | `place_id + review_time`, `source + linked`, `place_id + sentiment.label` |
| `hotels` | ที่พักจาก places (ข้อมูลจริงเท่านั้น) + ราคาถ้ามี | 2dsphere, `province`, `price_usd_min` |
| `trips` | แผนทริป + schedule snapshot | `owner_key + updated_at` |
| `route_cache` | แคชเวลาเดินทางจาก Map API (TTL 7 วัน) | `key` unique, TTL |
| `import_reports`, `ml_runs` | รายงานการนำเข้า / ผลการ train | |

ไม่มีระบบบัญชีผู้ใช้ (`users`): "ทริปของฉัน" ผูกกับ anonymous key ที่สร้างในเบราว์เซอร์

## Machine Learning

**ML Recommendation และ Route Optimization แยกกันชัดเจน**: `backend/ml/` คือ ML ส่วน `app/services/route_optimizer.py` คือ heuristic (nearest-neighbour + swap/2-opt) ไม่ใช่ ML

### Sentiment (TF-IDF + Logistic Regression)
- ทำความสะอาด: lowercase, ลบ URL/อีโมจิ, ย่ออักษรซ้ำ (ดีมากกกก → ดีมากก), ลบข้อความว่างและข้อความซ้ำในสถานที่เดียวกัน (60,529 → 60,316)
- Feature: คำไทยจาก PyThaiNLP newmm (unigram + bigram) + char n-gram 2–4
- Label จากดาวของผู้รีวิว (Google): ≥4 = บวก, ≤2 = ลบ, 3 ดาวไม่ใช้ train → 56,491 ตัวอย่าง (บวก 53,054 / ลบ 3,437)
- `class_weight=balanced`, threshold เลือกจาก validation set, ประเมินบน test set ที่ไม่เคยเห็น
- รีวิว Booking ไม่ใช้ train เพราะมีรีวิวลบเพียง ~91 แถว (ทดลองแล้ว F1 ลดลง)

| Test set (11,299 รีวิว) | ค่า |
|---|---|
| **F1 macro** | **0.840** |
| F1 positive / negative | 0.981 / 0.700 |
| Precision / Recall (negative) | 0.706 / 0.693 |
| Accuracy | 0.964 |
| Baseline สุ่มตามสัดส่วน F1 macro | 0.497 |

ข้อจำกัด: label มาจากดาว จึงมี noise (เช่น “วิวสวย แต่…” ที่ให้ดาวต่ำ) และคลาสลบมีน้อย ดู `/api/meta/ml` หรือ `ml/artifacts/metrics.json`

### Content-Based Recommendation
- โปรไฟล์สถานที่ = ชื่อ + `primary_type` + Google types (แปลไทย) + คำจากรีวิวของสถานที่นั้น → TF-IDF (24,110 คำ)
- โปรไฟล์ผู้ใช้ = ความสนใจที่เลือก (ทะเล ภูเขา ธรรมชาติ คาเฟ่ วัฒนธรรม ครอบครัว) และ/หรือคำค้น
- คะแนน = 0.35 content + 0.10 ประเภทตรงหมวด + 0.20 คะแนนรีวิว (Bayesian) + 0.20 sentiment (Bayesian) + 0.15 ความนิยม
- โหมดตามตำแหน่ง: `$geoNear` หาผู้สมัครในรัศมี แล้ว `0.65 × คะแนนข้างบน + 0.35 × exp(-ระยะ/(รัศมี/2))`
- re-rank เพื่อไม่ให้ประเภทเดียวกันเต็มรายการ; เหตุผลที่แสดงสร้างจากสัญญาณจริงเท่านั้น (คำที่ตรงกัน, % รีวิวบวก, คะแนน, ระยะทาง)
- “ที่เที่ยวที่คล้ายกัน” = cosine similarity ระหว่างโปรไฟล์สถานที่

### ประเด็นสำคัญจากรีวิว
ตรวจคำของ 12 ประเด็น (วิว บรรยากาศ ความสะอาด ห้องน้ำ ที่จอดรถ การเดินทาง ราคา อาหาร บริการ ความพลุกพล่าน มุมถ่ายรูป ห้องพัก) แล้วใช้ผล sentiment ของรีวิวที่พูดถึงประเด็นนั้นเพื่อบอกว่าคนชมหรือติ

## Map และเวลาเดินทาง

| `ROUTING_PROVIDER` | ต้องตั้งค่า | สถานะการทดสอบ |
|---|---|---|
| `ors` (OpenRouteService) | `ORS_API_KEY` | parser มี unit test; ยังไม่ได้ทดสอบกับ API จริง |
| `google` (Routes API) | `GOOGLE_MAPS_API_KEY` | ยังไม่ได้ทดสอบกับ API จริง |
| `osrm` | `OSRM_BASE_URL` | parser มี unit test |
| `mock` | – | ใช้ทดสอบทั้งหมดในโปรเจกต์นี้ |

`auto` (ค่าเริ่มต้น) เลือก provider จริงที่ตั้งค่าไว้ ถ้าไม่มีจะเป็น **Mock Mode**: ระยะเส้นตรง × 1.3, ความเร็วสมมติ 25/45/65 กม./ชม. ตามระยะ UI แสดงป้าย “โหมดจำลอง / ประมาณการ” และวาดเส้นประเสมอ ถ้า provider จริงล้มเหลวและ `ROUTING_FALLBACK_TO_MOCK=true` ช่วงนั้นจะถูกแสดงเป็นค่าประมาณพร้อมคำเตือน

แผนที่ใช้ Leaflet + OpenStreetMap tiles (ไม่ต้องใช้ key) เปลี่ยนได้ที่ `VITE_MAP_TILE_URL`

## Trip Planner (กฎที่ backend ใช้คำนวณ)
- เวลาเริ่ม Block = จบ Block ก่อนหน้า + เวลาเดินทาง (ข้าม Block ที่ไม่มีพิกัด เช่น เวลาพัก); วันถัดไปเริ่มจากจุดสุดท้ายของวันก่อน (เช่น โรงแรม)
- Block ที่ล็อกเวลา: ถ้าไปถึงก่อนจะรอ (แจ้งเวลาว่าง), ถ้าไปไม่ทันจะเริ่มตามเวลาที่ถึงจริงและแจ้ง error เวลาทับซ้อน
- แจ้งเตือน: เวลาเปิด–ปิดที่ผู้ใช้กรอก, จบเกินเวลาที่ตั้ง/เลยเที่ยงคืน, > 6 สถานที่ต่อวัน, เดินทางนานเกินครึ่งวัน, ช่วงเดินทาง > 3 ชม., ยังไม่มีมื้อกลางวัน/เวลาพัก/ที่พักคืนนั้น
- “จัดลำดับให้เดินทางน้อยที่สุด”: จุดแรก, โรงแรมท้ายวัน และ Block ที่ล็อกเวลาอยู่ที่เดิม

## REST API หลัก
`GET /api/health` · `GET /api/meta/{stats,provinces,interests,ml}` · `GET /api/recommend` · `GET /api/places` · `GET /api/places/{id}` · `/reviews` · `/similar` · `GET /api/hotels/near` · `POST /api/hotels/along-route` · `POST /api/planner/compute` · `POST /api/planner/optimize` · `POST /api/routing/legs` · `GET|POST /api/trips` · `GET|PUT|DELETE /api/trips/{id}`

Error ทุกตัวอยู่ในรูป `{"error": {"code", "message", "details"}}` (422 validation, 404, 503 เมื่อ DB/ML ไม่พร้อม, 502 routing)
