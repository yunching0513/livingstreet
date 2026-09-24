/* 荷蘭生活街區考察路線 — 互動地圖
 * 資料：data/routes.json（路線、停留點）＋ data/photos.json（附近實拍照片）
 */
(function () {
  const map = L.map('map', { zoomControl: true }).setView([52.2, 4.9], 9);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 20,
    subdomains: 'abcd',
    attribution: '&copy; OpenStreetMap 貢獻者 &copy; CARTO',
  }).addTo(map);

  const routeLayer = L.layerGroup().addTo(map);
  const stopLayer = L.layerGroup().addTo(map);
  const photoLayer = L.layerGroup().addTo(map);

  const $ = (id) => document.getElementById(id);
  const tabsEl = $('city-tabs');
  const summaryEl = $('city-summary');
  const filtersEl = $('type-filters');
  const listEl = $('stop-list');
  const photoToggle = $('photo-toggle');
  const sidebar = $('sidebar');

  let DATA = null;
  let PHOTOS = [];
  let city = null;
  let activeType = null;
  let stopEls = [];   // { li, marker, stop }
  const NEAR_M = 250;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function distM(a, b) {
    const R = 6371000, toR = Math.PI / 180;
    const dLat = (b[0] - a[0]) * toR, dLng = (b[1] - a[1]) * toR;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function badge(code) {
    const t = DATA.types[code];
    return `<span class="tbadge" style="background:${t.color};color:${t.text}">${code} ${esc(t.name)}</span>`;
  }

  function markerHtml(stop, label) {
    if (stop.kind === 'hub') return `<div class="stop-marker hub">▶</div>`;
    if (stop.kind === 'meal') return `<div class="stop-marker meal">☕</div>`;
    const t1 = DATA.types[stop.types[0]];
    const t2 = stop.types[1] ? DATA.types[stop.types[1]] : null;
    const ring = t2 ? `box-shadow:0 0 0 3px ${t2.color},0 2px 8px rgba(33,31,24,.35)` : '';
    return `<div class="stop-marker" style="background:${t1.color};color:${t1.text};${ring}">${label}</div>`;
  }

  function numHtml(stop, label) {
    if (stop.kind === 'hub') return `<span class="num hub">▶</span>`;
    if (stop.kind === 'meal') return `<span class="num meal">☕</span>`;
    const t = DATA.types[stop.types[0]];
    return `<span class="num" style="background:${t.color};color:${t.text}">${label}</span>`;
  }

  function popupHtml(stop) {
    return `<div class="popup">
      <div class="p-time">${esc(stop.time)}</div>
      <div class="p-title">${esc(stop.name)}</div>
      ${stop.types.length ? `<div class="p-types">${stop.types.map(badge).join('')}</div>` : ''}
      ${stop.observe ? `<div class="p-note">${esc(stop.observe)}</div>` : ''}
      <div class="p-actions"><a class="p-btn ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}">Google Maps</a></div>
    </div>`;
  }

  function nearbyPhotos(stop) {
    if (!PHOTOS.length || stop.kind !== 'stop') return [];
    return PHOTOS
      .map((p) => ({ p, d: distM([stop.lat, stop.lng], [p.lat, p.lng]) }))
      .filter((x) => x.d <= NEAR_M)
      .sort((a, b) => a.d - b.d)
      .slice(0, 6)
      .map((x) => x.p);
  }

  function openPhoto(p) {
    L.popup({ maxWidth: 300 })
      .setLatLng([p.lat, p.lng])
      .setContent(`<div class="popup"><img src="${esc(p.image || p.thumb)}" alt="" />
        <div class="p-title">${esc(p.title)}</div>
        <div class="p-note">${esc((p.note || '').slice(0, 120))}${(p.note || '').length > 120 ? '…' : ''}</div>
        <div class="p-coord">${esc(p.datetime || '')}</div></div>`)
      .openOn(map);
  }

  function setActive(i, { fly = true, scroll = true } = {}) {
    stopEls.forEach((s, j) => {
      s.li.classList.toggle('active', j === i);
      const el = s.marker.getElement();
      if (el) el.firstElementChild?.classList.toggle('active', j === i);
    });
    const s = stopEls[i];
    if (!s) return;
    if (fly) map.flyTo([s.stop.lat, s.stop.lng], Math.max(map.getZoom(), 16), { duration: 0.6 });
    s.marker.openPopup();
    if (scroll) s.li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function applyFilter() {
    [...filtersEl.children].forEach((b) => b.classList.toggle('active', (b.dataset.type || null) === activeType));
    stopEls.forEach(({ li, marker, stop }) => {
      const on = !activeType || stop.types.includes(activeType);
      li.classList.toggle('dim', !on);
      const el = marker.getElement();
      if (el) el.firstElementChild?.classList.toggle('dim', !on);
    });
  }

  function renderPhotos() {
    photoLayer.clearLayers();
    if (!photoToggle.checked || !city) return;
    const seen = new Set();
    for (const s of city.stops) {
      for (const p of nearbyPhotos(s)) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html: '<div class="photo-dot"></div>', iconSize: [10, 10] }), zIndexOffset: -100 })
          .on('click', () => openPhoto(p))
          .addTo(photoLayer);
      }
    }
  }

  function selectCity(id) {
    city = DATA.cities.find((c) => c.id === id) || DATA.cities[0];
    history.replaceState(null, '', '#' + city.id);
    [...tabsEl.children].forEach((b) => b.setAttribute('aria-selected', String(b.dataset.id === city.id)));

    const km = city.legs.reduce((a, l) => a + l.km, 0);
    const modes = [...new Set(city.legs.map((l) => l.label))].join('＋');
    summaryEl.innerHTML = `<div class="meta"><span>${esc(city.date)} ${esc(city.window)}</span><span>${modes}約${km.toFixed(1)}公里</span></div>${esc(city.summary)}`;

    // 路線
    routeLayer.clearLayers();
    const bounds = L.latLngBounds([]);
    for (const leg of city.legs) {
      const style = { walk: {}, bike: { dashArray: '8 8' }, tram: { dashArray: '2 8' } }[leg.mode] || {};
      L.polyline(leg.coords, { color: '#FFFFFF', weight: 8, opacity: 0.9 }).addTo(routeLayer);
      L.polyline(leg.coords, { color: '#211F18', weight: 4, opacity: 0.85, lineCap: 'round', ...style })
        .bindTooltip(leg.label + ' 約' + leg.km + '公里', { sticky: true })
        .addTo(routeLayer);
      leg.coords.forEach((c) => bounds.extend(c));
    }

    // 停留點
    stopLayer.clearLayers();
    listEl.innerHTML = '';
    stopEls = [];
    let n = 0;
    city.stops.forEach((stop, i) => {
      const label = stop.kind === 'stop' ? String(++n) : '';
      const marker = L.marker([stop.lat, stop.lng], {
        icon: L.divIcon({ className: '', html: markerHtml(stop, label), iconSize: stop.kind === 'stop' ? [30, 30] : [24, 24] }),
        zIndexOffset: stop.kind === 'stop' ? 500 : 0,
      }).bindPopup(popupHtml(stop), { maxWidth: 300, autoPanPadding: [40, 40] })
        .on('click', () => setActive(i, { fly: false }))
        .addTo(stopLayer);
      bounds.extend([stop.lat, stop.lng]);

      const near = nearbyPhotos(stop);
      const li = document.createElement('li');
      li.className = 'stop';
      li.innerHTML = `${numHtml(stop, label)}
        <div>
          <div class="stop-time">${esc(stop.time)}</div>
          <div class="stop-name">${esc(stop.name)}</div>
          ${stop.types.length ? `<div class="stop-types">${stop.types.map(badge).join('')}</div>` : ''}
          ${stop.flag ? `<div class="stop-flag">待確認：${esc(stop.flag)}</div>` : ''}
          ${stop.observe ? `<div class="stop-short">${esc(stop.observe.slice(0, 44))}${stop.observe.length > 44 ? '…' : ''}</div>` : (stop.measures ? `<div class="stop-short">${esc(stop.measures)}</div>` : '')}
          <div class="stop-detail stop-body">
            ${stop.measures ? `<h4>既有設計與政策</h4><p>${esc(stop.measures)}</p>` : ''}
            ${stop.observe ? `<h4>現場觀察重點</h4><p>${esc(stop.observe)}</p>` : ''}
            ${stop.sources.length ? `<div class="stop-src">${stop.sources.map(([t, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>`).join('')}</div>` : ''}
          </div>
          ${near.length ? `<div class="near-label">附近實拍（${NEAR_M}公尺內）</div><div class="near">${near.map((p, k) => `<img src="${esc(p.thumb || p.image)}" alt="${esc(p.title)}" title="${esc(p.title)}" loading="lazy" data-k="${k}" />`).join('')}</div>` : ''}
        </div>`;
      li.addEventListener('click', (e) => {
        const img = e.target.closest('.near img');
        if (img) { e.stopPropagation(); openPhoto(near[+img.dataset.k]); return; }
        if (e.target.closest('a')) return;
        setActive(i);
      });
      listEl.appendChild(li);
      stopEls.push({ li, marker, stop });
    });

    const mobile = window.matchMedia('(max-width: 768px)').matches;
    map.fitBounds(bounds, mobile
      ? { paddingTopLeft: [24, 70], paddingBottomRight: [24, Math.round(window.innerHeight * 0.55)] }
      : { padding: [40, 40] });
    renderPhotos();
    applyFilter();
  }

  function renderChrome() {
    tabsEl.innerHTML = DATA.cities.map((c) =>
      `<button class="city-tab" role="tab" data-id="${c.id}"><b>${esc(c.city)}</b><small>${esc(c.date)}</small></button>`).join('');
    tabsEl.addEventListener('click', (e) => {
      const b = e.target.closest('.city-tab');
      if (b) { e.stopPropagation(); selectCity(b.dataset.id); }
    });

    filtersEl.innerHTML = `<button class="type-chip" data-type="">全部</button>` +
      Object.entries(DATA.types).map(([code, t]) =>
        `<button class="type-chip" data-type="${code}"><span class="dot" style="background:${t.color}"></span>${code} ${esc(t.name)}</button>`).join('');
    filtersEl.addEventListener('click', (e) => {
      const b = e.target.closest('.type-chip');
      if (!b) return;
      e.stopPropagation();
      const t = b.dataset.type || null;
      activeType = activeType === t ? null : t;
      applyFilter();
    });

    photoToggle.addEventListener('change', renderPhotos);
    photoToggle.parentElement.addEventListener('click', (e) => e.stopPropagation());

    // 手機：點標頭收合底部面板（與案例地圖相同操作）
    $('sidebar-head').addEventListener('click', () => {
      if (window.matchMedia('(max-width: 768px)').matches) sidebar.classList.toggle('collapsed');
    });
  }

  Promise.all([
    fetch('data/routes.json').then((r) => r.json()),
    fetch('data/photos.json').then((r) => r.json()).catch(() => ({ photos: [] })),
  ]).then(([routes, photos]) => {
    DATA = routes;
    PHOTOS = (photos.photos || [])
      .map((p) => ({ ...p, lat: parseFloat(p.lat), lng: parseFloat(p.lng) }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    renderChrome();
    selectCity(location.hash.slice(1));
  }).catch((err) => {
    listEl.innerHTML = `<li class="stop-body" style="padding:16px">無法載入路線資料（${esc(err.message)}）。請透過本機伺服器或已部署的網站開啟。</li>`;
  });

  window.addEventListener('hashchange', () => {
    if (DATA && location.hash.slice(1) !== city?.id) selectCity(location.hash.slice(1));
  });
})();
