import io
p = "style.css"
s = io.open(p, encoding="utf-8").read()
for i, line in enumerate(s.split("\n"), 1):
    if "gallery_films__tag" in line or "gallery_films__cta" in line:
        print(i, repr(line))
