const labels = ['ข้อมูลเบื้องต้น', 'ภาพถ่าย', 'ตรวจสอบ', 'ผลประเมิน'];
const angles = ['ด้านหน้า', 'ด้านหลัง', 'ด้านซ้าย', 'ด้านขวา'];
const photoKeys = ['front', 'back', 'left', 'right'];

// เว็บจริงเรียก /api แบบ same-origin (nginx เติม API key ให้เบื้องหลัง — ห้ามใส่ key ในหน้าเว็บ)
// เปิดบนเครื่อง dev จะเรียก ML API ที่ localhost:8000 ตรงๆ (path ไม่มี /api)
const API_BASE = window.SUITCUBE_API_BASE
  || (['localhost', '127.0.0.1'].includes(location.hostname) ? `http://${location.hostname}:8000` : '/api');

// ขีดจำกัดของ API: 8 MB และ 25 ล้านพิกเซลต่อรูป — รูปเกินจะถูกย่อในเครื่องก่อนส่ง
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_UPLOAD_PIXELS = 25_000_000;
const REQUEST_TIMEOUT_MS = 60_000; // server ตัดที่ 45 วินาที

const state = {
  step: 0,
  max: 0,
  gender: 'male',
  values: { height: '', weight: '', waist: '', hip: '', chest: '' },
  photos: [null, null, null, null], // { url, file }
  failedPhotos: [],
  consent: false,
  result: null,
  busy: false
};

const surface = document.querySelector('#surface');

