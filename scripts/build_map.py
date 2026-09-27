#!/usr/bin/env python3
"""
生活街道案例地圖 — 資料庫產生器

用途：
  掃描 photos/ 資料夾內的照片，從 EXIF 讀出 GPS 經緯度，
  產生縮圖（HEIC 會自動轉成 JPEG），並輸出 data/photos.json。
  網頁 index.html 會讀取 data/photos.json，把每張照片標在地圖上。

用法：
  1) 把照片（JPEG 或 iPhone HEIC）放進 photos/ 資料夾
  2) 安裝相依套件：  pip install -r scripts/requirements.txt
  3) 執行：          python scripts/build_map.py

重新執行時，會保留你先前在 data/photos.json 內為每張照片手動填寫的
title（標題）與 note（說明）。
"""

import json
import sys
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    sys.exit("缺少 Pillow，請先執行：pip install -r scripts/requirements.txt")

# 讓 Pillow 能開啟 iPhone 的 HEIC/HEIF
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
    HEIC_OK = True
except ImportError:
    HEIC_OK = False

# 依座標反查城市／地區（離線，不需外部 API）；沒安裝也不影響其他功能
try:
    import reverse_geocode as _rgc
    RGC_OK = True
except ImportError:
    RGC_OK = False

ROOT = Path(__file__).resolve().parent.parent
PHOTOS_DIR = ROOT / "photos"
THUMBS_DIR = ROOT / "thumbs"
DATA_FILE = ROOT / "data" / "photos.json"

# 縮圖尺寸與品質：在手機上看不出差異的前提下盡量壓小。
# 維持 JPEG（而非 WebP／AVIF），使用者按「下載」拿到的仍是通用的 .jpg。
DISPLAY_MAX = 1280   # 彈出視窗顯示用的圖片長邊像素
SMALL_MAX = 400      # 側邊清單／地圖標記用的小縮圖長邊像素
DISPLAY_Q = 80       # 漸進式 JPEG，行動網路下先出低解析預覽
SMALL_Q = 78
IMG_EXTS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".heic", ".heif", ".webp"}


def to_degrees(value):
    """把 EXIF 的 (度, 分, 秒) 轉成十進位度數。"""
    d, m, s = value
    return float(d) + float(m) / 60.0 + float(s) / 3600.0


def get_gps(img):
    """從影像 EXIF 取出 (lat, lng)；沒有座標則回傳 None。"""
    try:
        exif = img.getexif()
        gps = exif.get_ifd(0x8825)  # GPSInfo IFD
    except Exception:
        return None
    if not gps:
        return None
    lat = gps.get(2)
    lat_ref = gps.get(1)
    lng = gps.get(4)
    lng_ref = gps.get(3)
    if not lat or not lng:
        return None
    try:
        lat_d = to_degrees(lat)
        lng_d = to_degrees(lng)
    except (TypeError, ValueError):
        return None
    if str(lat_ref).upper().startswith("S"):
        lat_d = -lat_d
    if str(lng_ref).upper().startswith("W"):
        lng_d = -lng_d
    return round(lat_d, 6), round(lng_d, 6)


def get_datetime(img):
    """取出拍攝時間字串（優先 DateTimeOriginal）。"""
    try:
        exif = img.getexif()
        # 0x9003 = DateTimeOriginal（在 Exif 子 IFD 內）
        sub = exif.get_ifd(0x8769)
        raw = sub.get(0x9003) or exif.get(0x0132)  # 退回 DateTime
    except Exception:
        raw = None
    if not raw:
        return ""
    # EXIF 格式："2026:06:15 14:23:01" -> "2026-06-15 14:23:01"
    try:
        date_part, time_part = str(raw).split(" ", 1)
        return f"{date_part.replace(':', '-')} {time_part}"
    except ValueError:
        return str(raw)


def make_thumbs(img, display_dest, small_dest):
    """輸出兩種 JPEG 縮圖（含方向校正）：大圖給彈窗、小圖給清單／標記。"""
    base = ImageOps.exif_transpose(img).convert("RGB")
    display_dest.parent.mkdir(parents=True, exist_ok=True)

    disp = base.copy()
    disp.thumbnail((DISPLAY_MAX, DISPLAY_MAX))
    disp.save(display_dest, "JPEG", quality=DISPLAY_Q, optimize=True, progressive=True)

    small = base.copy()
    small.thumbnail((SMALL_MAX, SMALL_MAX))
    small.save(small_dest, "JPEG", quality=SMALL_Q, optimize=True, progressive=True)


def add_locations(photos):
    """依經緯度反查城市／地區／國家，寫回每張照片（離線）。"""
    if not photos:
        return
    if not RGC_OK:
        print("⚠ 未安裝 reverse_geocode，略過城市分類（清單將不分組）。")
        print("  若要分組，請執行：pip install reverse_geocode")
        return
    coords = [(p["lat"], p["lng"]) for p in photos]
    try:
        results = _rgc.search(coords)
    except Exception as e:  # noqa: BLE001 — 反查失敗不應中斷整批
        print(f"⚠ 城市反查失敗，略過分類：{e}")
        return
    for p, r in zip(photos, results):
        p["city"] = r.get("city") or ""
        p["region"] = r.get("state") or ""
        p["country"] = r.get("country") or ""
        p["cc"] = r.get("country_code") or ""


