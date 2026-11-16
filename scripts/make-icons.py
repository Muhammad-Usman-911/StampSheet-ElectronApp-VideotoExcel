# Builds the app/site icons from the client's logo (build/logo.png): the emblem (no text) centred on a rounded
# black tile. Usage: python3 scripts/make-icons.py build/logo.png <out dir>
# Then copy: icon-1024.png -> build/icon.png, icon-256.png -> ui/src/assets/logo-mark.png, and for the website
# (../ocrXtrackWeb) icon-512.png -> src/app/icon.png, icon-180.png -> src/app/apple-icon.png, favicon.ico ->
# src/app/favicon.ico, icon-256.png -> src/components/logo-mark.png.
import sys
from PIL import Image, ImageDraw
src, out = sys.argv[1], sys.argv[2]
logo = Image.open(src).convert('RGBA')
emblem = logo.crop((440, 114, 1130, 652))          # camera + document + sheet + ring, without the wordmark
S = 1024
tile = Image.new('RGBA', (S, S), (0, 0, 0, 255))
scale = 820 / emblem.width
e = emblem.resize((round(emblem.width * scale), round(emblem.height * scale)), Image.LANCZOS)
tile.paste(e, ((S - e.width) // 2, (S - e.height) // 2 + 8), e)
mask = Image.new('L', (S * 4, S * 4), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, S * 4 - 1, S * 4 - 1), radius=S * 4 * 0.2, fill=255)
tile.putalpha(mask.resize((S, S), Image.LANCZOS))
tile.save(f'{out}/icon-1024.png')
for n in (512, 256, 180, 64):
    tile.resize((n, n), Image.LANCZOS).save(f'{out}/icon-{n}.png')
tile.save(f'{out}/favicon.ico', sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
