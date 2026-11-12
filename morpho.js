/**
 * GIULIA BEAUTY STUDIO — Morphological Body Map (Front/Back, Female/Male),
 * Anthropometric Measurements & Progress Photo Compressor
 */
(function () {
  function detectBodyZone(xPct, yPct, side) {
    if (yPct < 15) return side === 'front' ? 'Viso / Testa' : 'Nuca / Testa';
    if (yPct < 24) return side === 'front' ? 'Collo / Décolleté' : 'Spalle / Trapezio';
    if (xPct < 30 || xPct > 70) {
      if (yPct < 52) return xPct < 50 ? 'Braccio Sinistro' : 'Braccio Destro';
    }
    if (yPct < 38) return side === 'front' ? 'Seno / Torace' : 'Dorso / Schiena Alta';
    if (yPct < 50) return side === 'front' ? 'Addome / Vita' : 'Zona Lombare / Fianchi';
    if (yPct < 60) return side === 'front' ? 'Fianchi / Basso Ventre' : 'Glutei';
    if (yPct < 77) return xPct < 50 ? 'Coscia Sinistra' : 'Coscia Destra';
    return xPct < 50 ? 'Polpaccio / Caviglia Sx' : 'Polpaccio / Caviglia Dx';
  }

  function buildBodySvgMarkup(gender, side, pins) {
    const isMale = gender === 'male';
    const shoulderW = isMale ? 48 : 38;
    const waistW = isMale ? 32 : 24;
    const hipW = isMale ? 34 : 40;

    const torsoPath = `
      M 110,20
      C 97,20 92,31 92,43
      C 92,55 98,63 102,66
      L 101,75
      L ${110 - shoulderW},84
      L ${110 - shoulderW - 14},188
      L ${110 - shoulderW - 2},192
      L ${110 - waistW - 8},125
      L ${110 - waistW},168
      C ${110 - hipW},198 ${110 - hipW},215 ${110 - hipW + 4},236
      L ${110 - 28},390
      L ${110 - 12},390
      L ${110 - 5},252
      L 110,252
      L ${110 + 5},252
      L ${110 + 12},390
      L ${110 + 28},390
      L ${110 + hipW - 4},236
      C ${110 + hipW},215 ${110 + hipW},198 ${110 + waistW},168
      L ${110 + waistW + 8},125
      L ${110 + shoulderW + 2},192
      L ${110 + shoulderW + 14},188
      L ${110 + shoulderW},84
      L 119,75
      L 118,66
      C 122,63 128,55 128,43
      C 128,31 123,20 110,20 Z
    `;

    const guideLines =
      side === 'front'
        ? `<line x1="82" y1="120" x2="138" y2="120" stroke="#e4c7d1" stroke-dasharray="3 3" />
           <line x1="${110 - waistW}" y1="168" x2="${110 + waistW}" y2="168" stroke="#e4c7d1" stroke-dasharray="3 3" />
           <line x1="${110 - hipW + 3}" y1="220" x2="${110 + hipW - 3}" y2="220" stroke="#e4c7d1" stroke-dasharray="3 3" />`
        : `<line x1="110" y1="78" x2="110" y2="238" stroke="#e4c7d1" stroke-dasharray="3 3" />
           <path d="M ${110 - hipW + 6},212 Q 110,226 ${110 + hipW - 6},212" fill="none" stroke="#e4c7d1" stroke-width="1.2" />`;

    const pinsHtml = pins
      .filter((p) => p.side === side)
      .map((p, i) => {
        const cx = (p.x / 100) * 220;
        const cy = (p.y / 100) * 410;
        return `<g class="morpho-svg-pin" transform="translate(${cx.toFixed(1)}, ${cy.toFixed(1)})">
          <circle r="10" fill="#b85675" stroke="#fff" stroke-width="2"></circle>
          <text text-anchor="middle" dy="3.5" fill="#fff" font-size="10" font-weight="700">${i + 1}</text>
        </g>`;
      })
      .join('');

    return `
      <svg viewBox="0 0 220 410" class="morpho-body-svg" role="img" aria-label="Mappa corpo ${gender} ${side}">
        <rect x="0" y="0" width="220" height="410" rx="14" fill="#fdf8fa" stroke="#eddde3" />
        <text x="110" y="14" text-anchor="middle" fill="#8b6e78" font-size="9" font-weight="700" letter-spacing="1.5">
          ${gender === 'male' ? 'UOMO' : 'DONNA'} • ${side === 'front' ? 'FRONTE' : 'RETRO'}
        </text>
        <path d="${torsoPath}" fill="#f7e8ee" stroke="#b85675" stroke-width="1.6" stroke-linejoin="round" />
        ${guideLines}
        ${pinsHtml}
      </svg>
    `;
  }

  function compressImageToDataUrl(file, maxDim = 800, quality = 0.78) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Errore lettura file immagine'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Formato immagine non valido'));
        img.onload = () => {
          let w = img.width;
          let h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w >= h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  window.MorphoManager = {
    init(apiFetch, getTodayIso, escapeHtml) {
      const modal = document.getElementById('morphoModal');
      if (!modal) return null;

      const state = {
        clientId: 0,
        clientName: '',
        gender: 'female',
        side: 'front',
        annotations: [],
        photos: [],
        records: [],
      };

      const stageEl = document.getElementById('morphoSvgStage');
      const pinsListEl = document.getElementById('morphoPinsList');
      const photosPreviewEl = document.getElementById('morphoPhotosPreview');
      const historyListEl = document.getElementById('morphoHistoryList');
      const bmiBadgeEl = document.getElementById('morphoBmiBadge');
      const weightEl = document.getElementById('morphoWeightInput');
      const heightEl = document.getElementById('morphoHeightInput');

      function updateBmiPreview() {
        const w = Number(weightEl.value || 0);
        const h = Number(heightEl.value || 0);
        if (w > 0 && h > 0) {
          const bmi = Math.round((w / ((h / 100) ** 2)) * 10) / 10;
          const cat = bmi < 18.5 ? 'Sottopeso' : bmi < 25 ? 'Normopeso' : bmi < 30 ? 'Sovrappeso' : 'Obesità';
          bmiBadgeEl.textContent = `BMI stimato: ${bmi} (${cat})`;
          bmiBadgeEl.hidden = false;
        } else {
          bmiBadgeEl.hidden = true;
        }
      }

      weightEl.addEventListener('input', updateBmiPreview);
      heightEl.addEventListener('input', updateBmiPreview);

      function renderSvgAndPins() {
        stageEl.innerHTML = buildBodySvgMarkup(state.gender, state.side, state.annotations);
        const svg = stageEl.querySelector('svg');
        if (svg) {
          svg.addEventListener('click', (e) => {
            const rect = svg.getBoundingClientRect();
            const xPct = Math.round(((e.clientX - rect.left) / rect.width) * 1000) / 10;
            const yPct = Math.round(((e.clientY - rect.top) / rect.height) * 1000) / 10;
            const zoneDefault = detectBodyZone(xPct, yPct, state.side);
            const note = window.prompt(`Annotazione per "${zoneDefault}" (${state.side === 'front' ? 'Fronte' : 'Retro'}):`, '');
            if (note === null) return;
            state.annotations.push({
              id: Date.now() + Math.random(),
              side: state.side,
              gender: state.gender,
              x: xPct,
              y: yPct,
              zone: zoneDefault,
              note: note.trim() || 'Zona segnalata',
            });
            renderSvgAndPins();
          });
        }

        if (state.annotations.length === 0) {
          pinsListEl.innerHTML = '<p class="muted-text" style="font-size:0.74rem;margin:6px 0 0;">Nessuna zona annotata su questa scheda.</p>';
        } else {
          pinsListEl.innerHTML = state.annotations
            .map(
              (p, idx) => `
              <div class="morpho-pin-row">
                <span><strong>#${idx + 1} [${p.side === 'front' ? 'F' : 'R'}] ${escapeHtml(p.zone)}:</strong> ${escapeHtml(p.note)}</span>
                <button type="button" class="btn-icon-tiny" data-remove-pin="${idx}" title="Rimuovi pin">✕</button>
              </div>`
            )
            .join('');
          pinsListEl.querySelectorAll('[data-remove-pin]').forEach((btn) => {
            btn.addEventListener('click', () => {
              state.annotations.splice(Number(btn.dataset.removePin), 1);
              renderSvgAndPins();
            });
          });
        }
      }

      function renderPhotoPreviews() {
        photosPreviewEl.innerHTML = state.photos
          .map(
            (src, idx) => `
            <div class="morpho-photo-thumb">
              <img src="${src}" alt="Foto ${idx + 1}" />
              <button type="button" data-del-photo="${idx}" title="Rimuovi foto">✕</button>
            </div>`
          )
          .join('');
        photosPreviewEl.querySelectorAll('[data-del-photo]').forEach((btn) => {
          btn.addEventListener('click', () => {
            state.photos.splice(Number(btn.dataset.delPhoto), 1);
            renderPhotoPreviews();
          });
        });
      }

      document.getElementById('morphoPhotosInput').addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []).slice(0, 4 - state.photos.length);
        for (const f of files) {
          try {
            const dataUrl = await compressImageToDataUrl(f);
            state.photos.push(dataUrl);
          } catch (err) {
            alert(err.message);
          }
        }
        e.target.value = '';
        renderPhotoPreviews();
      });

      document.getElementById('morphoGenderFemaleBtn').addEventListener('click', () => {
        state.gender = 'female';
        document.getElementById('morphoGenderFemaleBtn').classList.add('active');
        document.getElementById('morphoGenderMaleBtn').classList.remove('active');
        renderSvgAndPins();
      });
      document.getElementById('morphoGenderMaleBtn').addEventListener('click', () => {
        state.gender = 'male';
        document.getElementById('morphoGenderMaleBtn').classList.add('active');
        document.getElementById('morphoGenderFemaleBtn').classList.remove('active');
        renderSvgAndPins();
      });
      document.getElementById('morphoSideFrontBtn').addEventListener('click', () => {
        state.side = 'front';
        document.getElementById('morphoSideFrontBtn').classList.add('active');
        document.getElementById('morphoSideBackBtn').classList.remove('active');
        renderSvgAndPins();
      });
      document.getElementById('morphoSideBackBtn').addEventListener('click', () => {
        state.side = 'back';
        document.getElementById('morphoSideBackBtn').classList.add('active');
        document.getElementById('morphoSideFrontBtn').classList.remove('active');
        renderSvgAndPins();
      });

      function renderHistory() {
        if (state.records.length === 0) {
          historyListEl.innerHTML = '<p class="muted-text">Nessuna rilevazione morfologica salvata per questa cliente.</p>';
          return;
        }
        historyListEl.innerHTML = state.records
          .map((rec, i) => {
            const prev = state.records[i + 1] || null;
            let meas = {};
            let pins = [];
            let photos = [];
            try { meas = JSON.parse(rec.measurements_json || '{}'); } catch { meas = {}; }
            try { pins = JSON.parse(rec.annotations_json || '[]'); } catch { pins = []; }
            try { photos = JSON.parse(rec.photos_json || '[]'); } catch { photos = []; }

            const wDiff =
              prev && rec.weight_kg && prev.weight_kg
                ? Math.round((Number(rec.weight_kg) - Number(prev.weight_kg)) * 10) / 10
                : null;
            const diffBadge =
              wDiff !== null ? ` (${wDiff > 0 ? `+${wDiff}` : wDiff} kg)` : '';

            const measItems = [
              rec.weight_kg ? `Peso: <strong>${rec.weight_kg} kg</strong>${diffBadge}` : '',
              rec.height_cm ? `Altezza: ${rec.height_cm} cm` : '',
              rec.bmi ? `BMI: <strong>${rec.bmi}</strong>` : '',
              meas.chest ? `Torace/Seno: ${meas.chest} cm` : '',
              meas.waist ? `Vita: ${meas.waist} cm` : '',
              meas.hips ? `Fianchi: ${meas.hips} cm` : '',
              meas.thigh_r ? `Coscia Dx: ${meas.thigh_r} cm` : '',
              meas.thigh_l ? `Coscia Sx: ${meas.thigh_l} cm` : '',
              meas.arm ? `Braccio: ${meas.arm} cm` : '',
            ].filter(Boolean);

            const pinsSummary = pins
              .map((p) => `<span class="tag-pill">${escapeHtml(p.zone)}: ${escapeHtml(p.note)}</span>`)
              .join(' ');
            const photosHtml = photos
              .map((src) => `<a href="${src}" target="_blank" rel="noopener"><img src="${src}" class="morpho-hist-img" alt="Foto progresso" /></a>`)
              .join('');

            return `
              <div class="morpho-history-card">
                <div class="morpho-history-head">
                  <strong>📅 ${escapeHtml(rec.recorded_at)} • ${rec.gender === 'male' ? 'Uomo' : 'Donna'}</strong>
                  <div style="display:flex;gap:6px;">
                    <button type="button" class="btn-outline-sm" data-load-pins="${rec.id}">Carica Pin su Mappa</button>
                    <button type="button" class="btn-danger-outline" data-del-morpho="${rec.id}" style="padding:4px 8px;font-size:0.7rem;">Elimina</button>
                  </div>
                </div>
                <div class="morpho-meas-line">${measItems.join(' • ') || 'Solo mappa zone'}</div>
                ${pinsSummary ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px;">${pinsSummary}</div>` : ''}
                ${rec.notes ? `<div class="muted-text" style="margin-top:6px;font-size:0.76rem;">📝 ${escapeHtml(rec.notes)}</div>` : ''}
                ${photosHtml ? `<div class="morpho-hist-photos">${photosHtml}</div>` : ''}
              </div>`;
          })
          .join('');

        historyListEl.querySelectorAll('[data-load-pins]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const rec = state.records.find((r) => Number(r.id) === Number(btn.dataset.loadPins));
            if (!rec) return;
            state.gender = rec.gender === 'male' ? 'male' : 'female';
            try {
              state.annotations = JSON.parse(rec.annotations_json || '[]');
            } catch {
              state.annotations = [];
            }
            document.getElementById('morphoGenderFemaleBtn').classList.toggle('active', state.gender === 'female');
            document.getElementById('morphoGenderMaleBtn').classList.toggle('active', state.gender === 'male');
            renderSvgAndPins();
          });
        });

        historyListEl.querySelectorAll('[data-del-morpho]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            if (!window.confirm('Eliminare questa rilevazione morfologica?')) return;
            await apiFetch(`admin/morpho/${btn.dataset.delMorpho}`, { method: 'DELETE' });
            await reloadClientRecords();
          });
        });
      }

      async function reloadClientRecords() {
        const res = await apiFetch(`admin/clients/${state.clientId}/morpho`);
        state.records = res.records || [];
        renderHistory();
      }

      document.getElementById('morphoForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          recorded_at: document.getElementById('morphoDateInput').value || getTodayIso(),
          gender: state.gender,
          weight_kg: weightEl.value || null,
          height_cm: heightEl.value || null,
          measurements: {
            chest: document.getElementById('morphoChestInput').value || null,
            waist: document.getElementById('morphoWaistInput').value || null,
            hips: document.getElementById('morphoHipsInput').value || null,
            thigh_r: document.getElementById('morphoThighRInput').value || null,
            thigh_l: document.getElementById('morphoThighLInput').value || null,
            arm: document.getElementById('morphoArmInput').value || null,
          },
          annotations: state.annotations,
          photos: state.photos,
          notes: document.getElementById('morphoNotesInput').value.trim(),
        };
        await apiFetch(`admin/clients/${state.clientId}/morpho`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        state.photos = [];
        renderPhotoPreviews();
        document.getElementById('morphoNotesInput').value = '';
        await reloadClientRecords();
      });

      document.getElementById('closeMorphoModalBtn').addEventListener('click', () => {
        modal.classList.remove('open');
      });

      return {
        async openForClient(client) {
          state.clientId = Number(client.id);
          state.clientName = client.full_name;
          state.annotations = [];
          state.photos = [];
          document.getElementById('morphoModalTitle').textContent = `Scheda Morfologica — ${client.full_name}`;
          document.getElementById('morphoDateInput').value = getTodayIso();
          renderSvgAndPins();
          renderPhotoPreviews();
          updateBmiPreview();
          modal.classList.add('open');
          await reloadClientRecords();
        },
      };
    },
  };
})();
