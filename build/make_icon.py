from PIL import Image, ImageDraw

SIZE = 1024
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

paper = (251, 246, 236, 255)
line = (228, 220, 200, 255)
accent = (59, 110, 113, 255)

margin = 80
radius = 60
draw.rounded_rectangle(
    [margin, margin, SIZE - margin, SIZE - margin],
    radius=radius,
    fill=paper,
    outline=line,
    width=6,
)

tape_w, tape_h = 300, 90
tape = Image.new("RGBA", (tape_w, tape_h), (0, 0, 0, 0))
tape_draw = ImageDraw.Draw(tape)
tape_draw.rectangle([0, 0, tape_w, tape_h], fill=(accent[0], accent[1], accent[2], 150))
tape = tape.rotate(-6, expand=True, resample=Image.BICUBIC)
img.alpha_composite(tape, (int(SIZE / 2 - tape.width / 2), margin - int(tape.height * 0.45)))

lines_y_start = int(SIZE * 0.42)
for i in range(3):
    y = lines_y_start + i * 90
    draw.line([(margin + 90, y), (SIZE - margin - 90, y)], fill=line, width=14)

img.save("/home/claude/daily-sticky-note/build/icon.png")
print("done")
