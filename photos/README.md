# photos/ — 放原始照片的地方

把你要放上地圖的照片（iPhone HEIC 或 JPEG）放進這個資料夾，
可以直接放，也可以用子資料夾分類（例如按街道或案例分類）。

接著執行：

```bash
pip install -r scripts/requirements.txt
python scripts/build_map.py
```

腳本會：

1. 從每張照片的 EXIF 讀出 GPS 經緯度
2. 產生縮圖到 `thumbs/`（HEIC 會自動轉成 JPEG）
3. 更新 `data/photos.json`

沒有 GPS 座標的照片會被略過，並在執行結果中列出。

> 若你已在 GitHub 上啟用 `Build map` Action，只要把照片上傳到這個資料夾並 commit，
> 地圖就會自動更新，不需要在本機執行任何指令。
