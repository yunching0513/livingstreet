/* 生活街道案例地圖 — 前端邏輯
 *
 * 兩種資料來源：
 *  1) data/photos.json（由 scripts/build_map.py 產生的「案例資料庫」）
 *  2) 使用者當場拖曳／選取的照片（在瀏覽器即時讀取 EXIF GPS，屬暫時性）
 */

// ---- 地圖初始化 ----
const map = L.map('map', { zoomControl: true }).setView([23.7, 121.0], 7); // 預設台灣

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap 貢獻者',
}).addTo(map);

const clusterGroup = L.markerClusterGroup({ maxClusterRadius: 45 });
map.addLayer(clusterGroup);

const listEl = document.getElementById('photo-list');
const countEl = document.getElementById('photo-count');
const emptyEl = document.getElementById('empty-state');
const toastEl = document.getElementById('toast');

let items = []; // { id, title, note, lat, lng, datetime, imgUrl, thumbUrl, temp, marker }

// ---- 工具 ----
function toast(msg, ms = 2600) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (toastEl.hidden = true), ms);
}

function fmtCoord(lat, lng) {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function gmapsLink(lat, lng) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

// ---- 渲染 ----
function refreshUI() {
  countEl.textContent = `${items.length} 個案例`;
  emptyEl.style.display = items.length ? 'none' : 'block';

  listEl.innerHTML = '';
  for (const it of items) {
    const li = document.createElement('li');
    li.className = 'photo-item';
    li.innerHTML = `
      <img src="${it.thumbUrl || it.imgUrl}" alt="" loading="lazy" />
      <div class="meta">
        <div class="title">${escapeHtml(it.title)}${it.temp ? '<span class="badge-temp">暫時</span>' : ''}</div>
        <div class="coord">${fmtCoord(it.lat, it.lng)}</div>
        ${it.datetime ? `<div class="date">${escapeHtml(it.datetime)}</div>` : ''}
      </div>`;
    li.addEventListener('click', () => {
      map.setView([it.lat, it.lng], 17, { animate: true });
      it.marker.openPopup();
    });
    listEl.appendChild(li);
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function addItem(it) {
  const marker = L.marker([it.lat, it.lng]);
  const popup = `
    <div class="popup">
      <img src="${it.imgUrl || it.thumbUrl}" alt="" />
      <div class="p-title">${escapeHtml(it.title)}</div>
      ${it.note ? `<div class="p-note">${escapeHtml(it.note)}</div>` : ''}
      ${it.datetime ? `<div class="p-coord">🕑 ${escapeHtml(it.datetime)}</div>` : ''}
      <div class="p-coord">📍 ${fmtCoord(it.lat, it.lng)}</div>
      <a href="${gmapsLink(it.lat, it.lng)}" target="_blank" rel="noopener">在 Google 地圖開啟 ↗</a>
    </div>`;
  marker.bindPopup(popup, { maxWidth: 280 });
  it.marker = marker;
  clusterGroup.addLayer(marker);
  items.push(it);
}

function fitToItems() {
  if (!items.length) return;
  const bounds = L.latLngBounds(items.map((i) => [i.lat, i.lng]));
  map.fitBounds(bounds, { padding: [50, 50], maxZoom: 17 });
}

// ---- 載入資料庫 data/photos.json ----
async function loadDatabase() {
  try {
    const res = await fetch('data/photos.json', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    const photos = data.photos || [];
    for (const p of photos) {
      if (typeof p.lat !== 'number' || typeof p.lng !== 'number') continue;
      addItem({
        id: p.id,
        title: p.title || p.id,
        note: p.note || '',
        lat: p.lat,
        lng: p.lng,
        datetime: p.datetime || '',
        imgUrl: p.image || p.thumb,
        thumbUrl: p.thumb || p.image,
        temp: false,
      });
    }
    refreshUI();
    fitToItems();
    if (photos.length) toast(`已從資料庫載入 ${items.length} 個案例`);
  } catch (e) {
    // 以 file:// 開啟時 fetch 會失敗，屬正常；使用拖曳模式即可。
    console.info('未載入資料庫（可能是本機直接開啟檔案）：', e.message);
  }
}

// ---- 處理使用者拖曳／選取的照片 ----
function isHeic(file) {
  const n = file.name.toLowerCase();
  return file.type === 'image/heic' || file.type === 'image/heif' ||
    n.endsWith('.heic') || n.endsWith('.heif');
}

async function displayUrlFor(file) {
  if (isHeic(file) && window.heic2any) {
    try {
      const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 });
      return URL.createObjectURL(Array.isArray(blob) ? blob[0] : blob);
    } catch (e) {
      console.warn('HEIC 轉檔失敗：', e);
      return null; // 無法顯示，但仍會放上座標
    }
  }
  return URL.createObjectURL(file);
}

async function handleFiles(fileList) {
  const files = Array.from(fileList).filter((f) =>
    f.type.startsWith('image/') || isHeic(f));
  if (!files.length) return;

  toast(`讀取 ${files.length} 張照片的 GPS 資料…`, 4000);
  let added = 0;
  let noGps = 0;

  for (const file of files) {
    let gps = null;
    try {
      gps = await exifr.gps(file);
    } catch (_) { /* 略過 */ }

    if (!gps || typeof gps.latitude !== 'number') { noGps++; continue; }

    let datetime = '';
    try {
      const d = await exifr.parse(file, ['DateTimeOriginal', 'CreateDate']);
      const dt = d?.DateTimeOriginal || d?.CreateDate;
      if (dt) datetime = new Date(dt).toLocaleString('zh-TW');
    } catch (_) { /* 略過 */ }

    const url = await displayUrlFor(file);
    addItem({
      id: file.name,
      title: file.name.replace(/\.[^.]+$/, ''),
      note: '',
      lat: gps.latitude,
      lng: gps.longitude,
      datetime,
      imgUrl: url,
      thumbUrl: url,
      temp: true,
    });
    added++;
  }

  refreshUI();
  fitToItems();

  if (added && noGps) toast(`已加入 ${added} 張；${noGps} 張沒有 GPS 座標，已略過`);
  else if (added) toast(`已加入 ${added} 張照片`);
  else if (noGps) toast(`這 ${noGps} 張照片都沒有 GPS 座標。請確認拍照時有開啟定位。`, 5000);
}

// ---- 事件綁定 ----
document.getElementById('file-input').addEventListener('change', (e) => {
  handleFiles(e.target.files);
  e.target.value = '';
});

const overlay = document.getElementById('drop-overlay');
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  overlay.classList.add('show');
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragDepth--;
  if (dragDepth <= 0) overlay.classList.remove('show');
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  overlay.classList.remove('show');
  if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
});

// ---- 啟動 ----
loadDatabase();
refreshUI();
