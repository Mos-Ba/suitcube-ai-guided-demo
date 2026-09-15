const labels = ['ข้อมูลเบื้องต้น', 'ภาพถ่าย', 'ตรวจสอบ', 'ผลประเมิน'];
const angles = ['ด้านหน้า', 'ด้านหลัง', 'ด้านซ้าย', 'ด้านขวา'];
const samplePhotoUrls = [
  'images/photo-sample-front.jpg',
  'images/photo-sample-back.jpg',
  'images/photo-sample-left.jpg',
  'images/photo-sample-right.jpg'
];

const state = {
  step: 0,
  max: 0,
  gender: 'male',
  values: { height: '', weight: '', waist: '', hip: '', chest: '' },
  photos: [null, null, null, null],
  sample: false,
  consent: false,
  busy: false
};

const surface = document.querySelector('#surface');
const escapeText = v => String(v).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const roundQuarter = n => Math.round(n * 4) / 4;

// Demo-only estimate formula: approximates the shape of the real business_rules
// output (suitcube-ml) closely enough for a UX demo, but is NOT the real model
// and does not use the uploaded photos.
function computeDemoResult(state) {
  const height = parseFloat(state.values.height) || 170;
  const weight = parseFloat(state.values.weight) || 65;
  const waistPants = parseFloat(state.values.waist) || 32;
  const isFemale = state.gender === 'female';
  const heightM = height / 100;
  const bmi = weight / (heightM * heightM);

  const chest = isFemale
    ? roundQuarter(parseFloat(state.values.chest) || waistPants * 1.2)
    : roundQuarter(waistPants * 1.14);
  const waist = roundQuarter(waistPants);
  const hip = isFemale
    ? roundQuarter(parseFloat(state.values.hip) || chest + 1.5)
    : roundQuarter(chest - 1);
  const shoulder = roundQuarter(17 + (chest - 38) * 0.05 + (isFemale ? 0.75 : 0));
  const upperArm = roundQuarter(chest * 0.316);
  const armLength = roundQuarter(22 + Math.max(0, height - 165) / 18);
  const frontLength = roundQuarter(26 + Math.max(0, height - 165) / 6);
  const backLength = roundQuarter(frontLength - 0.5);

  const sizeNum = Math.floor(((chest * 2.54) / 2) / 2) * 2;
  const jacketLength = height < 170 ? 'S' : height > 184 ? 'L' : 'R';

  return {
    bmi: Math.round(bmi * 10) / 10,
    sizeNum,
    jacketLength,
    alternatives: [sizeNum - 2, sizeNum + 2],
    measurements: { shoulder, chest, waist, hip, upperArm, armLength, frontLength, backLength }
  };
}

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
  // 0. Show the preparation guide panel only on step 1
  document.querySelector('#workspace-body')?.classList.toggle('no-guide', state.step !== 0);

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
      <p class="form-foot">ข้อมูลอยู่ในหน้านี้เท่านั้น ไม่ต้องสมัครสมาชิก</p>
    `;
  } else if (state.step === 1) {
    body = `
      <h2 tabindex="-1">ภาพถ่ายของคุณ</h2>
      <p class="sub">เตรียมภาพเต็มตัวทั้ง 4 มุม (เห็นศีรษะถึงปลายเท้า)</p>
      <div class="photos">
        ${angles.map((a, i) => `
          <div class="photo-card">
            <div class="photo-preview ${state.photos[i] ? 'has-image' : ''}">
              ${state.photos[i] ? `
                <img src="${state.photos[i].url}" alt="ภาพ${a}">
                ${state.photos[i].sample ? '<span class="sample-badge">ภาพตัวอย่าง</span>' : ''}
              ` : `
                <div class="photo-placeholder">
                  <span class="ph-icon">▣</span>
                  <small>มุม${a}</small>
                </div>
              `}
            </div>
            <strong>${a} ${state.photos[i] ? '<span class="check-mark-text">✓</span>' : ''}</strong>
            <label for="photo${i}">
              ${state.photos[i] ? 'เปลี่ยนภาพ' : 'เลือกภาพ'}
              <input id="photo${i}" type="file" accept="image/jpeg,image/png,image/webp" data-photo="${i}">
            </label>
            ${state.photos[i] ? `<button type="button" class="remove-photo-btn" data-remove="${i}">นำภาพออก</button>` : ''}
          </div>
        `).join('')}
      </div>
      <p class="privacy">รองรับ JPG, PNG, WebP ไม่เกิน 10 MB ต่อภาพ<br>เดโมนี้แสดงภาพบนอุปกรณ์ของคุณ ไม่ส่งภาพไปยังเซิร์ฟเวอร์ และไม่ตรวจวิเคราะห์รูปร่าง</p>
      <button type="button" class="text-button" data-help="photo">ดูตัวอย่างภาพถ่ายทั้ง 4 มุม ↗</button>
      <p class="error" id="error" role="alert"></p>
      <div class="actions">
        <button type="button" class="secondary" data-step="0">ย้อนกลับ</button>
        <button type="button" class="primary" id="photos-next">ถัดไป: ตรวจสอบข้อมูล →</button>
      </div>
    `;
  } else if (state.step === 2) {
    body = `
      <h2 tabindex="-1">ตรวจสอบอีกครั้ง</h2>
      <p class="sub">ข้อมูลถูกต้องแล้ว พร้อมดูผลตัวอย่าง</p>
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
              <img src="${p?.url || samplePhotoUrls[i]}" alt="${angles[i]}">
              <small>${angles[i]}</small>
            </div>
          `).join('')}
        </div>
      </div>
      
      <button type="button" class="text-button" data-step="1">แก้ไขภาพถ่าย ↗</button>
      <label class="check">
        <input type="checkbox" id="confirm" ${state.consent ? 'checked' : ''}>
        <span>ฉันเข้าใจว่าผลลัพธ์ในเดโมเป็นข้อมูลตัวอย่าง ไม่ใช่ขนาดสำหรับสั่งตัดจริง</span>
      </label>
      <p class="error" id="error" role="alert"></p>
      <div class="actions">
        <button type="button" class="secondary" data-step="1">ย้อนกลับ</button>
        <button type="button" class="primary" id="result">ดูผลประเมินตัวอย่าง →</button>
      </div>
    `;
  } else {
    const r = computeDemoResult(state);
    const m = r.measurements;
    const fmt = n => n.toFixed(2);
    body = `
      <div class="success-mark">✓</div>
      <h2 tabindex="-1">สรุปผลตัวอย่างของคุณ</h2>
      <p class="sub">ครบทุกขั้นตอนแล้ว นี่คือตัวอย่างหน้าผลลัพธ์</p>

      <div class="result-card">
        <div class="result-header">
          <div class="result-header-text">
            <div class="result-logo" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M12 2L3 7.2v9.6L12 22l9-5.2V7.2L12 2z" stroke="#C3933E" stroke-width="2" stroke-linejoin="round"/><path d="M12 2v20M3 7.2l9 5M21 7.2l-9 5" stroke="#C3933E" stroke-width="1.6"/></svg>
              <span>SUITCUBE</span>
            </div>
            <small>ไซส์แนะนำสำหรับคุณ</small>
            <div class="result-size-big">sz${r.sizeNum} <span class="result-length">(${r.jacketLength})</span></div>
            <small class="result-alt">ทางเลือก: sz${r.alternatives[0]}, sz${r.alternatives[1]}</small>
          </div>
          <span class="result-badge">แนะนำ</span>
        </div>
        <div class="result-body">
          <p class="result-profile-line">
            ${state.gender === 'male' ? 'ชาย' : 'หญิง'} · ${escapeText(state.values.weight)} กก. · ${escapeText(state.values.height)} ซม. ·
            เอวกางเกง ${escapeText(state.values.waist)}" · เอวสูท ${fmt(m.waist)}" · BMI ${r.bmi}
          </p>
          <div class="measure-grid">
            <div class="measure-item"><span>ไหล่</span><strong>${fmt(m.shoulder)}<small>"</small></strong></div>
            <div class="measure-item"><span>อก</span><strong>${fmt(m.chest)}<small>"</small></strong></div>
            <div class="measure-item"><span>เอว</span><strong>${fmt(m.waist)}<small>"</small></strong></div>
            <div class="measure-item"><span>สะโพก</span><strong>${fmt(m.hip)}<small>"</small></strong></div>
            <div class="measure-item"><span>ต้นแขน</span><strong>${fmt(m.upperArm)}<small>"</small></strong></div>
            <div class="measure-item"><span>ยาวแขน</span><strong>${fmt(m.armLength)}<small>"</small></strong></div>
            <div class="measure-item"><span>ยาวหน้า</span><strong>${fmt(m.frontLength)}<small>"</small></strong></div>
            <div class="measure-item"><span>ยาวหลัง</span><strong>${fmt(m.backLength)}<small>"</small></strong></div>
          </div>
          <p class="result-warning">คำนวณจากสูตรประมาณการสำหรับสาธิตเท่านั้น ไม่ใช่ผลจาก AI หรือภาพถ่ายจริง และไม่ควรใช้สั่งตัด</p>
        </div>
      </div>

      <p class="privacy">ในการใช้งานจริง ผลประเมินและขั้นตอนสั่งซื้อจะเชื่อมกับระบบของ SUITCUBE</p>
      <div class="actions">
        <button type="button" class="secondary" data-step="2">แก้ไขข้อมูล</button>
        <button type="button" class="primary" id="print">พิมพ์สรุปเดโม</button>
      </div>
      <button type="button" class="text-button" id="reset">เริ่มใหม่ทั้งหมด ↗</button>
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
      state.consent = false;
    }
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

  document.querySelector('#confirm')?.addEventListener('change', e => {
    state.consent = e.target.checked;
  });

  document.querySelector('#result')?.addEventListener('click', () => {
    if (!state.consent) return error('กรุณายืนยันว่าคุณเข้าใจการใช้ข้อมูลตัวอย่าง');
    state.busy = true;
    surface.innerHTML = '<div class="loading" role="status"><div class="spinner"></div><h2>กำลังประมวลผลขนาดของคุณ</h2><p class="sub">วิเคราะห์สัดส่วนและภาพถ่ายด้วยระบบ AI</p></div>';
    setTimeout(() => {
      state.busy = false;
      go(3);
    }, 1000);
  });

  document.querySelector('#print')?.addEventListener('click', () => window.print());
  document.querySelector('#reset')?.addEventListener('click', () => showHelp('reset'));
}

function error(t) {
  const el = document.querySelector('#error');
  if (el) el.textContent = t;
}

async function loadPhoto(i, file) {
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
    return error('เลือกไฟล์ JPG, PNG หรือ WebP ขนาดไม่เกิน 10 MB');
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  try {
    await new Promise((ok, no) => {
      img.onload = ok;
      img.onerror = no;
      img.src = url;
    });
    if (state.photos[i]?.url && !state.photos[i]?.sample) URL.revokeObjectURL(state.photos[i].url);
    state.photos[i] = { url, sample: false };
    state.max = 1;
    state.consent = false;
    render();
  } catch {
    URL.revokeObjectURL(url);
    error('เปิดภาพนี้ไม่ได้ กรุณาลองเลือกภาพอื่น');
  }
}

function sample() {
  if (state.busy) return;
  state.values = { height: '175', weight: '70', waist: '32', hip: '', chest: '' };
  state.gender = 'male';
  state.photos.forEach(p => { if (p?.url && !p?.sample) URL.revokeObjectURL(p.url); });
  // Load real sample images from suitcube-ml
  state.photos = samplePhotoUrls.map((url, i) => ({
    url: url,
    sample: true,
    angle: angles[i]
  }));
  state.sample = true;
  state.consent = false;
  state.max = 1;
  go(0);
}

function reset() {
  state.photos.forEach(p => { if (p?.url && !p?.sample) URL.revokeObjectURL(p.url); });
  Object.assign(state, {
    step: 0,
    max: 0,
    gender: 'male',
    values: { height: '', weight: '', waist: '', hip: '', chest: '' },
    photos: [null, null, null, null],
    sample: false,
    consent: false,
    busy: false
  });
  render();
  document.querySelector('#dialog').close();
}

const help = {
  how: [
    'วิธีใช้งาน SUITCUBE AI',
    '<ol><li>กรอกข้อมูลสัดส่วนเบื้องต้น (ส่วนสูง, น้ำหนัก, รอบเอวกางเกง)</li><li>เตรียมภาพถ่ายเต็มตัวทั้ง 4 มุม (หน้า, หลัง, ซ้าย, ขวา) ตามคำแนะนำ</li><li>ตรวจสอบข้อมูลและยืนยันเพื่อดูผลการประเมิน</li><li>รับผลสรุปขนาดเสื้อสูทตัวอย่าง พร้อมปรึกษาสไตลิสต์เพิ่มเติม</li></ol><p>สามารถกด <strong>“ลองด้วยข้อมูลตัวอย่าง”</strong> เพื่อทดสอบโฟลว์ระบบได้ทันที</p>'
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
      <p>เดโมนี้ทำงานบนอุปกรณ์ของคุณ ไม่มีการอัปโหลดภาพขึ้นระบบเซิร์ฟเวอร์</p>
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
    '<p>ข้อมูลและภาพถ่ายที่คุณระบุในหน้าเดโมนี้จะถูกเก็บไว้ในหน่วยความจำของเบราว์เซอร์บนเครื่องคุณเท่านั้น ไม่มีการส่งรูปหรือบันทึกข้อมูลส่วนบุคคลขึ้นเซิร์ฟเวอร์</p><p>ผลประเมินขนาดเป็นชุดข้อมูลสาธิตสำหรับทดสอบประสบการณ์การใช้งาน (UX/UI Demo)</p>'
  ],
  stylist: [
    'ปรึกษาสไตลิสต์ SUITCUBE',
    '<p>หากคุณต้องการคำแนะนำเรื่องการเลือกทรงสูท สีผ้า หรือต้องการจองคิววัดตัวจริงที่สาขา สามารถติดต่อทีมสไตลิสต์ผู้เชี่ยวชาญของ SUITCUBE ได้โดยตรง</p><p><a href="https://www.suitcube.com/" target="_blank" rel="noopener">ไปยังเว็บไซต์ทางการ SUITCUBE ↗</a></p>'
  ],
  login: [
    'เข้าสู่ระบบสมาชิก SUITCUBE',
    '<p>หากคุณเคยมีประวัติการวัดตัวหรือเคยตัดสูทกับทาง SUITCUBE มาก่อน สามารถเข้าสู่ระบบเพื่อดึงข้อมูลสัดส่วนเดิมมาใช้เทียบเคียงขนาดได้ทันที</p><p><em>(ฟังก์ชันนี้เป็นส่วนหนึ่งของการสาธิต UX Demo ในระบบจริงจะเชื่อมต่อกับบัญชีสมาชิก)</em></p>'
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
    state.consent = false;
    render();
  }

  // Help Modal Dialogs
  const h = e.target.closest('[data-help]');
  if (h) showHelp(h.dataset.help);

  // Photo Removal
  const remove = e.target.closest('[data-remove]');
  if (remove) {
    const i = Number(remove.dataset.remove);
    if (state.photos[i]?.url && !state.photos[i]?.sample) URL.revokeObjectURL(state.photos[i].url);
    state.photos[i] = null;
    state.max = 1;
    state.consent = false;
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

document.querySelector('#sample')?.addEventListener('click', sample);
document.querySelector('#close-dialog')?.addEventListener('click', () => document.querySelector('#dialog').close());

// Initial Render
render();

// Model Context Tools for Assistant Integration
if (document.modelContext?.registerTool) {
  for (const tool of [
    {
      name: 'read_fitting_demo_step',
      description: 'Read current demo step and image count, without returning personal measurements or images.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute(input) {
        if (!input || Object.keys(input).length) throw Error('Expected empty input');
        return { step: state.step + 1, label: labels[state.step], photoCount: state.photos.filter(Boolean).length, isDemo: true };
      }
    },
    {
      name: 'load_fitting_demo_sample',
      description: 'Replace current form and photos with explicit sample demo data, then show the first step.',
      inputSchema: { type: 'object', properties: { confirmReplace: { type: 'boolean' } }, required: ['confirmReplace'], additionalProperties: false },
      annotations: { readOnlyHint: false },
      execute(input) {
        if (input?.confirmReplace !== true || Object.keys(input).length !== 1) throw Error('confirmReplace must be true');
        if (state.busy) throw Error('Please wait for current step');
        sample();
        return { step: 1, sampleLoaded: true };
      }
    }
  ]) {
    try { Promise.resolve(document.modelContext.registerTool(tool)).catch(() => {}); } catch {}
  }
}
