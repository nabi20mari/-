"""game.html(아티팩트용 본문)을 감싸서 GitHub Pages 등에서 바로 열 수 있는 index.html을 만듭니다."""
src = open("game.html", encoding="utf-8").read()
head = ('<!doctype html>\n<html lang="ko">\n<head>\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n')
open("index.html", "w", encoding="utf-8").write(head + src.replace("<style>", "</head>\n<body>\n<style>", 1) + "\n</body>\n</html>\n")
print("index.html written")
