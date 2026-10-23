from PIL import Image, ImageDraw
import os, sys

W = H = 256
S = 4  # supersample
img = Image.new("RGBA", (W*S, H*S), (0,0,0,0))
d = ImageDraw.Draw(img)

# rounded square background, indigo
def rr(box, r, fill):
    d.rounded_rectangle(box, radius=r, fill=fill)

rr((8*S, 8*S, 248*S, 248*S), 56*S, (79, 70, 229, 255))
# inner lighter panel = notebook page
rr((44*S, 36*S, 212*S, 220*S), 26*S, (255, 255, 255, 255))
# spine
d.rounded_rectangle((44*S, 36*S, 76*S, 220*S), radius=26*S, fill=(99, 102, 241, 255))
d.rectangle((66*S, 36*S, 76*S, 220*S), fill=(99, 102, 241, 255))

# lines of text
for i, y in enumerate([78, 112, 146]):
    w = [120, 100, 110][i]
    d.rounded_rectangle((96*S, y*S, (96+w)*S, (y+14)*S), radius=7*S, fill=(203, 213, 225, 255))

# red cross mark (a wrong answer) at bottom right
cx, cy = 176, 178
d.line([(cx-18)*S, (cy-18)*S, (cx+18)*S, (cy+18)*S], fill=(239, 68, 68, 255), width=11*S)
d.line([(cx+18)*S, (cy-18)*S, (cx-18)*S, (cy+18)*S], fill=(239, 68, 68, 255), width=11*S)

img = img.resize((W, H), Image.LANCZOS)
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dsh-plugin", "icon.png")
img.save(out, "PNG", optimize=True)
print("wrote", os.path.abspath(out), os.path.getsize(out))