// One-off: fetch Kemenag Quran source (Arabic + terjemah Indonesia) and emit per-surah files.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const OUT = new URL('../public/data/quran/', import.meta.url).pathname
const SRC = (n) => `https://raw.githubusercontent.com/rioastamal/quran-json/master/surah/${n}.json`

await mkdir(OUT, { recursive: true })

const index = []
for (let n = 1; n <= 114; n++) {
  let raw = null
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(SRC(n))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      raw = await res.json()
      break
    } catch (err) {
      if (attempt === 3) throw new Error(`surah ${n}: ${err.message}`)
      await new Promise((r) => setTimeout(r, 2 ** attempt * 1000))
    }
  }
  const s = raw[String(n)]
  const count = Number(s.number_of_ayah)
  const ayat = []
  for (let a = 1; a <= count; a++) {
    ayat.push({
      number: a,
      arabic: s.text[String(a)].trim(),
      translation_id: s.translations.id.text[String(a)].trim(),
    })
  }
  const pad = String(n).padStart(3, '0')
  const meta = {
    surah: n,
    name_arabic: s.name,
    name_latin: s.name_latin,
    name_id: s.translations.id.name,
    ayah_count: count,
  }
  await writeFile(join(OUT, `${pad}.json`), JSON.stringify({ ...meta, ayat }))
  index.push(meta)
  process.stdout.write(`${n} `)
}
await writeFile(join(OUT, 'index.json'), JSON.stringify(index, null, 2))
console.log('\ndone', index.length)
