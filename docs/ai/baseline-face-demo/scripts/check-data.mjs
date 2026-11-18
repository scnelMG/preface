import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Script } from 'node:vm'

const here = new URL('../', import.meta.url)
const data = JSON.parse(readFileSync(new URL('data.json', here), 'utf8'))
const html = readFileSync(new URL('index.html', here), 'utf8')
const embeddedText = html.match(/<script id="fixture" type="application\/json">([^<]+)<\/script>/)?.[1] ?? 'null'
const embedded = JSON.parse(embeddedText)
assert.deepEqual(embedded.fixture, data.fixture)
const script = new Script(html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1] ?? 'invalid(', { filename: 'index.html' })

async function render(fixture, rejectFetch = false, protocol = 'https:') {
  const ids = ['front', 'side', 'frontButton', 'sideButton', 'fixture', 'faceFinding', 'faceExplanation', 'jawRatio', 'faceRatio', 'alarValue', 'alarExplanation', 'projectionValue', 'guide', 'guideIntro', 'datasetNote']
  const elements = Object.fromEntries(ids.map((id) => [id, { textContent: id === 'fixture' ? embeddedText : '', addEventListener() {}, setAttribute() {} }]))
  script.runInNewContext({
    document: { getElementById: (id) => elements[id] },
    location: { protocol },
    fetch: () => rejectFetch ? Promise.reject(Error('missing data')) : Promise.resolve({ ok: true, json: () => Promise.resolve(fixture) }),
  })
  await new Promise((resolve) => setImmediate(resolve))
  return elements
}

const valid = await render(data)
assert.equal(valid.faceFinding.textContent, '광대에서 턱으로 좁아지는 윤곽')
assert.equal(valid.jawRatio.textContent, '78%')
assert.equal(valid.faceRatio.textContent, '101%')
assert.match(valid.guideIntro.textContent, /78%/)
assert.equal(valid.alarValue.textContent, '43%')
assert.match(valid.alarExplanation.textContent, /28%/)
assert.equal(valid.projectionValue.textContent, '35%')
const wideJaw = structuredClone(data)
wideJaw.fixture.landmarks.gonionLeft[0] = -0.65
wideJaw.fixture.landmarks.gonionRight[0] = 0.65
assert.equal((await render(wideJaw)).faceFinding.textContent, '턱 쪽 폭이 더 넓은 윤곽')
const invalid = structuredClone(data)
invalid.fixture.quality.landmarksReliable = false
const rejected = await render(invalid)
assert.equal(rejected.faceFinding.textContent, '얼굴형 분석 보류')
assert.equal(rejected.jawRatio.textContent, '측정 불가')
assert.equal(rejected.alarValue.textContent, '측정 불가')
assert.equal(rejected.projectionValue.textContent, '측정 불가')
assert.equal(rejected.guide.hidden, true)

const missing = structuredClone(data)
delete missing.fixture.landmarks.gnathion
assert.equal((await render(missing)).guide.hidden, true)
assert.equal((await render(data, true)).guide.hidden, true)
assert.equal((await render(data, true, 'file:')).jawRatio.textContent, '78%')

const { nasion, pronasale, subnasale, alarLeft, alarRight } = data.fixture.landmarks
const height = nasion[1] - subnasale[1]
assert.ok(height > 0 && data.fixture.quality.landmarksReliable)
assert.equal(Math.round(Math.abs(alarLeft[0] - alarRight[0]) / height * 100), 43)
assert.equal(Math.round((pronasale[2] - (alarLeft[2] + alarRight[2]) / 2) / height * 100), 35)
assert.match(html, /합성 모델 데모/)
assert.match(html, /측정 불가/)
console.log('합성 입력·HTML 일치, 얼굴형 78%·101%, 코 43%·35%, 품질 실패 안내: 통과')