def load_existing_captions():
    """保留先前填寫的 title / note。

    回傳 (by_source, by_stem) 兩份對照表：
      by_source 以「photos/ 底下的相對路徑」為鍵，最精確；
      by_stem   以「檔名（不含副檔名）」為鍵，讓照片搬到不同分類資料夾後
                仍能對應回既有的標題與說明。
    查找時先比對 source，再退回 stem——同一資料夾內若有同名但不同副檔名的
    照片（例如 IMG_0229.heic 與 IMG_0229.JPG），才不會共用同一段說明。
    """
    if not DATA_FILE.exists():
        return {}, {}
    try:
        data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}, {}
    by_source, by_stem = {}, {}
    for p in data.get("photos", []):
        source = p.get("source") or ""
        stem = Path(source or p.get("id", "")).stem
        if not stem:
            continue
        title, note = p.get("title", ""), p.get("note", "")
        if title == stem:      # 標題只是檔名，視為未命名
            title = ""
        if not (title or note):
            continue
        cap = {"title": title, "note": note}
        if source:
            by_source[source] = cap
        by_stem.setdefault(stem, cap)
    return by_source, by_stem


def main():
    if not PHOTOS_DIR.exists():
        PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
        print(f"已建立 {PHOTOS_DIR}，請把照片放進去後再執行一次。")
        return

    files = sorted(
        f for f in PHOTOS_DIR.rglob("*")
        if f.is_file() and f.suffix.lower() in IMG_EXTS
    )
    if not files:
        print(f"在 {PHOTOS_DIR} 找不到照片。支援格式：{', '.join(sorted(IMG_EXTS))}")
        return

    heic_files = [f for f in files if f.suffix.lower() in {".heic", ".heif"}]
    if heic_files and not HEIC_OK:
        print("⚠ 偵測到 HEIC 照片，但未安裝 pillow-heif，這些照片會被略過。")
        print("  請執行：pip install pillow-heif")

    cap_by_source, cap_by_stem = load_existing_captions()
    photos = []
    used_ids = set()
    skipped_no_gps = []
    skipped_error = []

    for f in files:
        rel = f.relative_to(PHOTOS_DIR)
        pid = str(rel.with_suffix("")).replace("/", "__").replace("\\", "__")
        if pid in used_ids:
            # 同資料夾內同名不同副檔名（IMG_0229.heic / IMG_0229.JPG）：
            # 附上副檔名以免兩張照片共用同一個縮圖檔。
            pid = f"{pid}_{f.suffix.lstrip('.').upper()}"
        used_ids.add(pid)
        try:
            with Image.open(f) as img:
                gps = get_gps(img)
                if not gps:
                    skipped_no_gps.append(str(rel))
                    continue
                dt = get_datetime(img)
                thumb_rel = f"thumbs/{pid}.jpg"       # 大圖：彈窗顯示
                small_rel = f"thumbs/{pid}_sm.jpg"    # 小圖：清單／標記
                make_thumbs(img, ROOT / thumb_rel, ROOT / small_rel)
        except Exception as e:  # noqa: BLE001 — 單張照片壞掉不應中斷整批
            skipped_error.append(f"{rel}（{e}）")
            continue

        rel_key = str(rel).replace("\\", "/")
        cap = cap_by_source.get(rel_key) or cap_by_stem.get(f.stem, {})
        lat, lng = gps
        category = rel.parts[0] if len(rel.parts) > 1 else "未分類"
        photos.append({
            "id": pid,
            "title": cap.get("title") or f.stem,
            "note": cap.get("note", ""),
            "category": category,
            "lat": lat,
            "lng": lng,
            "datetime": dt,
            "image": thumb_rel,   # 大圖，彈窗用
            "thumb": small_rel,   # 小圖，清單／標記用
            "source": str(rel),
        })
        print(f"✓ {rel}  →  {lat}, {lng}")

    # 反查城市／地區（供清單分組與分城市下載）
    add_locations(photos)

    # 依時間排序（沒有時間的排在後面）
    photos.sort(key=lambda p: (p["datetime"] == "", p["datetime"]))

    # 清掉不再被引用的舊縮圖（例如照片搬到別的分類資料夾後留下的孤兒檔）
    used = {p["image"] for p in photos} | {p["thumb"] for p in photos}
    stale = [f for f in THUMBS_DIR.rglob("*.jpg")
             if str(f.relative_to(ROOT)).replace("\\", "/") not in used]
    for f in stale:
        f.unlink()

    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(
        json.dumps({"photos": photos}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print("\n────────── 完成 ──────────")
    print(f"已加入地圖：{len(photos)} 張")
    if stale:
        print(f"清除不再引用的舊縮圖：{len(stale)} 個")
    if skipped_no_gps:
        print(f"沒有 GPS 座標而略過：{len(skipped_no_gps)} 張")
        for s in skipped_no_gps:
            print(f"   - {s}")
    if skipped_error:
        print(f"讀取失敗而略過：{len(skipped_error)} 張")
        for s in skipped_error:
            print(f"   - {s}")
    print(f"\n資料已寫入：{DATA_FILE.relative_to(ROOT)}")
    print("用瀏覽器開啟 index.html（建議透過 GitHub Pages 或本機伺服器）即可看到地圖。")


if __name__ == "__main__":
    main()
