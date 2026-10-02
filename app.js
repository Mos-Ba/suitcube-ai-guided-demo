// ข้อความทุกภาษาอยู่ใน i18n.js (โหลดก่อนไฟล์นี้) — labels/angles เปลี่ยนตามภาษาใน setLang()
let labels = t('steps');
let angles = t('angles');
const photoKeys = ['front', 'back', 'left', 'right'];

// เว็บจริงเรียก /api แบบ same-origin (nginx เติม API key ให้เบื้องหลัง — ห้ามใส่ key ในหน้าเว็บ)
// เปิดบนเครื่อง dev จะเรียก ML API ที่ localhost:8000 ตรงๆ (path ไม่มี /api)
const API_BASE = window.SUITCUBE_API_BASE
  || (['localhost', '127.0.0.1'].includes(location.hostname) ? `http://${location.hostname}:8000` : '/api');

// โหมดพรีวิว: บน GitHub Pages ไม่มี /api — กดส่งแล้วไปหน้าผลด้วยตัวเลขตัวอย่าง (ไม่ส่งรูปออกจากเครื่อง)
// เปิดเองได้ด้วย ?preview=1 · วางที่ measure.suitcube.com แล้วจะเรียก AI จริงอัตโนมัติ
const PREVIEW_MODE = location.hostname.endsWith('github.io') || new URLSearchParams(location.search).has('preview');

// ขีดจำกัดของ API: 8 MB และ 25 ล้านพิกเซลต่อรูป — รูปเกินจะถูกย่อในเครื่องก่อนส่ง
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_UPLOAD_PIXELS = 25_000_000;
const REQUEST_TIMEOUT_MS = 60_000; // server ตัดที่ 45 วินาที

// ค่าเผื่อตัดเสื้อสูท (นิ้ว) — ใช้ตอน "เลือกไซส์แนะนำ" เท่านั้น ค่าที่แสดงให้ลูกค้ายังเป็นค่าตัวจาก API
// ตารางไซส์ปัจจุบันเทียบด้วยรอบอกอย่างเดียว จึงใช้แค่ chest; เอว/สะโพก/ต้นแขนเก็บไว้เผื่อตารางมีคอลัมน์เพิ่ม
const GARMENT_EASE = { chest: 3, waist: 2, hip: 2, upper_arm: 1.5 };

// ตารางไซส์เสื้อ (รอบอก catalog, นิ้ว) — สำเนาจาก chest_to_jacket_size ใน suitcube-ml/main.py
// ถ้าแก้ตารางฝั่ง API ต้องแก้ตรงนี้ด้วย
const JACKET_SIZE_TABLE = {
  male: [['sz46', 37.0], ['sz48', 39.0], ['sz50', 41.0], ['sz52', 42.5], ['sz54', 44.0], ['sz56', 44.5], ['sz58', 46.5], ['sz60', 48.0]],
  female: [['sz34', 34.0], ['sz36', 35.5], ['sz38', 36.5], ['sz40', 38.0], ['sz42', 41.0], ['sz44', 43.5]]
};

// เลือกไซส์ที่รอบอก catalog ใกล้ที่สุด จุดกึ่งกลางพอดีเลือกไซส์เล็ก (ตรรกะเดียวกับ API)
function chestToJacketSize(chest, gender) {
  const table = JACKET_SIZE_TABLE[gender];
  for (let i = 0; i < table.length - 1; i++) {
    if (chest <= (table[i][1] + table[i + 1][1]) / 2) return table[i][0];
  }
  return table[table.length - 1][0];
}

// ไซส์แนะนำ + ทางเลือก จากรอบอกที่บวกค่าเผื่อแล้ว (ทางเลือก = ±1.2" เหมือน API)
function recommendSizes(bodyChest, gender) {
  const chest = bodyChest + GARMENT_EASE.chest;
  const main = chestToJacketSize(chest, gender);
  const alts = [chestToJacketSize(chest - 1.2, gender), chestToJacketSize(chest + 1.2, gender)]
    .filter((s, i, a) => s !== main && a.indexOf(s) === i);
  return { main, alts };
}

const state = {
  step: 0,
  max: 0,
  gender: 'male',
  values: { height: '', weight: '', waist: '', hip: '', chest: '' },
  photos: [null, null, null, null], // { url, file }
  failedPhotos: [],
  consent: false,
  result: null,
  busy: false,
  errorMsg: '',      // ข้อความ error ของขั้นปัจจุบัน (เก็บใน state เพราะ render เป็น async)
  justAdded: null,   // index รูปที่เพิ่งอัปโหลด — ให้ fade เข้าเฉพาะใบนั้น
  loadingTimer: null
};

const surface = document.querySelector('#surface');

/* ── Motion ──────────────────────────────────────────────────────────────
   เปลี่ยนเนื้อหาในการ์ดแบบลื่น: จางของเก่าออก → วางของใหม่ → ให้แต่ละส่วนลอยขึ้นทีละชิ้น
   พร้อมไล่ความสูงการ์ดให้ตามไปด้วย ปิดทั้งหมดเมื่อผู้ใช้ตั้ง prefers-reduced-motion */
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE_OUT = 'cubic-bezier(.22, .61, .36, 1)';
let navToken = 0;

async function transition(renderFn, dir = 1) {
  const token = ++navToken;
  const canAnimate = !reduceMotion();
  const hadContent = surface.children.length > 0;
  const h0 = surface.offsetHeight;
  if (canAnimate && hadContent) {
    try {
      // แท็บที่ถูกซ่อน animation จะไม่เดิน — แข่งกับ timer กันค้าง (เช่น ผลกลับมาตอนผู้ใช้สลับแท็บ)
      await Promise.race([
        surface.animate(
          [{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: `translateX(${dir * -10}px)` }],
          { duration: 150, easing: 'ease-in', fill: 'forwards' }
        ).finished,
        new Promise(ok => setTimeout(ok, 400))
      ]);
    } catch { /* ถูกยกเลิกเพราะมีการเปลี่ยนขั้นซ้อน — ปล่อยให้รอบใหม่จัดการ */ }
  }
  if (token !== navToken) return false;
  renderFn();
  surface.getAnimations().forEach(a => a.cancel());
  if (canAnimate) {
    surface.style.setProperty('--dx', `${dir * 18}px`);
    // ชิ้นที่ลอยขึ้น: ลูกตรงของ surface ยกเว้น result-layout ซึ่งแตกเป็นการ์ดย่อยแทน
    surface.querySelectorAll(':scope > :not(.result-layout), .result-layout > .result-side > *, .result-layout > .measure-card')
      .forEach((el, i) => { el.classList.add('rise'); el.style.setProperty('--i', i); });
    const h1 = surface.offsetHeight;
    if (hadContent && Math.abs(h1 - h0) > 4) {
      surface.style.overflow = 'hidden';
      surface.animate([{ height: `${h0}px` }, { height: `${h1}px` }], { duration: 320, easing: EASE_OUT })
        .finished.catch(() => {}).finally(() => { surface.style.overflow = ''; });
    }
  }
  return true;
}