// ไอคอนลายเส้น (stroke = currentColor) ใช้ในหน้าผลประเมิน
const svg = (body, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON = {
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>'),
  ruler: svg('<rect x="8" y="2" width="8" height="20" rx="1.5"/><path d="M8 6h3M8 10h4M8 14h3M8 18h4"/>'),
  scale: svg('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7.5 10a6 6 0 0 1 9 0"/><path d="M12 10l1.6-1.8"/>'),
  tape: svg('<circle cx="9" cy="12" r="6"/><circle cx="9" cy="12" r="2"/><path d="M15 12h6v4h-6M18 12v2"/>'),
  pulse: svg('<polyline points="3 12 7 12 10 5 14 19 17 12 21 12"/>'),
  pencil: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.6v.1"/>'),
  printer: svg('<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>'),
  chat: svg('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>'),
  // ภาพลายเส้นเสื้อสูทบนการ์ดไซส์
  jacket: `<svg class="size-illus" viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M80 30 L56 40 Q46 44 44 56 L36 150 L34 168 L50 170 L54 150 L60 92"/>
    <path d="M120 30 L144 40 Q154 44 156 56 L164 150 L166 168 L150 170 L146 150 L140 92"/>
    <path d="M60 92 L58 176 Q78 182 98 182"/><path d="M140 92 L142 176 Q122 182 102 182"/>
    <path d="M80 30 Q90 36 100 36 Q110 36 120 30"/>
    <path d="M80 30 L71 58 L80 61 L100 118"/><path d="M120 30 L129 58 L120 61 L100 118"/>
    <path d="M89 37 L100 62 L111 37"/>
    <path d="M100 118 L99 182"/>
    <circle cx="103" cy="132" r="2.4"/><circle cx="103" cy="154" r="2.4"/>
    <path d="M65 141 L86 140"/><path d="M114 140 L135 141"/><path d="M117 84 L134 82"/>
    <circle cx="44" cy="160" r="1.3"/><circle cx="44.6" cy="164.6" r="1.3"/>
    <circle cx="156" cy="160" r="1.3"/><circle cx="155.4" cy="164.6" r="1.3"/>
  </svg>`
};
const escapeText = v => String(v).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

function go(n) {
  if (state.busy) return;
  state.step = n;
  state.max = Math.max(state.max, n);
  render();
  surface.querySelector('h2')?.focus({ preventScroll: true });
}

function field(key, title, unit, min, max) {
  const isWaist = key === 'waist';
  return `
    <div class="field">
      <label for="${key}">${title}</label>
      <div class="input-wrap">
        <input id="${key}" name="${key}" type="number" inputmode="decimal" step="any" min="${min}" max="${max}" required value="${escapeText(state.values[key])}" autocomplete="off">
        <span class="unit-tag">${unit}</span>
        ${isWaist ? '<button type="button" class="inline-help-btn" data-help="waist" aria-label="วิธีดูรอบเอวกางเกง">?</button>' : ''}
      </div>
      ${isWaist ? '<p class="hint">ใช้ขนาดเอวกางเกงที่คุณใส่</p>' : ''}
    </div>
  `;
}

function render() {
  // 0. Show the preparation guide panel only on step 1; result page uses the full card width
  document.querySelector('#workspace-body')?.classList.toggle('no-guide', state.step !== 0);
  document.querySelector('#workspace-body')?.classList.toggle('result-mode', state.step === 3);

  // 1. Render Desktop Stepper
  const stepsEl = document.querySelector('#steps');
  if (stepsEl) {
    stepsEl.innerHTML = labels.map((l, i) => `
      <button class="step ${i === state.step ? 'active' : i < state.step ? 'complete' : ''}" ${i > state.max || state.busy ? 'disabled' : ''} data-step="${i}" ${i === state.step ? 'aria-current="step"':''}>
        <b>${i < state.step ? '✓' : i + 1}</b>
        <span>${l}</span>
      </button>
    `).join('');
  }

  // 2. Update Mobile Stepper Indicator
  const mobStepNum = document.querySelector('#mobile-step-num');
  if (mobStepNum) mobStepNum.textContent = state.step + 1;
  document.querySelectorAll('.mob-dot').forEach((dot, idx) => {
    dot.classList.toggle('active', idx === state.step);
    dot.classList.toggle('complete', idx < state.step);
    dot.style.cursor = idx <= state.max ? 'pointer' : 'default';
  });

  // 3. Render Step Content
  let body = '';
  if (state.step === 0) {
    body = `
      <h2 tabindex="-1">ข้อมูลเบื้องต้น</h2>
      <p class="sub">เริ่มจากข้อมูลที่คุณทราบ</p>
      <div class="gender" role="group" aria-label="ประเภทสูท">
        <button type="button" data-gender="male" class="${state.gender === 'male' ? 'selected' : ''}" aria-pressed="${state.gender === 'male'}">สูทผู้ชาย</button>
        <button type="button" data-gender="female" class="${state.gender === 'female' ? 'selected' : ''}" aria-pressed="${state.gender === 'female'}">สูทผู้หญิง</button>
      </div>
      <form id="basics">
        ${field('height', 'ส่วนสูง', 'cm', 100, 230)}
        ${field('weight', 'น้ำหนัก', 'kg', 25, 250)}
        ${field('waist', 'รอบเอวกางเกง', 'นิ้ว', 20, 70)}
        ${state.gender === 'female' ? field('chest', 'รอบอก', 'นิ้ว', 20, 70) + field('hip', 'รอบสะโพก', 'นิ้ว', 20, 80) : ''}
        <div class="actions">
          <button class="primary" type="submit">ถัดไป: เตรียมภาพถ่าย <span aria-hidden="true">→</span></button>
        </div>
      </form>
      <p class="form-foot">ไม่ต้องสมัครสมาชิก · ข้อมูลจะถูกส่งเมื่อคุณกดยืนยันในขั้นตอนตรวจสอบเท่านั้น</p>
    `;
  } else if (state.step === 1) {
    body = `
      <h2 tabindex="-1">ภาพถ่ายของคุณ</h2>
      <p class="sub">เตรียมภาพเต็มตัวทั้ง 4 มุม (เห็นศีรษะถึงปลายเท้า)</p>
      <div class="photos">
        ${angles.map((a, i) => `
          <div class="photo-card ${state.failedPhotos.includes(photoKeys[i]) ? 'photo-failed' : ''}">
            <div class="photo-preview ${state.photos[i] ? 'has-image' : ''}">
              ${state.photos[i] ? `
                <img src="${state.photos[i].url}" alt="ภาพ${a}">
                ${state.failedPhotos.includes(photoKeys[i]) ? '<span class="retake-badge">ถ่ายใหม่</span>' : ''}
              ` : `
                <img src="images/photo-sample-${photoKeys[i]}.jpg" alt="ตัวอย่างท่ายืนถ่ายภาพ${a}" class="photo-example">
                <span class="sample-badge">ตัวอย่าง</span>
              `}
            </div>
            <strong>${a} ${state.photos[i] && !state.failedPhotos.includes(photoKeys[i]) ? '<span class="check-mark-text">✓</span>' : ''}</strong>
            <label for="photo${i}">
              ${state.photos[i] ? 'เปลี่ยนภาพ' : 'เลือกภาพ'}
              <input id="photo${i}" type="file" accept="image/jpeg,image/png,image/webp" data-photo="${i}">
            </label>
            ${state.photos[i] ? `<button type="button" class="remove-photo-btn" data-remove="${i}">นำภาพออก</button>` : ''}
          </div>
        `).join('')}
      </div>
      <p class="privacy">รองรับ JPG, PNG, WebP · ภาพขนาดใหญ่จะถูกย่อให้อัตโนมัติ<br>ภาพยังอยู่ในเครื่องของคุณจนกว่าจะกดยืนยันส่งในขั้นตอนถัดไป</p>
      <button type="button" class="text-button" data-help="photo">ดูวิธีถ่ายภาพทั้ง 4 มุม ↗</button>
      <p class="error" id="error" role="alert">${state.failedPhotos.length
        ? `ระบบตรวจจับร่างกายในภาพ${state.failedPhotos.map(k => angles[photoKeys.indexOf(k)]).join(', ')}ไม่ได้ — กรุณาถ่ายใหม่ให้เห็นศีรษะถึงปลายเท้า พื้นหลังเรียบ แสงพอ`
        : ''}</p>
      <div class="actions">
        <button type="button" class="secondary" data-step="0">ย้อนกลับ</button>
        <button type="button" class="primary" id="photos-next">ถัดไป: ตรวจสอบข้อมูล →</button>
      </div>
    `;
  } else if (state.step === 2) {
    body = `
      <h2 tabindex="-1">ตรวจสอบอีกครั้ง</h2>
      <p class="sub">ตรวจข้อมูลให้ถูกต้องก่อนส่งประเมิน</p>
      <div class="review">
        <div><span>ประเภทสูท</span><strong>${state.gender === 'male' ? 'สูทผู้ชาย' : 'สูทผู้หญิง'}</strong></div>
        ${Object.entries(state.values).filter(([k, v]) => v && (state.gender === 'female' || !['chest', 'hip'].includes(k))).map(([k, v]) => `
          <div><span>${({ height: 'ส่วนสูง', weight: 'น้ำหนัก', waist: 'รอบเอวกางเกง', chest: 'รอบอก', hip: 'รอบสะโพก' })[k]}</span><strong>${escapeText(v)} ${k === 'height' ? 'cm' : k === 'weight' ? 'kg' : 'นิ้ว'}</strong></div>
        `).join('')}
      </div>
      <button type="button" class="text-button" data-step="0">แก้ไขข้อมูล ↗</button>
      
      <div class="mini-photos-wrap">
        <span class="mini-photos-title">ภาพถ่าย 4 มุม:</span>
        <div class="mini-photos">
          ${state.photos.map((p, i) => `
            <div class="mini-photo-item">
              <img src="${p?.url || ''}" alt="${angles[i]}">
              <small>${angles[i]}</small>
            </div>
          `).join('')}
        </div>
      </div>
      
      <button type="button" class="text-button" data-step="1">แก้ไขภาพถ่าย ↗</button>

      <label class="consent">
        <input type="checkbox" id="consent" ${state.consent ? 'checked' : ''}>
        <span>ข้าพเจ้ายินยอมให้ส่งข้อมูลสัดส่วนและภาพถ่ายทั้ง 4 มุมไปประมวลผลด้วยระบบ AI
        และให้ทีมงาน SUITCUBE ตรวจสอบเพื่อแนะนำขนาดที่เหมาะสม
        <button type="button" class="inline-link" data-help="privacy">อ่านรายละเอียด</button></span>
      </label>

      <p class="error" id="error" role="alert"></p>
      <div class="actions">
        <button type="button" class="secondary" data-step="1">ย้อนกลับ</button>
        <button type="button" class="primary" id="result" ${state.consent ? '' : 'disabled'}>ส่งประเมินด้วย AI →</button>
      </div>
    `;
  } else {
    const r = state.result || {};
    const m = r.measurements || {};
    const fmt = n => (typeof n === 'number' ? n.toFixed(2) : '–');
    // API ส่ง "sz46" — หน้าผลแสดงแค่ตัวเลขตามแบบ
    const sizeNum = s => escapeText(String(s || '–').replace(/^sz/i, ''));
    const alts = (r.jacket_size_alternatives || []).map(sizeNum).join(', ');
    const lengthName = { S: 'Short', R: 'Regular', L: 'Long' }[r.jacket_length] || '';
    const warnings = r.warnings || [];
    const confirmWaist = r.action_required === 'CONFIRM_WAIST';
    const measures = [
      ['ไหล่', m.shoulder], ['อก', m.chest], ['เอว', m.waist], ['สะโพก', m.hip],
      ['ต้นแขน', m.upper_arm], ['ยาวแขน', m.arm_length], ['ยาวหน้า', m.front_length], ['ยาวหลัง', m.back_length]
    ];
    const info = [
      [ICON.user, state.gender === 'male' ? 'ชาย' : 'หญิง'],
      [ICON.ruler, `${escapeText(state.values.height)} ซม.`],
      [ICON.scale, `${escapeText(state.values.weight)} กก.`],
      [ICON.tape, `เอวกางเกง ${escapeText(state.values.waist)} นิ้ว`],
      ...(state.gender === 'female' && state.values.chest ? [[ICON.tape, `รอบอก ${escapeText(state.values.chest)} นิ้ว`]] : []),
      ...(state.gender === 'female' && state.values.hip ? [[ICON.tape, `รอบสะโพก ${escapeText(state.values.hip)} นิ้ว`]] : []),
      ...(typeof r.bmi === 'number' ? [[ICON.pulse, `BMI ${r.bmi}`]] : [])
    ];
    body = `
      <ol class="result-stepper" aria-label="ขั้นตอน">
        ${labels.map((l, i) => `
          <li class="${i < 3 ? 'done' : 'current'}"><b>${i < 3 ? '✓' : i + 1}</b><span>${i + 1}. ${l}</span></li>
        `).join('')}
      </ol>

      <img src="images/suitcube-ai-logo.png" alt="SUITCUBE AI" class="print-only print-logo">
      <div class="result-title">
        <h2 tabindex="-1">ผลประเมินขนาดของคุณ</h2>
        <p class="sub">สรุปไซส์แนะนำและสัดส่วนเบื้องต้นของคุณ</p>
      </div>

      <div class="result-layout">
        <div class="result-side">
          <section class="size-card" aria-label="ไซส์แนะนำ">
            <span class="size-label">ไซส์แนะนำสำหรับคุณ</span>
            <div class="size-main">
              <span class="size-num">${sizeNum(r.jacket_size)}</span>
              <span class="size-len"><b>${escapeText(r.jacket_length || '')}</b>${lengthName ? `<small>${lengthName}</small>` : ''}</span>
              <span class="result-badge">แนะนำ</span>
            </div>
            ${alts ? `<div class="size-alt">ไซส์ทางเลือก <b>${alts}</b></div>` : ''}
            ${ICON.jacket}
          </section>

          <section class="soft-card">
            <div class="card-head">
              <h3>ข้อมูลของคุณ</h3>
              <button type="button" class="edit-link" data-step="0">${ICON.pencil}แก้ไขข้อมูล</button>
            </div>
            <ul class="info-list">
              ${info.map(([icon, text]) => `<li>${icon}<span>${text}</span></li>`).join('')}
            </ul>
          </section>
        </div>

        <section class="soft-card measure-card">
          <div class="card-head">
            <h3>${ICON.tape}สัดส่วนประเมิน</h3>
            <span class="unit-pill">หน่วย: นิ้ว</span>
          </div>
          <div class="measure-grid">
            ${measures.map(([label, v]) => `<div class="measure-item"><span>${label}</span><strong>${fmt(v)}″</strong></div>`).join('')}
          </div>
          ${confirmWaist ? `<p class="result-alert">รอบเอวที่กรอกดูไม่สอดคล้องกับน้ำหนักและส่วนสูง กรุณาตรวจสอบรอบเอวกางเกงอีกครั้ง หรือให้ทีมงานยืนยันก่อนสั่งตัด</p>` : ''}
          ${warnings.length ? `
            <ul class="result-notes">
              ${warnings.map(w => `<li>${escapeText(w)}</li>`).join('')}
            </ul>
          ` : ''}
          <p class="result-note">${ICON.info}ไซส์แนะนำเบื้องต้น ทีมงานจะตรวจสอบอีกครั้งก่อนยืนยันการสั่งตัด</p>
          <div class="result-actions">
            <button type="button" class="primary" id="print">${ICON.printer}บันทึกผล / พิมพ์</button>
            <button type="button" class="secondary" data-help="stylist">${ICON.chat}ปรึกษาเรา</button>
            <button type="button" class="text-button" id="reset">เริ่มใหม่</button>
          </div>
        </section>
      </div>
    `;
  }

  surface.innerHTML = body;
  bind();
}

function bind() {
  document.querySelector('#basics')?.addEventListener('input', e => {
    if (e.target.name) {
      state.values[e.target.name] = e.target.value;
      state.max = 0;
      state.result = null;
    }
  });

  document.querySelector('#consent')?.addEventListener('change', e => {
    state.consent = e.target.checked;
    const btn = document.querySelector('#result');
    if (btn) btn.disabled = !state.consent;
  });

  document.querySelector('#basics')?.addEventListener('submit', e => {
    e.preventDefault();
    go(1);
  });

  document.querySelectorAll('[data-photo]').forEach(el => {
    el.addEventListener('change', () => loadPhoto(Number(el.dataset.photo), el.files[0]));
  });

  document.querySelector('#photos-next')?.addEventListener('click', () => {
    if (state.photos.some(p => !p)) return error('กรุณาเลือกภาพให้ครบทั้ง 4 มุมก่อนดำเนินการต่อ');
    go(2);
  });

  document.querySelector('#result')?.addEventListener('click', submitPrediction);

  document.querySelector('#print')?.addEventListener('click', () => window.print());
  document.querySelector('#reset')?.addEventListener('click', () => showHelp('reset'));
}

function error(t) {
  const el = document.querySelector('#error');
  if (el) el.textContent = t;
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
  if (state.photos.some(p => !p?.file)) return error('กรุณาเลือกภาพให้ครบทั้ง 4 มุม');

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
  surface.innerHTML = '<div class="loading" role="status"><div class="spinner"></div><h2>กำลังประมวลผลขนาดของคุณ</h2><p class="sub">วิเคราะห์สัดส่วนและภาพถ่ายด้วยระบบ AI อาจใช้เวลาสักครู่</p></div>';

  let res, body;
  try {
    const signal = AbortSignal.timeout ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined;
    res = await fetch(`${API_BASE}/predict/suit/from-photos`, { method: 'POST', body: fd, signal });
    body = await res.json().catch(() => ({}));
  } catch (e) {
    state.busy = false;
    go(2);
    return error(e?.name === 'TimeoutError' || e?.name === 'AbortError'
      ? 'ระบบใช้เวลานานเกินไป กรุณาลองใหม่อีกครั้ง'
      : 'เชื่อมต่อระบบประเมินไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
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
  const msg = apiMessage(body?.detail);
  if (res.status === 413) return error(msg || 'ไฟล์ภาพใหญ่เกินไป กรุณาเลือกภาพที่เล็กลง');
  if (res.status === 503 || res.status === 429) return error('ขณะนี้มีผู้ใช้งานจำนวนมาก กรุณารอสักครู่แล้วลองใหม่');
  if (res.status === 504) return error('ระบบใช้เวลานานเกินไป กรุณาลองใหม่อีกครั้ง');
  if (res.status === 400 || res.status === 415 || res.status === 422) return error(msg || 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง');
  return error('ระบบประเมินยังไม่พร้อมใช้งาน กรุณาลองใหม่ภายหลัง');
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
    return error('เลือกไฟล์ JPG, PNG หรือ WebP');
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
    return error('เปิดภาพนี้ไม่ได้ กรุณาลองเลือกภาพอื่น');
  }
  let upload;
  try {
    upload = await fitForUpload(file, img);
  } catch {
    URL.revokeObjectURL(url);
    return error('ภาพนี้ใหญ่เกินไป กรุณาเลือกภาพอื่น');
  }
  if (state.photos[i]?.url) URL.revokeObjectURL(state.photos[i].url);
  state.photos[i] = { url, file: upload };
  state.failedPhotos = state.failedPhotos.filter(k => k !== photoKeys[i]);
  state.result = null;
  state.max = 1;
  render();
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
  document.querySelector('#dialog').close();
}

const help = {
  how: [
    'วิธีใช้งาน SUITCUBE AI',
    '<ol><li>กรอกข้อมูลสัดส่วนเบื้องต้น (ส่วนสูง, น้ำหนัก, รอบเอวกางเกง)</li><li>เตรียมภาพถ่ายเต็มตัวทั้ง 4 มุม (หน้า, หลัง, ซ้าย, ขวา) ตามคำแนะนำ</li><li>ตรวจสอบข้อมูล แล้วกดยืนยันส่งประเมิน</li><li>รับผลขนาดเสื้อสูทที่แนะนำ ทีมงาน SUITCUBE จะตรวจสอบอีกครั้งก่อนสั่งตัด</li></ol>'
  ],
  photo: [
    'เตรียมภาพถ่ายอย่างไร',
    `
      <div class="modal-photo-strip">
        <div class="modal-photo-item"><img src="images/photo-sample-front.jpg" alt="ด้านหน้า"><small>ด้านหน้า</small></div>
        <div class="modal-photo-item"><img src="images/photo-sample-back.jpg" alt="ด้านหลัง"><small>ด้านหลัง</small></div>
        <div class="modal-photo-item"><img src="images/photo-sample-left.jpg" alt="ด้านซ้าย"><small>ด้านซ้าย</small></div>
        <div class="modal-photo-item"><img src="images/photo-sample-right.jpg" alt="ด้านขวา"><small>ด้านขวา</small></div>
      </div>
      <ol>
        <li>สวมเสื้อยืดและกางเกงที่พอดีตัว ไม่สวมเสื้อคลุมหรือเสื้อผ้าหลวม</li>
        <li>ยืนตรง มองตรง แขนแยกจากลำตัวเล็กน้อย เห็นตั้งแต่ศีรษะถึงปลายเท้า</li>
        <li>ตั้งระดับกล้องตรง พื้นหลังเรียบ และมีแสงสว่างสม่ำเสมอ</li>
        <li>ถ่ายให้ครบทั้ง 4 ด้าน: หน้า, หลัง, ซ้าย และขวา</li>
      </ol>
    `
  ],
  waist: [
    'วิธีดูรอบเอวกางเกง',
    `
      <p>ให้ใช้รอบเอวกางเกงที่คุณใส่ในชีวิตประจำวันจริงเป็นหน่วย <strong>นิ้ว</strong> (เช่น 32 นิ้ว)</p>
      <p><em>ข้อควรระวัง:</em> ให้ใช้ขนาดรอบเอวจริงของกางเกง ไม่ใช่รอบเอวของเสื้อสูท และไม่ใช่รหัสไซซ์ S/M/L ของแต่ละแบรนด์</p>
    `
  ],
  privacy: [
    'ข้อมูลและความเป็นส่วนตัว',
    `<p><strong>ข้อมูลที่เก็บ:</strong> เพศ ส่วนสูง น้ำหนัก รอบเอวกางเกง (และรอบอก รอบสะโพกสำหรับสูทผู้หญิง) พร้อมภาพถ่ายเต็มตัว 4 มุม</p>
     <p><strong>ใช้เพื่อ:</strong> ประเมินขนาดเสื้อสูทด้วยระบบ AI และให้ทีมงาน SUITCUBE ตรวจสอบความถูกต้องก่อนแนะนำหรือสั่งตัด</p>
     <p><strong>เมื่อไหร่ถูกส่ง:</strong> ข้อมูลและภาพอยู่บนเครื่องของคุณจนกว่าจะติ๊กยินยอมและกดส่งประเมินในขั้นตอนตรวจสอบ</p>
     <p>หากต้องการสอบถามหรือขอให้ลบข้อมูล ติดต่อทีมงานผ่าน <a href="https://www.suitcube.com/" target="_blank" rel="noopener">เว็บไซต์ SUITCUBE ↗</a></p>`
  ],
  stylist: [
    'ปรึกษาสไตลิสต์ SUITCUBE',
    '<p>หากคุณต้องการคำแนะนำเรื่องการเลือกทรงสูท สีผ้า หรือต้องการจองคิววัดตัวจริงที่สาขา สามารถติดต่อทีมสไตลิสต์ผู้เชี่ยวชาญของ SUITCUBE ได้โดยตรง</p><p><a href="https://www.suitcube.com/" target="_blank" rel="noopener">ไปยังเว็บไซต์ทางการ SUITCUBE ↗</a></p>'
  ],
  reset: [
    'เริ่มใหม่ทั้งหมด?',
    '<p>ข้อมูลสัดส่วนและภาพถ่ายทั้งหมดที่อยู่ในหน้านี้จะถูกรีเซ็ตล้างค่ากลับเป็นค่าเริ่มต้น</p><button type="button" class="secondary" id="confirm-reset">ล้างข้อมูลและเริ่มใหม่</button>'
  ]
};

function showHelp(key) {
  const h = help[key];
  if (!h) return;
  document.querySelector('#dialog-content').innerHTML = `<h2>${h[0]}</h2>${h[1]}`;
  document.querySelector('#dialog').showModal();
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
  const gender = e.target.closest('[data-gender]');
  if (gender) {
    state.gender = gender.dataset.gender;
    state.max = 0;
    render();
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
  }
});

// Setup Mobile Accordion Toggle
const accToggle = document.querySelector('#guide-accordion-toggle');
if (accToggle) {
  accToggle.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); accToggle.click(); }
  });
  accToggle.addEventListener('click', () => {
    const col = document.querySelector('#guide-column');
    const isExp = col.classList.toggle('accordion-open');
    accToggle.setAttribute('aria-expanded', isExp);
  });
}

// Mobile Stepper Dot Clicks
document.querySelectorAll('.mob-dot').forEach(dot => {
  dot.addEventListener('click', () => {
    const s = Number(dot.dataset.step);
    if (s <= state.max) go(s);
  });
});

document.querySelector('#close-dialog')?.addEventListener('click', () => document.querySelector('#dialog').close());

// Initial Render
render();

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
