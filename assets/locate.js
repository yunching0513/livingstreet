/* 共用的「我的位置」控制項
 *
 * 給照片案例地圖（index.html）與考察路線（routes.html）共用。
 * 用法：
 *   const locator = createLocateControl(map, {
 *     button: document.getElementById('locate-btn'),
 *     toast: (text) => { ... },          // 顯示訊息（可省略）
 *     onPosition: (latlng, accuracy) => { ... },
 *     onStop: () => { ... },
 *   });
 *
 * 按鈕的三種狀態：
 *   未啟用 → 點一下開始定位並跟隨
 *   跟隨中 → 點一下關閉定位（使用者自己拖動地圖則只停止跟隨，位置點保留）
 *   已定位但未跟隨 → 點一下回到自己的位置
 */
window.createLocateControl = function createLocateControl(map, opts) {
  const btn = opts.button;
  const notify = opts.toast || (() => {});
  const layer = L.layerGroup().addTo(map);

  let watchId = null;
  let following = false;
  let latlng = null;
  let dot = null;
  let acc = null;

  function setFollow(on) {
    following = on;
    btn.classList.toggle('following', on);
    btn.title = on ? '停止定位' : '回到我的位置';
  }

  function stop() {
    if (watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    latlng = dot = acc = null;
    layer.clearLayers();
    setFollow(false);
    btn.classList.remove('locating');
    btn.setAttribute('aria-pressed', 'false');
    btn.title = '顯示我的位置';
    if (opts.onStop) opts.onStop();
  }

  function onPos(pos) {
    const { latitude, longitude, accuracy } = pos.coords;
    latlng = L.latLng(latitude, longitude);
    if (!dot) {
      acc = L.circle(latlng, {
        radius: accuracy, color: '#4C8C58', weight: 1,
        fillColor: '#8FB9C9', fillOpacity: 0.15, interactive: false,
      }).addTo(layer);
      dot = L.marker(latlng, {
        icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18] }),
        zIndexOffset: 1200, interactive: false,
      }).addTo(layer);
    } else {
      acc.setLatLng(latlng).setRadius(accuracy);
      dot.setLatLng(latlng);
    }
    btn.classList.remove('locating');
    btn.setAttribute('aria-pressed', 'true');
    if (following) map.setView(latlng, Math.max(map.getZoom(), 17));
    if (opts.onPosition) opts.onPosition(latlng, accuracy);
  }

  function onErr(err) {
    stop();
    notify(err.code === 1
      ? '定位權限被拒絕。請在瀏覽器的網站設定中允許本站取用位置，再按一次定位。'
      : err.code === 3
        ? '定位逾時。室內訊號較弱，請到戶外或稍後再試。'
        : '目前取不到定位訊號，請到戶外或稍後再試。');
  }

  btn.addEventListener('click', () => {
    if (!navigator.geolocation || !window.isSecureContext) {
      notify('這個瀏覽器或連線不支援定位（需以 https 開啟網頁）。');
      return;
    }
    if (watchId == null) {
      btn.classList.add('locating');
      setFollow(true);
      notify('正在取得定位…');
      watchId = navigator.geolocation.watchPosition(onPos, onErr, {
        enableHighAccuracy: true, maximumAge: 5000, timeout: 20000,
      });
    } else if (!following) {
      setFollow(true);
      if (latlng) map.setView(latlng, Math.max(map.getZoom(), 17));
    } else {
      stop();
    }
  });

  // 使用者自己拖動地圖就停止跟隨，但保留位置點
  map.on('dragstart', () => { if (following) setFollow(false); });

  return { stop, get position() { return latlng; } };
};