// เลื่อนให้เห็นหัวการ์ดเมื่อผู้ใช้เลื่อนลงมาไกลแล้ว (ถ้ายังอยู่ด้านบน ปล่อย hero ไว้ตามเดิม)
function scrollToWorkspace() {
  const mobile = document.querySelector('.mobile-stepper');
  const anchor = (mobile && getComputedStyle(mobile).display !== 'none') ? mobile : document.querySelector('.workspace-card');
  if (!anchor) return;
  const headerH = document.querySelector('header')?.offsetHeight || 0;
  const target = anchor.getBoundingClientRect().top + window.scrollY - headerH - 12;
  if (window.scrollY > target + 40) window.scrollTo({ top: target, behavior: reduceMotion() ? 'auto' : 'smooth' });
}

// ไอคอนจากชุด SUITCUBE-AI-Result-Assets (stroke = currentColor ให้สีตาม CSS ของแต่ละจุด)
const svg = (body, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON = {
  measureTape: svg('<ellipse cx="12" cy="6" rx="8" ry="3"/><ellipse cx="12" cy="6" rx="3.5" ry="1.2"/><path d="M4 6v10c0 2 3.6 3.5 8 3.5 2.3 0 4.5-.4 6-1.2M20 6v7l-8 3v5l10-4v-6l-10 3M7 9v3m4-2v3m4-3v2m1 4v3m3-4v3"/>'),
  person: svg('<circle cx="12" cy="7" r="4"/><path d="M4 21v-3a8 8 0 0 1 16 0v3Z"/>'),
  ruler: svg('<rect x="8" y="2" width="8" height="20" rx="1"/><path d="M8 6h4M8 10h3M8 14h4M8 18h3"/>'),
  scale: svg('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 7a7 7 0 0 1 10 0l-2 5H9Z M12 10l2-3"/>'),
  waist: svg('<path d="M5 3h14l-1 6 3 12h-7l-2-8-2 8H3L6 9Z M5 6h14M8 4v3m8-3v3 M6 9h12"/>'),
  bmi: svg('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M5 12h3l2-5 4 10 2-5h3"/>'),
  edit: svg('<path d="m14 5 4 4M5 15l-1 5 5-1L21 7a2.8 2.8 0 0 0-4-4Z M12 3H5a2 2 0 0 0-2 2v16h16v-7"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.2"/>'),
  print: svg('<path d="M7 8V3h10v5M7 17H3V9h18v8h-4M7 14h10v7H7Z M17 11h1"/>'),
  chat: svg('<path d="M21 11a9 9 0 0 1-9 9 10 10 0 0 1-4-.8L3 21l1.7-5A9 9 0 1 1 21 11Z"/><circle cx="8" cy="11" r=".65" fill="currentColor" stroke="none"/><circle cx="12" cy="11" r=".65" fill="currentColor" stroke="none"/><circle cx="16" cy="11" r=".65" fill="currentColor" stroke="none"/>'),
  restart: svg('<path d="M4 8a9 9 0 1 1-1 7M4 3v5h5"/>'),
  check: svg('<path d="m5 12 5 5L20 6"/>'),
  // ภาพลายเส้นเสื้อสูท (ตกแต่ง ไม่ใช่ภาพจำลองทรงของลูกค้า)
  jacket: `<svg class="size-illus" viewBox="0 0 400 520" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m158 48-55 27-41 35L28 423l55 8 36-219-5 240q38 19 69 0l17-40 17 40q31 19 69 0l-5-240 36 219 55-8-34-313-41-35-55-27Z"/><path d="M158 48 200 68 242 48M171 54l29 190 29-190M158 48l-24 64 30 12-22 27 58 93M242 48l24 64-30 12 22 27-58 93M200 244v168M119 212l-16-137M281 212l16-137M34 392l53 8M366 392l-53 8 M114 452q45-6 69-39M286 452q-45-6-69-39"/><path d="m128 315 46 5-2 18-46-5ZM226 320l46-5 2 18-46 5ZM231 175l39-7 2 10-39 7Z"/><path d="M183 62v46M217 62v46M174 83h52" stroke-opacity=".6"/><circle cx="210" cy="275" r="4"/><circle cx="210" cy="314" r="4"/><g stroke-width="1.5"><circle cx="46" cy="407" r="2.5"/><circle cx="56" cy="409" r="2.5"/><circle cx="66" cy="411" r="2.5"/><circle cx="354" cy="407" r="2.5"/><circle cx="344" cy="409" r="2.5"/><circle cx="334" cy="411" r="2.5"/></g></svg>`
};
const escapeText = v => String(v).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

// สูทแนะนำท้ายหน้า — ชื่อ/รูป/ลิงก์คัดลอกจาก suitcube.com (2026-10-01) ถ้าหน้าร้านเปลี่ยนสินค้าต้องแก้ที่นี่ด้วย
// ลิงก์ตามภาษา: suitcube.com ใช้ /en/ และ /zh-hans/ นำหน้า path เดิม (ตรวจแล้ว 2026-10-02)
const SITE_PREFIX = { th: '', en: 'en/', zh: 'zh-hans/' };
const PICKS = {
  male: {
    all: { th: 'ultimate-fit/', en: 'en/ultimate-fit/', zh: 'zh-hans/ultimate-fit/' },
    line: () => 'ULTIMATE FIT',
    items: [
      ['Formal Blue', 'UF2039-1', 'm-formal-blue.webp', 'formalblue'],
      ['Classic Black', 'UF068-BK', 'm-classic-black.webp', 'classicblack'],
      ['Gentle Gray', 'UF068-31', 'm-gentle-gray.webp', 'ultimate-fit-gentle-gray-uf068-31'],
      ['Camel Gray', 'UF632-7', 'm-camel-gray.webp', 'ultimate-fit-camel-gray-uf632-7']
    ]
  },
  female: {
    // หน้าหมวดสูทผู้หญิงภาษาจีนยังไม่มีบน suitcube.com → ชี้หน้าแรกภาษาจีนแทน
    all: { th: 'product-category/women-suit/', en: 'en/product-category/women-suit/', zh: 'zh-hans/' },
    line: () => t('pickLineWomen'),
    items: [
      ['Camila Navy Berry', 'F570-620', 'w-navy-berry.jpg', 'camila-navy-berry-f570-620'],
      ['Camila Snow White', 'F570-526', 'w-snow-white.webp', 'camila-snow-white-f570-526'],
      ['Camila Pearl', 'F570-601', 'w-pearl.jpg', 'camila-pearl-f570-601'],
      ['Camila Red Rose', 'F570-614', 'w-red-rose.jpg', 'camila-red-rose-f570-614-2']
    ]
  }
};

let picksKey = '';
function renderPicks() {
  const grid = document.querySelector('#picks-grid');
  if (!grid) return;
  const m = state.result?.measurements;
  const size = state.step === 3 && typeof m?.chest === 'number'
    ? String(recommendSizes(m.chest, state.gender).main || '').replace(/^sz/i, '') : '';
  const key = `${LANG}|${state.gender}|${size}`;
  if (key === picksKey) return;
  picksKey = key;

  const set = PICKS[state.gender] || PICKS.male;
  const site = 'https://www.suitcube.com/';
  document.querySelector('#picks-all').href = site + set.all[LANG];
  document.querySelector('#picks-sub').textContent = size ? t('picksSubSize', { size }) : t('picksSub');
  grid.innerHTML = set.items.map(([name, code, img, slug]) => `
    <li>
      <a class="pick-card" href="${site}${SITE_PREFIX[LANG]}product/${slug}/" target="_blank" rel="noopener">
        <span class="pick-photo"><img src="images/products/${img}" alt="${escapeText(t('pickAlt', { name }))}" width="330" height="396" loading="lazy"></span>
        <span class="pick-line">${escapeText(set.line())}</span>
        <strong>${escapeText(name)}</strong>
        <span class="pick-code">${code}</span>
        <span class="pick-cta">${t('pickCta')}</span>
      </a>
    </li>`).join('');
}

async function go(n) {
  if (state.busy) return;
  const dir = n >= state.step ? 1 : -1;
  state.step = n;
  state.max = Math.max(state.max, n);
  state.errorMsg = '';
  if (!(await transition(render, dir))) return;
  surface.querySelector('h2')?.focus({ preventScroll: true });
  scrollToWorkspace();
}

// ช่วงค่าที่รับ (ตรงกับที่ API ตรวจ) — ใช้ทั้งวาดช่องกรอกและตรวจค่า · ชื่อช่อง/หน่วยมาจาก i18n
const FIELD_RULES = {
  height: ['cm', 100, 230],
  weight: ['kg', 25, 250],
  waist: ['in', 20, 70],
  chest: ['in', 20, 70],
  hip: ['in', 20, 80]
};
const fieldTitle = key => t(`f_${key}`);
const unitText = unit => (unit === 'in' ? t('unitIn') : unit);

function field(key, disabled = false) {
  const [unit, min, max] = FIELD_RULES[key];
  const isWaist = key === 'waist';
  return `
    <div class="field">
      <label for="${key}">${fieldTitle(key)}</label>
      <div class="input-wrap">
        <input id="${key}" name="${key}" type="number" inputmode="decimal" step="any" min="${min}" max="${max}" required ${disabled ? 'disabled' : ''} value="${escapeText(state.values[key])}" autocomplete="off" aria-describedby="${isWaist ? 'waist-hint ' : ''}${key}-error">
        <span class="unit-tag">${unitText(unit)}</span>
        ${isWaist ? `<button type="button" class="inline-help-btn" data-help="waist" aria-label="${t('waistHelpLabel')}">?</button>` : ''}
      </div>
      ${isWaist ? `<p class="hint" id="waist-hint">${t('waistHint')}</p>` : ''}
      <p class="field-error" id="${key}-error" hidden></p>
    </div>
  `;
}

// ข้อความ error ของช่องกรอก (คืน '' ถ้าค่าถูกต้อง) — บอกปัญหาและวิธีแก้ในภาษาที่เลือก แทนกล่องของเบราว์เซอร์
function fieldMessage(input) {
  const [unit, min, max] = FIELD_RULES[input.name];
  const title = fieldTitle(input.name);
  const vars = { title, titleLower: title.toLowerCase(), min, max, unit: unitText(unit) };
  if (input.validity.badInput) return t('errNumber', vars);
  const raw = input.value.trim();
  if (!raw) return t('errEmpty', vars);
  const n = Number(raw);
  if (!Number.isFinite(n)) return t('errNumber', vars);
  if (n < min || n > max) {
    // กรอกเป็นเซนติเมตรแทนนิ้ว เป็นความผิดพลาดที่เจอบ่อย
    return t('errRange', vars) + (unit === 'in' && n > max ? t('errCm') : '');
  }
  return '';
}

function validateField(input) {
  const msg = fieldMessage(input);
  const el = document.querySelector(`#${input.name}-error`);
  input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  input.closest('.input-wrap')?.classList.toggle('invalid', !!msg);
  if (el) { el.textContent = msg; el.hidden = !msg; }
  return !msg;
}

// ประกาศสั้นๆ ให้ screen reader โดยไม่ย้ายโฟกัส
function announce(text) {
  const live = document.querySelector('#live');
  if (!live) return;
  live.textContent = '';
  setTimeout(() => { live.textContent = text; }, 50);
}

let stepperKey = '';
// วาด stepper ใหม่เฉพาะตอนขั้น/สิทธิ์เปลี่ยน — ไม่งั้นแอนิเมชันจุด active จะเล่นซ้ำทุกครั้งที่อัปโหลดรูป
function renderStepper(force = false) {
  const key = `${state.step}|${state.max}|${state.busy}`;
  if (!force && key === stepperKey) return;
  stepperKey = key;

  const stepsEl = document.querySelector('#steps');
  if (stepsEl) {
    stepsEl.innerHTML = labels.map((l, i) => `
      <button class="step ${i === state.step ? 'active' : i < state.step ? 'complete' : ''}" ${i > state.max || state.busy ? 'disabled' : ''} data-step="${i}" ${i === state.step ? 'aria-current="step"':''}>
        <b>${i < state.step ? ICON.check : i + 1}</b>
        <span>${l}</span>
      </button>
    `).join('');
  }

  const mobLabel = document.querySelector('#mobile-step-label');
  if (mobLabel) mobLabel.textContent = t('stepOf', { n: state.step + 1 });
  document.querySelectorAll('.mob-dot').forEach((dot, idx) => {
    dot.setAttribute('aria-label', t('dotLabel', { n: idx + 1, label: labels[idx] }));
    dot.classList.toggle('active', idx === state.step);
    dot.classList.toggle('complete', idx < state.step);
    dot.disabled = idx > state.max || state.busy;
    if (idx === state.step) dot.setAttribute('aria-current', 'step'); else dot.removeAttribute('aria-current');
  });
}

function render() {
  clearInterval(state.loadingTimer);

  // 0. Show the preparation guide panel only on step 1; result page uses the full card width
  document.querySelector('#workspace-body')?.classList.toggle('no-guide', state.step !== 0);
  document.querySelector('#workspace-body')?.classList.toggle('result-mode', state.step === 3);

  // 1-2. Steppers (desktop + mobile)
  renderStepper();

  // 3. Render Step Content
  let body = '';
  if (state.step === 0) {
    body = `
      <h2 tabindex="-1">${labels[0]}</h2>
      <p class="sub">${t('s0Sub')}</p>
      <div class="gender" role="group" aria-label="${t('genderLabel')}" data-gender="${state.gender}">
        <button type="button" data-gender="male" class="${state.gender === 'male' ? 'selected' : ''}" aria-pressed="${state.gender === 'male'}">${t('genderMale')}</button>
        <button type="button" data-gender="female" class="${state.gender === 'female' ? 'selected' : ''}" aria-pressed="${state.gender === 'female'}">${t('genderFemale')}</button>
      </div>
      <form id="basics" novalidate>
        ${field('height')}
        ${field('weight')}
        ${field('waist')}
        <div class="female-fields ${state.gender === 'female' ? 'open' : ''}">
          <div class="female-fields-inner">
            ${field('chest', state.gender !== 'female')}
            ${field('hip', state.gender !== 'female')}
          </div>
        </div>
        <div class="actions">
          <button class="primary" type="submit">${t('next1')} <span aria-hidden="true">→</span></button>
        </div>
      </form>
      <p class="form-foot">${t('formFoot')}</p>
    `;
  } else if (state.step === 1) {
    const failedNames = state.failedPhotos.map(k => angles[photoKeys.indexOf(k)]).join(t('listSep'));
    body = `
      <h2 tabindex="-1">${t('s1Title')}</h2>
      <p class="sub">${t('s1Sub')}</p>
      <div class="photos">
        ${angles.map((a, i) => `
          <div class="photo-card ${state.failedPhotos.includes(photoKeys[i]) ? 'photo-failed' : ''} ${state.justAdded === i ? 'just-added' : ''}">
            <div class="photo-preview ${state.photos[i] ? 'has-image' : ''}">
              ${state.photos[i] ? `
                <img src="${state.photos[i].url}" alt="${t('photoAlt', { angle: a })}">
                ${state.failedPhotos.includes(photoKeys[i]) ? `<span class="retake-badge">${t('retake')}</span>` : ''}
              ` : `
                <img src="images/photo-sample-${photoKeys[i]}.jpg" alt="${t('sampleAlt', { angle: a })}" class="photo-example">
                <span class="sample-badge">${t('sample')}</span>
              `}
            </div>
            <strong>${a} ${state.photos[i] && !state.failedPhotos.includes(photoKeys[i]) ? '<span class="check-mark-text">✓</span>' : ''}</strong>
            <label for="photo${i}">
              ${state.photos[i] ? t('change') : t('choose')}
              <input id="photo${i}" type="file" accept="image/jpeg,image/png,image/webp" data-photo="${i}">
            </label>
            ${state.photos[i] ? `<button type="button" class="remove-photo-btn" data-remove="${i}">${t('remove')}</button>` : ''}
          </div>
        `).join('')}
      </div>
      <p class="privacy">${t('photoNote')}</p>
      <button type="button" class="text-button" data-help="photo">${t('photoHow')}</button>
      <p class="error" id="error" role="alert">${state.errorMsg ? escapeText(state.errorMsg) : state.failedPhotos.length
        ? escapeText(t('photoFailed', { angles: failedNames }))
        : ''}</p>
      <div class="actions">
        <button type="button" class="secondary" data-step="0">${t('back')}</button>
        <button type="button" class="primary" id="photos-next">${t('next2')}</button>
      </div>
    `;
  } else if (state.step === 2) {
    body = `
      <h2 tabindex="-1">${t('s2Title')}</h2>
      <p class="sub">${t('s2Sub')}</p>
      <div class="review">
        <div><span>${t('genderLabel')}</span><strong>${state.gender === 'male' ? t('genderMale') : t('genderFemale')}</strong></div>
        ${Object.entries(state.values).filter(([k, v]) => v && (state.gender === 'female' || !['chest', 'hip'].includes(k))).map(([k, v]) => `
          <div><span>${fieldTitle(k)}</span><strong>${escapeText(v)} ${unitText(FIELD_RULES[k][0])}</strong></div>
        `).join('')}
      </div>
      <button type="button" class="text-button" data-step="0">${t('editInfo')}</button>

      <div class="mini-photos-wrap">
        <span class="mini-photos-title">${t('photos4')}</span>
        <div class="mini-photos">
          ${state.photos.map((p, i) => `
            <div class="mini-photo-item">
              <img src="${p?.url || ''}" alt="${angles[i]}">
              <small>${angles[i]}</small>
            </div>
          `).join('')}
        </div>
      </div>

      <button type="button" class="text-button" data-step="1">${t('editPhotos')}</button>

      <label class="consent">
        <input type="checkbox" id="consent" ${state.consent ? 'checked' : ''}>
        <span>${t('consent')}
        <button type="button" class="inline-link" data-help="privacy">${t('consentMore')}</button></span>
      </label>

      <p class="error" id="error" role="alert">${escapeText(state.errorMsg)}</p>
      ${PREVIEW_MODE ? `<p class="preview-note">${t('previewNote')}</p>` : ''}
      <div class="actions">
        <button type="button" class="secondary" data-step="1">${t('back')}</button>
        <button type="button" class="primary" id="result" ${state.consent ? '' : 'disabled'}>${t('submit')}</button>
      </div>
    `;
  } else {
    const r = state.result || {};
    const m = r.measurements || {};
    const fmt = n => (typeof n === 'number' ? n.toFixed(2) : '–');
    // API ส่ง "sz46" — หน้าผลแสดงแค่ตัวเลขตามแบบ
    const sizeNum = s => escapeText(String(s || '–').replace(/^sz/i, ''));
    // ไซส์แนะนำคิดใหม่จากรอบอก + ค่าเผื่อ (API ส่งไซส์ที่เทียบจากรอบอกตัวมา) — ถ้าไม่มีรอบอกใช้ของ API
    const rec = typeof m.chest === 'number'
      ? recommendSizes(m.chest, state.gender)
      : { main: r.jacket_size, alts: r.jacket_size_alternatives || [] };
    const alts = rec.alts.map(sizeNum).join(', ');
    const lengthName = t('lengthNames')[r.jacket_length] || '';
    // คำเตือนจาก API เป็นภาษาไทย — ภาษาอื่นแสดงข้อความกลางข้อเดียวแทน (ทีมงานเห็นฉบับเต็มใน Lark Base)
    const rawWarnings = r.warnings || [];
    const warnings = rawWarnings.length && t('warningsGeneric') ? [t('warningsGeneric')] : rawWarnings;
    const confirmWaist = r.action_required === 'CONFIRM_WAIST';
    const mLabels = t('measures');
    const measures = [m.shoulder, m.chest, m.waist, m.hip, m.upper_arm, m.arm_length, m.front_length, m.back_length]
      .map((v, i) => [mLabels[i], v]);
    const val = k => ({ v: escapeText(state.values[k]) });
    const info = [
      [ICON.person, state.gender === 'male' ? t('male') : t('female')],
      [ICON.ruler, t('infoHeight', val('height'))],
      [ICON.scale, t('infoWeight', val('weight'))],
      [ICON.waist, t('infoWaist', val('waist'))],
      ...(state.gender === 'female' && state.values.chest ? [[ICON.measureTape, t('infoChest', val('chest'))]] : []),
      ...(state.gender === 'female' && state.values.hip ? [[ICON.measureTape, t('infoHip', val('hip'))]] : []),
      ...(typeof r.bmi === 'number' ? [[ICON.bmi, `BMI ${r.bmi}`]] : [])
    ];
    const issuedAt = new Date().toLocaleString(t('locale'), { dateStyle: 'medium', timeStyle: 'short' });
    body = `

      <img src="images/suitcube-ai-logo.webp" alt="SUITCUBE AI" class="print-only print-logo">
      <div class="result-title">
        <h2 tabindex="-1">${t('resTitle')}</h2>
        <p class="sub">${t('resSub')}</p>
      </div>
      ${r.preview ? `<p class="preview-banner">${t('previewBanner')}</p>` : ''}

      <div class="result-layout">
        <div class="result-side">
          <section class="size-card" aria-label="${t('sizeCardLabel')}">
            <span class="eyebrow eyebrow-thread">SUITCUBE · FIT LABEL</span>
            <span class="size-label">${t('sizeLabel')}</span>
            <div class="size-main">
              <span class="size-num">${sizeNum(rec.main)}</span>
              <span class="size-len"><b>${escapeText(r.jacket_length || '')}</b>${lengthName ? `<small>${lengthName}</small>` : ''}</span>
              <span class="result-badge">${t('badge')}</span>
            </div>
            ${alts ? `<div class="size-alt">${t('sizeAlt')} <b>${alts}</b></div>` : ''}
            ${ICON.jacket}
          </section>

          <section class="soft-card">
            <div class="card-head">
              <h3>${t('yourInfo')}</h3>
              <button type="button" class="edit-link" data-step="0">${ICON.edit}${t('editShort')}</button>
            </div>
            <ul class="info-list">
              ${info.map(([icon, text]) => `<li>${icon}<span>${text}</span></li>`).join('')}
            </ul>
          </section>
        </div>

        <section class="soft-card measure-card ticket">
          <div class="ticket-strip">
            <span class="eyebrow">FITTING TICKET</span>
            <span class="ticket-meta">${escapeText(t('issued', { date: issuedAt }))}</span>
          </div>
          <div class="card-head">
            <h3>${ICON.measureTape}${t('measTitle')}</h3>
            <span class="unit-pill">${t('unitPill')}</span>
          </div>
          <div class="measure-grid">
            ${measures.map(([label, v]) => `<div class="measure-item"><span>${label}</span><strong>${fmt(v)}″</strong></div>`).join('')}
          </div>
          ${confirmWaist ? `<p class="result-alert">${t('confirmWaist')}</p>` : ''}
          ${warnings.length ? `
            <ul class="result-notes">
              ${warnings.map(w => `<li>${escapeText(w)}</li>`).join('')}
            </ul>
          ` : ''}
          <p class="result-note">${ICON.info}${t('resultNote')}</p>
          <div class="result-actions">
            <button type="button" class="primary" id="print">${ICON.print}${t('print')}</button>
            <button type="button" class="secondary" data-help="stylist">${ICON.chat}${t('navStylist')}</button>
            <button type="button" class="text-button" id="reset">${ICON.restart}${t('restart')}</button>
          </div>
        </section>
      </div>
    `;
  }

  surface.innerHTML = body;
  bind();
  renderPicks();
}

function bind() {
  const basics = document.querySelector('#basics');
  basics?.addEventListener('input', e => {
    if (e.target.name) {
      state.values[e.target.name] = e.target.value;
      state.max = 0;
      state.result = null;
      // ช่องที่ขึ้น error อยู่: ตรวจใหม่ทุกครั้งที่พิมพ์ ให้ข้อความหายทันทีที่ค่าถูก
      if (e.target.getAttribute('aria-invalid') === 'true') validateField(e.target);
    }
  });
  // ออกจากช่องแล้วค่อยเตือน (ไม่เตือนช่องที่ยังว่าง — รอตอนกดถัดไป)
  basics?.addEventListener('focusout', e => {
    if (e.target.name && (e.target.value || e.target.validity.badInput)) validateField(e.target);
  });
  // หมุนล้อเมาส์บนช่องตัวเลขจะเปลี่ยนค่าโดยไม่ตั้งใจ
  basics?.addEventListener('wheel', e => {
    if (e.target.type === 'number' && document.activeElement === e.target) e.target.blur();
  }, { passive: true });

  document.querySelector('#consent')?.addEventListener('change', e => {
    state.consent = e.target.checked;
    const btn = document.querySelector('#result');
    if (btn) btn.disabled = !state.consent;
  });

  basics?.addEventListener('submit', e => {
    e.preventDefault();
    const inputs = [...basics.querySelectorAll('input[name]:not(:disabled)')];
    const bad = inputs.filter(inp => !validateField(inp));
    if (bad.length) return bad[0].focus();
    go(1);
  });

  document.querySelectorAll('[data-photo]').forEach(el => {
    el.addEventListener('change', async () => {
      await loadPhoto(Number(el.dataset.photo), el.files[0]);
      el.value = ''; // เลือกไฟล์เดิมซ้ำหลัง error ได้ (ไม่งั้น change ไม่ยิง)
    });
  });

  document.querySelector('#photos-next')?.addEventListener('click', () => {
    if (state.photos.some(p => !p)) return error(t('errNeed4'));
    go(2);
  });

  document.querySelector('#result')?.addEventListener('click', submitPrediction);

  document.querySelector('#print')?.addEventListener('click', () => window.print());
  document.querySelector('#reset')?.addEventListener('click', () => showHelp('reset'));
}

function error(t) {
  state.errorMsg = t;
  const el = document.querySelector('#error');
  if (el) el.textContent = t;
}

function loadingHTML() {
  return `<div class="loading" role="status">
    <div class="tape" aria-hidden="true"><div class="tape-ticks"></div><div class="tape-tab"></div></div>
    <h2>${t('loadingTitle')}</h2>
    <p class="sub loading-status">${t('loadingSteps')[0]}</p>
    <p class="loading-hint">${t('loadingHint')}</p>
  </div>`;
}

// สลับข้อความสถานะทุก 2.2 วินาที ให้รู้ว่าระบบยังทำงานอยู่ (render() ครั้งถัดไปจะหยุดให้เอง)
function startLoadingTicker() {
  let i = 0;
  state.loadingTimer = setInterval(() => {
    const el = surface.querySelector('.loading-status');
    if (!el) return clearInterval(state.loadingTimer);
    const steps = t('loadingSteps');
    i = (i + 1) % steps.length;
    const swap = () => { el.textContent = steps[i]; };
    if (reduceMotion()) return swap();
    el.animate([{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-4px)' }], { duration: 180, easing: 'ease-in', fill: 'forwards' })
      .finished.then(() => {
        swap();
        el.getAnimations().forEach(a => a.cancel());
        el.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 220, easing: 'ease-out' });
      }).catch(() => {});
  }, 2200);
}

// อ่านข้อความจาก detail ของ API (เป็นได้ทั้ง string, {message,...} หรือ list ของ pydantic)
function apiMessage(detail) {
  if (!detail) return '';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map(d => d?.msg || '').filter(Boolean).join(' · ');
  return detail.message || '';
}

async function submitPrediction() {
  if (state.busy || !state.consent) return;
  if (state.photos.some(p => !p?.file)) return error(t('errNeed4'));

  const isFemale = state.gender === 'female';
  const fd = new FormData();
  fd.append('gender', isFemale ? '0' : '1');
  fd.append('weight_kg', state.values.weight);
  fd.append('height_cm', state.values.height);
  fd.append('waist_inch', state.values.waist);
  if (isFemale && state.values.chest) fd.append('chest_inch', state.values.chest);
  if (isFemale && state.values.hip) fd.append('hip_inch', state.values.hip);
  state.photos.forEach((p, i) => fd.append(photoKeys[i], p.file, `${photoKeys[i]}.jpg`));

  state.busy = true;
  await transition(() => { surface.innerHTML = loadingHTML(); startLoadingTicker(); }, 1);

  if (PREVIEW_MODE) {
    await new Promise(r => setTimeout(r, reduceMotion() ? 600 : 2600));
    state.busy = false;
    state.result = previewResult();
    state.failedPhotos = [];
    go(3);
    return;
  }

  let res, body;
  try {
    let signal;
    if (AbortSignal.timeout) signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    else {
      // Safari < 16 ไม่มี AbortSignal.timeout — ตั้ง timer เองไม่งั้นค้างหน้าโหลดไม่มีกำหนด
      const ctl = new AbortController();
      setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
      signal = ctl.signal;
    }
    res = await fetch(`${API_BASE}/predict/suit/from-photos`, { method: 'POST', body: fd, signal });
    body = await res.json().catch(() => ({}));
  } catch (e) {
    state.busy = false;
    go(2);
    return error(e?.name === 'TimeoutError' || e?.name === 'AbortError'
      ? t('errTimeout')
      : navigator.onLine === false ? t('errOffline') : t('errConnect'));
  }
  state.busy = false;

  if (res.ok && body?.success) {
    state.result = body;
    state.failedPhotos = [];
    go(3);
    return;
  }

  // รูปที่ตรวจจับร่างกายไม่ได้ → กลับไปหน้าภาพถ่าย ชี้ว่ามุมไหนต้องถ่ายใหม่
  const failed = body?.detail?.failed_photos || body?.detail?.missing || [];
  if (res.status === 422 && failed.length) {
    state.failedPhotos = failed;
    state.max = 1;
    go(1);
    return;
  }

  go(2);
  // ข้อความจาก API เป็นภาษาไทย — ใช้เฉพาะตอนแสดงภาษาไทย ภาษาอื่นใช้ข้อความของหน้าเว็บ
  const msg = LANG === 'th' ? apiMessage(body?.detail) : '';
  if (res.status === 413) return error(msg || t('err413'));
  if (res.status === 503 || res.status === 429) return error(t('errBusy'));
  if (res.status === 504) return error(t('errTimeout'));
  if (res.status === 400 || res.status === 415 || res.status === 422) return error(msg || t('errInvalid'));
  return error(t('errUnavailable'));
}

// ผลตัวอย่างสำหรับโหมดพรีวิว — สัดส่วนประมาณหยาบๆ จากค่าที่กรอก ไม่ใช่โมเดล (หน้าผลติดป้ายบอกชัด)
function previewResult() {
  const isFemale = state.gender === 'female';
  const h = Number(state.values.height) || 170;
  const w = Number(state.values.weight) || 70;
  const waist = Number(state.values.waist) || 32;
  const bmi = Math.round((w / ((h / 100) ** 2)) * 10) / 10;
  const q = n => Math.round(n * 4) / 4;  // ปัดเป็นทีละ 1/4 นิ้วแบบที่ช่างใช้
  const chest = isFemale && Number(state.values.chest) ? Number(state.values.chest) : waist + (isFemale ? 5 : 7);
  const hip = isFemale && Number(state.values.hip) ? Number(state.values.hip) : waist + 6;
  return {
    success: true,
    preview: true,
    bmi,
    jacket_length: h < 168 ? 'S' : h > 182 ? 'L' : 'R',
    measurements: {
      shoulder: q(h * (isFemale ? 0.245 : 0.27) / 2.54),
      chest: q(chest),
      waist: q(waist + 1),
      hip: q(hip),
      upper_arm: q(Math.max(9, 10 + (bmi - 22) * 0.35)),
      arm_length: q(h * 0.36 / 2.54),
      front_length: q(h * (isFemale ? 0.4 : 0.44) / 2.54),
      back_length: q(h * (isFemale ? 0.39 : 0.43) / 2.54)
    },
    warnings: []
  };
}

// ย่อรูปเฉพาะที่เกินขีดจำกัดของ API — รูปปกติส่งไฟล์เดิม เพื่อไม่ให้ผลโมเดลเปลี่ยน
async function fitForUpload(file, img) {
  const pixels = img.naturalWidth * img.naturalHeight;
  if (file.size <= MAX_UPLOAD_BYTES && pixels <= MAX_UPLOAD_PIXELS) return file;
  const scale = Math.min(1, Math.sqrt((MAX_UPLOAD_PIXELS * 0.6) / pixels), 4000 / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  for (const q of [0.92, 0.85, 0.75]) {
    const blob = await new Promise(ok => canvas.toBlob(ok, 'image/jpeg', q));
    if (blob && blob.size <= MAX_UPLOAD_BYTES) return blob;
  }
  throw new Error('too large');
}

async function loadPhoto(i, file) {
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    return error(t('errType'));
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  try {
    await new Promise((ok, no) => {
      img.onload = ok;
      img.onerror = no;
      img.src = url;
    });
  } catch {
    URL.revokeObjectURL(url);
    return error(t('errOpen'));
  }
  let upload;
  try {
    upload = await fitForUpload(file, img);
  } catch {
    URL.revokeObjectURL(url);
    return error(t('errBig'));
  }
  if (state.photos[i]?.url) URL.revokeObjectURL(state.photos[i].url);
  state.photos[i] = { url, file: upload };
  state.failedPhotos = state.failedPhotos.filter(k => k !== photoKeys[i]);
  state.result = null;
  state.errorMsg = '';
  state.max = 1;
  state.justAdded = i;
  render();
  state.justAdded = null;
  announce(t('liveAdded', { angle: angles[i], n: state.photos.filter(Boolean).length }));
}

function reset() {
  state.photos.forEach(p => { if (p?.url) URL.revokeObjectURL(p.url); });
  Object.assign(state, {
    step: 0,
    max: 0,
    gender: 'male',
    values: { height: '', weight: '', waist: '', hip: '', chest: '' },
    photos: [null, null, null, null],
    failedPhotos: [],
    consent: false,
    result: null,
    busy: false
  });
  render();
  closeDialog();
}

// แถบรูปตัวอย่างท่ายืน (ใส่หน้าคำแนะนำถ่ายภาพ ทุกภาษาใช้ร่วมกัน)
const photoStrip = () => `
  <div class="modal-photo-strip">
    ${photoKeys.map((k, i) => `<div class="modal-photo-item"><img src="images/photo-sample-${k}.jpg" alt="${angles[i]}"><small>${angles[i]}</small></div>`).join('')}
  </div>`;

function showHelp(key) {
  const h = t('help')[key];
  if (!h) return;
  document.querySelector('#dialog-content').innerHTML = `<h2>${h[0]}</h2>${key === 'photo' ? photoStrip() : ''}${h[1]}`;
  const d = document.querySelector('#dialog');
  d.classList.remove('is-closing');
  if (!d.open) d.showModal(); // showModal ซ้ำบน dialog ที่เปิดอยู่จะ throw
  document.querySelector('#confirm-reset')?.addEventListener('click', reset);
}

// Global Event Listeners
document.addEventListener('click', e => {
  // Desktop Stepper Click
  const step = e.target.closest('[data-step]');
  if (step && !step.disabled) {
    const n = Number(step.dataset.step);
    if (n <= state.max) go(n);
  }

  // Gender Toggle
  const gender = e.target.closest('.gender [data-gender]');
  if (gender) {
    state.gender = gender.dataset.gender;
    state.max = 0;
    state.result = null;
    const g = document.querySelector('.gender');
    if (state.step === 0 && g) {
      // อัปเดตในที่ ไม่วาดใหม่ทั้งฟอร์ม → แถบเลือกเลื่อน + ช่องรอบอก/สะโพกกางออกแบบลื่น
      g.dataset.gender = state.gender;
      g.querySelectorAll('button').forEach(b => {
        const sel = b.dataset.gender === state.gender;
        b.classList.toggle('selected', sel);
        b.setAttribute('aria-pressed', sel);
      });
      const isFemale = state.gender === 'female';
      const ff = document.querySelector('.female-fields');
      ff?.classList.toggle('open', isFemale);
      ff?.querySelectorAll('input').forEach(inp => { inp.disabled = !isFemale; });
      renderStepper(true);
      renderPicks();
    } else {
      render();
    }
  }

  // Help Modal Dialogs
  const h = e.target.closest('[data-help]');
  if (h) showHelp(h.dataset.help);

  // Photo Removal
  const remove = e.target.closest('[data-remove]');
  if (remove) {
    const i = Number(remove.dataset.remove);
    if (state.photos[i]?.url) URL.revokeObjectURL(state.photos[i].url);
    state.photos[i] = null;
    state.result = null;
    state.max = 1;
    render();
    announce(t('liveRemoved', { angle: angles[i] }));
    document.querySelector(`#photo${i}`)?.focus(); // ปุ่มที่กดหายไปแล้ว — คืนโฟกัสไว้ที่ช่องเลือกภาพของมุมเดิม
  }
});

// Setup Mobile Accordion Toggle
const accToggle = document.querySelector('#guide-accordion-toggle');
if (accToggle) {
  accToggle.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); accToggle.click(); }
  });
  const guideCol = document.querySelector('#guide-column');
  const guideBox = document.querySelector('#guide-box');
  const narrow = window.matchMedia('(max-width: 860px)');
  // จอแคบ + พับอยู่ → เนื้อหาถูกซ่อนด้วยความสูง 0 แต่ยัง Tab ถึง ต้องปิดด้วย inert
  const syncGuide = () => { guideBox.inert = narrow.matches && !guideCol.classList.contains('accordion-open'); };
  accToggle.addEventListener('click', () => {
    const isExp = guideCol.classList.toggle('accordion-open');
    accToggle.setAttribute('aria-expanded', isExp);
    syncGuide();
  });
  narrow.addEventListener?.('change', syncGuide);
  syncGuide();
}

