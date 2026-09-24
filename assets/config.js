/* 網站設定
 *
 * googleMapsApiKey：填入 Google Maps JavaScript API 金鑰後，考察路線頁會改用 Google 地圖底圖
 * （提供「Google 地圖／Google 衛星／OpenStreetMap」切換）；留空則使用 OpenStreetMap。
 *
 * ⚠ 這個金鑰會出現在公開網頁原始碼中，這是 Maps JavaScript API 的正常用法，
 *   但請務必到 Google Cloud Console 設定限制，避免被他人盜用：
 *   1. 應用程式限制：HTTP 參照網址，只允許你的網域（例如 https://你的網站.vercel.app/*）
 *   2. API 限制：只允許 Maps JavaScript API
 */
window.LIVINGSTREET_CONFIG = {
  googleMapsApiKey: '',
};
