(function () {
  'use strict';

  if (document.getElementById('cpt')) return;

  // ══════════════════════════════════════════
  // CONFIG
  // ══════════════════════════════════════════
  const ROWS        = ['A','B','C','D','E'];
  const POS         = ['01','02','03','04','05','06','07'];
  const CONCURRENCY = 6;

  // ══════════════════════════════════════════
  // FETCH
  // ══════════════════════════════════════════
  function fetchContainer(container, wh) {
    return new Promise((resolve, reject) => {
      const url = 'id-premiums-report/' + wh + '/' + container;
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.setRequestHeader('Accept', 'application/json, text/javascript, */*; q=0.01');
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      xhr.timeout = 12000;
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        if (xhr.status === 200) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch (e) {
            try {
              const doc = new DOMParser().parseFromString(xhr.responseText, 'application/xml');
              resolve({
                fasttrack : doc.querySelector('fasttrack')?.textContent  || '',
                premiums  : doc.querySelector('premiums')?.textContent   || '',
                standards : doc.querySelector('standards')?.textContent  || ''
              });
            } catch (e2) { reject(new Error('parse')); }
          }
        } else { reject(new Error('http_' + xhr.status)); }
      };
      xhr.ontimeout = () => reject(new Error('timeout'));
      xhr.onerror   = () => reject(new Error('network'));
      xhr.send();
    });
  }

  // ══════════════════════════════════════════
  // TRANSFORMAÇÃO resml → rbsml
  // ══════════════════════════════════════════
  function toScanPrefix(input) {
    const raw = input.trim().toLowerCase();
    if (raw.startsWith('rbs')) return raw;
    if (raw.startsWith('res')) return 'rbs' + raw.slice(3);
    return raw;
  }

  function showTransform(original, transformed) {
    const el = document.getElementById('cpt-transform');
    if (!el) return;
    if (!original || original === transformed) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.innerHTML =
      `<span style="color:#94a3b8">${original}</span>` +
      `<span style="color:#f0a500"> → </span>` +
      `<span style="color:#4ade80;font-weight:bold">${transformed}</span>` +
      `<span style="color:#334155"> (prefixo de busca)</span>`;
  }

  // ══════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════
  function buildList(prefix) {
    const list = [];
    for (const r of ROWS) for (const p of POS) list.push(`${prefix}${r}${p}`);
    return list;
  }

  function parseField(raw) {
    if (!raw) return null;
    const m = String(raw).trim().match(/:\s*(\d+)\s+(\w+)\s+([\d:]+)/i);
    if (!m || parseInt(m[1]) === 0) return null;
    return { qty: parseInt(m[1]), cpt: `${m[3]} ${m[2].toUpperCase()}` };
  }

  function minutesUntil(cptKey) {
    const [h, m] = cptKey.split(' ')[0].split(':').map(Number);
    if (isNaN(h)) return Infinity;
    const now = new Date(), t = new Date();
    t.setHours(h, m, 0, 0);
    return (t - now) / 60000;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function getWH() {
    return document.getElementById('warehouseId')?.value || 'GRU5';
  }

  function setStatus(msg) {
    const el = document.getElementById('cpt-status');
    if (el) el.textContent = msg;
  }

  function setProgress(done, total) {
    const pct = Math.round((done / total) * 100);
    const el  = document.getElementById('cpt-status');
    if (el) el.innerHTML =
      `[${done}/${total}] (${pct}%)` +
      `<div class="pb"><div class="pf" style="width:${pct}%"></div></div>`;
  }

  // ══════════════════════════════════════════
  // BUILD CPT MAP
  // ══════════════════════════════════════════
  function buildCptMap(results) {
    const map = {};
    for (const [container, data] of Object.entries(results)) {
      if (!data) continue;
      for (const [type, raw] of Object.entries({
        standards : data.standards,
        premiums  : data.premiums,
        fasttrack : data.fasttrack
      })) {
        const p = parseField(raw);
        if (!p) continue;
        if (!map[p.cpt]) map[p.cpt] = { standards: [], premiums: [], fasttrack: [] };
        map[p.cpt][type].push({ container, qty: p.qty });
      }
    }
    return map;
  }

  // ══════════════════════════════════════════
  // RENDER ALERTA
  // ══════════════════════════════════════════
  function renderAlert(cptMap) {
    const el = document.getElementById('cpt-alert');
    const sorted = Object.keys(cptMap)
      .filter(cpt => ['standards','premiums','fasttrack'].some(t => cptMap[cpt][t].length))
      .sort((a, b) => minutesUntil(a) - minutesUntil(b));

    if (!sorted.length) { el.style.display = 'none'; return; }

    const nearest   = sorted[0];
    const mins      = minutesUntil(nearest);
    const urgent    = mins <= 75;
    const timeStr   = nearest.split(' ')[0];
    const totalCtrs = ['standards','premiums','fasttrack']
      .reduce((s, t) => s + cptMap[nearest][t].length, 0);
    const timeTag   = mins < 0
      ? `⚠️ atrasado ${Math.abs(Math.round(mins))}min`
      : mins === Infinity ? ''
      : `em ${Math.round(mins)}min`;

    el.style.display = 'block';
    el.className     = urgent ? 'red' : 'blue';
    el.innerHTML     =
      `<div class="al-label">CPT mais próximo</div>` +
      `<div class="al-time">🕐 ${timeStr}</div>` +
      `<div class="al-info">${timeTag} · ${totalCtrs} container${totalCtrs > 1 ? 's' : ''}</div>`;
  }

  // ══════════════════════════════════════════
  // RENDER LISTA
  // ══════════════════════════════════════════
  function renderList(cptMap, errors) {
    const listEl = document.getElementById('cpt-list');
    const sorted = Object.keys(cptMap).sort((a, b) => minutesUntil(a) - minutesUntil(b));
    let html = '';

    sorted.forEach((cpt, idx) => {
      const mins    = minutesUntil(cpt);
      const urgent  = mins <= 75;
      const cls     = urgent ? 'red' : 'blue';
      const timeStr = cpt.split(' ')[0];
      const open    = idx === 0;
      const total   = ['standards','premiums','fasttrack']
        .reduce((s, t) => s + cptMap[cpt][t].length, 0);
      const timeTag = mins < 0
        ? `⚠️ atrasado ${Math.abs(Math.round(mins))}min`
        : mins === Infinity ? ''
        : `⏱ ${Math.round(mins)}min`;

      let typesHtml = '';
      if (cptMap[cpt].standards.length)
        typesHtml +=
          `<div class="type-title">📦 Padrões (${cptMap[cpt].standards.length})</div>` +
          `<div class="ctrs">${cptMap[cpt].standards.map(i => `<span class="ctr">${i.container}</span>`).join('')}</div>`;
      if (cptMap[cpt].premiums.length)
        typesHtml +=
          `<div class="type-title">💎 Premiums (${cptMap[cpt].premiums.length})</div>` +
          `<div class="ctrs">${cptMap[cpt].premiums.map(i => `<span class="ctr">${i.container}</span>`).join('')}</div>`;
      if (cptMap[cpt].fasttrack.length)
        typesHtml +=
          `<div class="type-title">⚡ FastTrack (${cptMap[cpt].fasttrack.length})</div>` +
          `<div class="ctrs">${cptMap[cpt].fasttrack.map(i => `<span class="ctr">${i.container}</span>`).join('')}</div>`;

      html +=
        `<div class="cpt-item ${cls}">` +
          `<div class="cpt-hdr">` +
            `<div class="cpt-hdr-left">` +
              `<span>🕐 ${timeStr}</span>` +
              `<span class="cpt-cnt">${timeTag} · ${total} ctr${total > 1 ? 's' : ''}</span>` +
            `</div>` +
            `<span class="cpt-arr ${open ? 'open' : ''}">▼</span>` +
          `</div>` +
          `<div class="cpt-bdy ${open ? 'open' : ''}">${typesHtml}</div>` +
        `</div>`;
    });

    if (errors.length)
      html +=
        `<div class="err-box">⚠️ ${errors.length} sem resposta: ` +
        `${errors.slice(0, 5).join(', ')}${errors.length > 5 ? '…' : ''}</div>`;

    if (!sorted.length && !errors.length)
      html = `<div style="text-align:center;color:#334155;padding:16px;font-size:11px">ℹ️ Todos os containers estão vazios.</div>`;

    listEl.innerHTML = html;

    listEl.querySelectorAll('.cpt-hdr').forEach(hdr => {
      hdr.addEventListener('click', () => {
        hdr.nextElementSibling.classList.toggle('open');
        hdr.querySelector('.cpt-arr').classList.toggle('open');
      });
    });
  }

  // ══════════════════════════════════════════
  // SCAN
  // ══════════════════════════════════════════
  async function startScan() {
    const raw = document.getElementById('c-pre').value.trim();
    if (!raw) { alert('Digite o número do carrinho!'); return; }

    const prefix = toScanPrefix(raw);
    showTransform(raw, prefix);

    const wh     = getWH();
    const list   = buildList(prefix);
    const btnGo  = document.getElementById('b-go');
    const btnRty = document.getElementById('b-retry');

    btnGo.disabled       = true;
    btnRty.style.display = 'none';
    document.getElementById('cpt-list').innerHTML      = '';
    document.getElementById('cpt-alert').style.display = 'none';
    document.getElementById('cpt-btns').classList.remove('show');
    setStatus(`🔄 Buscando ${list.length} containers para ${prefix}…`);

    const results = {}, errors = [];
    let done = 0;

    for (let i = 0; i < list.length; i += CONCURRENCY) {
      await Promise.all(
        list.slice(i, i + CONCURRENCY).map(async container => {
          try {
            results[container] = await fetchContainer(container, wh);
          } catch (e) {
            try {
              await sleep(400);
              results[container] = await fetchContainer(container, wh);
            } catch (e2) {
              results[container] = null;
              errors.push(container);
            }
          }
          done++;
          setProgress(done, list.length);
        })
      );
      await sleep(50);
    }

    const ok = list.length - errors.length;
    setStatus(ok === list.length
      ? `✅ ${ok} containers lidos`
      : `✅ ${ok} lidos · ⚠️ ${errors.length} erros`);

    const cptMap = buildCptMap(results);
    renderAlert(cptMap);
    renderList(cptMap, errors);

    btnGo.disabled = false;
    document.getElementById('cpt-btns').classList.add('show');
    if (errors.length) btnRty.style.display = 'block';
    window._cptData = { cptMap, errors, results, prefix, raw, wh };
  }

  // ══════════════════════════════════════════
  // RETRY
  // ══════════════════════════════════════════
  async function retryErrors() {
    if (!window._cptData?.errors?.length) return;
    const { errors, results, wh } = window._cptData;
    const toRetry = [...errors];
    const btn = document.getElementById('b-retry');
    btn.disabled = true;
    setStatus(`🔄 Retentando ${toRetry.length}…`);
    const stillErr = [];
    let done = 0;
    for (let i = 0; i < toRetry.length; i += CONCURRENCY) {
      await Promise.all(
        toRetry.slice(i, i + CONCURRENCY).map(async container => {
          try {
            results[container] = await fetchContainer(container, wh);
            const idx = window._cptData.errors.indexOf(container);
            if (idx > -1) window._cptData.errors.splice(idx, 1);
          } catch (e) { stillErr.push(container); }
          finally { done++; setProgress(done, toRetry.length); }
        })
      );
      await sleep(80);
    }
    window._cptData.errors = stillErr;
    const cptMap = buildCptMap(results);
    window._cptData.cptMap = cptMap;
    renderAlert(cptMap);
    renderList(cptMap, stillErr);
    btn.disabled      = false;
    btn.style.display = stillErr.length > 0 ? 'block' : 'none';
    setStatus(stillErr.length === 0 ? '✅ Todos resolvidos!' : `⚠️ Ainda ${stillErr.length} com erro.`);
  }

  // ══════════════════════════════════════════
  // COPIAR
  // ══════════════════════════════════════════
  function copyResult() {
    if (!window._cptData) return;
    const { cptMap, errors, prefix, raw } = window._cptData;
    const sorted = Object.keys(cptMap).sort((a, b) => minutesUntil(a) - minutesUntil(b));
    let txt = `GRU5 · CPT Scanner\nCarrinho: ${raw} → busca: ${prefix}\n`;
    txt += `${new Date().toLocaleString('pt-BR')}\n${'─'.repeat(40)}\n\n`;
    for (const cpt of sorted) {
      const mins = minutesUntil(cpt);
      txt += `${mins <= 75 ? '🔴' : '🔵'} CPT ${cpt.split(' ')[0]}\n`;
      if (cptMap[cpt].standards.length)  txt += `Padrões  : ${cptMap[cpt].standards.map(i => i.container).join(', ')}\n`;
      if (cptMap[cpt].premiums.length)   txt += `Premiums : ${cptMap[cpt].premiums.map(i => i.container).join(', ')}\n`;
      if (cptMap[cpt].fasttrack.length)  txt += `FastTrack: ${cptMap[cpt].fasttrack.map(i => i.container).join(', ')}\n`;
      txt += '\n';
    }
    if (errors.length) txt += `Erros (${errors.length}): ${errors.join(', ')}\n`;
    navigator.clipboard.writeText(txt).then(() => {
      const b = document.getElementById('b-copy');
      b.textContent = '✅ Copiado!';
      setTimeout(() => b.textContent = '📋 Copiar', 2000);
    });
  }

  // ══════════════════════════════════════════
  // LIMPAR
  // ══════════════════════════════════════════
  function clearResult() {
    document.getElementById('cpt-list').innerHTML          = '';
    document.getElementById('cpt-alert').style.display     = 'none';
    document.getElementById('cpt-transform').style.display = 'none';
    document.getElementById('cpt-btns').classList.remove('show');
    document.getElementById('b-retry').style.display       = 'none';
    setStatus('');
    window._cptData = null;
  }

  // ══════════════════════════════════════════
  // ESTILOS
  // ══════════════════════════════════════════
  const style = document.createElement('style');
  style.textContent = `
    #cpt {
      position:fixed;top:10px;right:10px;width:360px;
      background:#0d0d1f;color:#e2e8f0;
      border-radius:12px;padding:12px;
      font-family:'Courier New',monospace;font-size:12px;
      z-index:99999;border:1px solid #1e1e3a;
      box-shadow:0 8px 32px rgba(0,0,0,.9);
      max-height:92vh;overflow-y:auto;
    }
    #cpt h3{margin:0 0 8px;color:#f0a500;font-size:13px;text-align:center}
    #cpt-alert{border-radius:8px;padding:10px 12px;margin-bottom:10px;display:none;text-align:center}
    #cpt-alert.red{background:#7f1d1d;color:#fca5a5;border:1px solid #ef4444}
    #cpt-alert.blue{background:#1e3a5f;color:#93c5fd;border:1px solid #3b82f6}
    .al-label{font-size:10px;opacity:.8;margin-bottom:2px}
    .al-time{font-size:22px;font-weight:bold;letter-spacing:1px}
    .al-info{font-size:10px;opacity:.8;margin-top:2px}
    #cpt-row{display:flex;gap:6px;align-items:center;margin-bottom:4px}
    #cpt-row input{flex:1;padding:7px 10px;border-radius:6px;border:1px solid #1e1e3a;background:#070714;color:#fff;font-family:monospace;font-size:13px;outline:none}
    #cpt-row input:focus{border-color:#f0a500}
    #b-go{padding:7px 14px;background:#f0a500;color:#000;font-weight:bold;border:none;border-radius:6px;cursor:pointer;font-size:13px}
    #b-go:hover{background:#fbbf24}
    #b-go:disabled{background:#374151;color:#6b7280;cursor:not-allowed}
    #cpt-transform{font-size:10px;padding:3px 8px;margin-bottom:6px;background:#070714;border-radius:4px;border:1px solid #1e1e3a;display:none}
    #cpt-status{font-size:10px;color:#64748b;text-align:center;min-height:12px}
    .pb{background:#1e293b;border-radius:3px;height:3px;margin-top:3px;overflow:hidden}
    .pf{background:#f0a500;height:3px;border-radius:3px;transition:width .15s}
    #cpt-list{margin-top:8px}
    .cpt-item{border-radius:8px;margin-bottom:6px;overflow:hidden}
    .cpt-item.red{border:1px solid #7f1d1d}
    .cpt-item.blue{border:1px solid #1e3a5f}
    .cpt-hdr{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;cursor:pointer;user-select:none;font-size:12px;font-weight:bold}
    .cpt-item.red .cpt-hdr{background:#450a0a;color:#fca5a5}
    .cpt-item.blue .cpt-hdr{background:#0c1a2e;color:#93c5fd}
    .cpt-item.red .cpt-hdr:hover{background:#5a0e0e}
    .cpt-item.blue .cpt-hdr:hover{background:#0f2240}
    .cpt-hdr-left{display:flex;align-items:center;gap:8px}
    .cpt-cnt{font-size:10px;font-weight:normal;opacity:.7}
    .cpt-arr{font-size:10px;transition:transform .2s}
    .cpt-arr.open{transform:rotate(180deg)}
    .cpt-bdy{background:#070714;display:none;padding:8px 10px;border-top:1px solid #1e1e3a}
    .cpt-bdy.open{display:block}
    .type-title{font-size:10px;color:#64748b;margin:6px 0 3px;text-transform:uppercase;letter-spacing:.5px}
    .type-title:first-child{margin-top:0}
    .ctrs{display:flex;flex-wrap:wrap;gap:4px}
    .ctr{background:#1e293b;border-radius:4px;padding:2px 7px;font-size:10px;color:#cbd5e1;border:1px solid #334155}
    #cpt-btns{display:none;grid-template-columns:1fr 1fr;gap:5px;margin-top:8px}
    #cpt-btns.show{display:grid}
    .btn{padding:6px;font-weight:bold;border:none;border-radius:6px;cursor:pointer;font-size:11px}
    #b-copy{background:#0d9488;color:#fff}
    #b-clear{background:#374151;color:#9ca3af}
    #b-retry{display:none;width:100%;padding:6px;margin-top:5px;font-weight:bold;border:none;border-radius:6px;cursor:pointer;font-size:11px;background:#7c3aed;color:#fff}
    .err-box{margin-top:6px;padding:5px 8px;background:#1a0a0a;border-left:3px solid #ef4444;border-radius:4px;color:#fca5a5;font-size:10px}
  `;
  document.head.appendChild(style);

  // ══════════════════════════════════════════
  // PAINEL HTML
  // ══════════════════════════════════════════
  const wh = document.getElementById('warehouseId')?.value || 'GRU5';
  const panel = document.createElement('div');
  panel.id = 'cpt';
  panel.innerHTML = `
    <h3>🛒 Cart CPT Scanner · ${wh}</h3>
    <div id="cpt-alert"></div>
    <div id="cpt-row">
      <input id="c-pre" type="text"
        placeholder="Carrinho (ex: resml043)"
        autocomplete="off" spellcheck="false" />
      <button id="b-go">🔍 Scan</button>
    </div>
    <div id="cpt-transform"></div>
    <div id="cpt-status"></div>
    <div id="cpt-list"></div>
    <div id="cpt-btns">
      <button class="btn" id="b-copy">📋 Copiar</button>
      <button class="btn" id="b-clear">🗑 Limpar</button>
    </div>
    <button id="b-retry">🔄 Retry erros</button>
  `;
  document.body.appendChild(panel);

  // ══════════════════════════════════════════
  // EVENTOS
  // ══════════════════════════════════════════
  document.getElementById('c-pre').addEventListener('input', function () {
    showTransform(this.value.trim(), toScanPrefix(this.value.trim()));
  });
  document.getElementById('c-pre').addEventListener('keydown', e => {
    if (e.key === 'Enter') startScan();
  });
  document.getElementById('b-go').addEventListener('click', startScan);
  document.getElementById('b-copy').addEventListener('click', copyResult);
  document.getElementById('b-clear').addEventListener('click', clearResult);
  document.getElementById('b-retry').addEventListener('click', retryErrors);

})();