// กันปิด/รีเฟรชหน้าโดยไม่ตั้งใจหลังเลือกภาพแล้ว (ภาพอยู่ในหน่วยความจำของหน้า หายแล้วต้องเลือกใหม่ทั้งหมด)
window.addEventListener('beforeunload', e => {
  if (state.photos.some(Boolean) && !state.result) e.preventDefault();
});

// Mobile Stepper Dot Clicks
document.querySelectorAll('.mob-dot').forEach(dot => {
  dot.addEventListener('click', () => {
    const s = Number(dot.dataset.step);
    if (s <= state.max) go(s);
  });
});

// ปิด dialog แบบมีแอนิเมชันออก (Esc และคลิกนอกกล่องก็ใช้ทางนี้)
function closeDialog() {
  const d = document.querySelector('#dialog');
  if (!d?.open) return;
  if (reduceMotion()) return d.close();
  d.classList.add('is-closing');
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    if (!d.classList.contains('is-closing')) return; // ถูกเปิดใหม่ระหว่างกำลังปิด
    d.classList.remove('is-closing');
    d.close();
  };
  d.addEventListener('animationend', finish, { once: true });
  setTimeout(finish, 400); // แท็บถูกซ่อน/animation ไม่ยิง ก็ยังปิดได้
}
document.querySelector('#close-dialog')?.addEventListener('click', closeDialog);
document.querySelector('#dialog')?.addEventListener('cancel', e => { e.preventDefault(); closeDialog(); });
document.querySelector('#dialog')?.addEventListener('click', e => {
  const r = e.currentTarget.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeDialog();
});

