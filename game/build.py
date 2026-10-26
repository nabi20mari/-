"""Inline the scene pictures into the game page.

Reads src/hidden-picture.src.html and img/*.jpg, writes hidden-picture.html
(published as the Claude artifact) and index.html (for GitHub Pages).
"""
import base64, json, pathlib

here = pathlib.Path(__file__).parent
src = (here / 'src' / 'hidden-picture.src.html').read_text()
imgs = {p.stem: 'data:image/jpeg;base64,' + base64.b64encode(p.read_bytes()).decode()
        for p in sorted((here / 'img').glob('*.jpg'))}
page = src.replace('/*SCENE_IMGS*/{}', json.dumps(imgs))
(here / 'hidden-picture.html').write_text(page)
(here / 'index.html').write_text(
    '<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    '<meta name="apple-mobile-web-app-capable" content="yes">\n</head>\n<body>\n'
    + page + '\n</body>\n</html>\n')
print(f'{len(imgs)} pictures, {len(page) // 1024} KB')