// Hero parallax เบาๆ (เฉพาะจอกว้างที่แสดงรูป และผู้ใช้ไม่ได้ปิดการเคลื่อนไหว)
const heroImg = document.querySelector('.hero-bg-img');
if (heroImg) {
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking || reduceMotion() || !window.matchMedia('(min-width: 861px)').matches) return;
    ticking = true;
    requestAnimationFrame(() => {
      heroImg.style.transform = `translateY(${Math.min(window.scrollY * 0.15, 54)}px)`;
      ticking = false;
    });
  }, { passive: true });
}

// สลับภาษา: ค่าที่กรอกและภาพที่เลือกอยู่ใน state จึงไม่หาย — วาดข้อความใหม่ทั้งหน้า
function setLang(lang) {
  if (!LANGS.includes(lang) || lang === LANG) return;
  LANG = lang;
  try { localStorage.setItem(LANG_STORE, lang); } catch { /* โหมดส่วนตัว */ }
  labels = t('steps');
  angles = t('angles');
  applyStaticI18n();
  syncLangUI();
  stepperKey = '';
  picksKey = '';
  if (state.busy) {
    // กำลังรอผล: เปลี่ยนเฉพาะข้อความหน้าโหลด ห้าม render() ทับ
    renderStepper(true);
    renderPicks();
    const status = surface.querySelector('.loading');
    if (status) { clearInterval(state.loadingTimer); surface.innerHTML = loadingHTML(); startLoadingTicker(); }
    return;
  }
  state.errorMsg = '';
  render();
}

// เมนูเลือกภาษา (listbox): คลิก/แตะ · ลูกศรขึ้นลง · Enter เลือก · Esc หรือคลิกข้างนอกเพื่อปิด
const langBtn = document.querySelector('#lang-btn');
const langMenu = document.querySelector('#lang-menu');
const langOpts = langMenu ? [...langMenu.querySelectorAll('[data-lang]')] : [];

function syncLangUI() {
  langOpts.forEach(o => o.setAttribute('aria-selected', o.dataset.lang === LANG));
  const cur = langOpts.find(o => o.dataset.lang === LANG);
  if (!cur || !langBtn) return;
  document.querySelector('#lang-current').textContent = cur.dataset.short;
  langBtn.setAttribute('aria-label', `${t('langLabel')}: ${cur.textContent.trim()}`);
}

function toggleLangMenu(open, focusBtn = true) {
  if (!langMenu || langMenu.hidden === !open) return;
  langMenu.hidden = !open;
  langBtn.setAttribute('aria-expanded', open);
  if (open) (langOpts.find(o => o.dataset.lang === LANG) || langOpts[0]).focus();
  else if (focusBtn) langBtn.focus();
}

if (langBtn && langMenu) {
  langBtn.addEventListener('click', () => toggleLangMenu(langMenu.hidden));
  langBtn.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); toggleLangMenu(true); }
  });
  langMenu.addEventListener('click', e => {
    const opt = e.target.closest('[data-lang]');
    if (!opt) return;
    toggleLangMenu(false);
    setLang(opt.dataset.lang);
  });
  langMenu.addEventListener('keydown', e => {
    const i = langOpts.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); langOpts[(i + 1) % langOpts.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); langOpts[(i - 1 + langOpts.length) % langOpts.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); langOpts[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); langOpts[langOpts.length - 1].focus(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); document.activeElement.click(); }
    else if (e.key === 'Escape') { e.preventDefault(); toggleLangMenu(false); }
    else if (e.key === 'Tab') toggleLangMenu(false, false);
  });
  // คลิก/แตะนอกเมนู = ปิด (ไม่ดึงโฟกัสกลับ ปล่อยให้ไปตามที่ผู้ใช้กด)
  document.addEventListener('pointerdown', e => {
    if (!langMenu.hidden && !e.target.closest('#lang-switch')) toggleLangMenu(false, false);
  });
}
syncLangUI();
applyStaticI18n();

// Initial Render (ลอยขึ้นเบาๆ ตอนโหลดหน้า)
transition(render, 1);

// Model Context Tools for Assistant Integration
if (document.modelContext?.registerTool) {
  for (const tool of [
    {
      name: 'read_fitting_step',
      description: 'Read current fitting step and image count, without returning personal measurements or images.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute(input) {
        if (!input || Object.keys(input).length) throw Error('Expected empty input');
        return { step: state.step + 1, label: labels[state.step], photoCount: state.photos.filter(Boolean).length };
      }
    }
  ]) {
    try { Promise.resolve(document.modelContext.registerTool(tool)).catch(() => {}); } catch {}
  }
}
