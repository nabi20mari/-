# 틀린그림 찾기

진짜 사진으로 하는 틀린그림 찾기. 태블릿 한 대로 2~3명이 함께 해요.

## 하는 법
`index.html` 을 브라우저(태블릿의 크롬·사파리)로 열면 바로 됩니다. 설치는 필요 없어요.

- **차례대로 대결**: 한 사람씩 돌아가며 하나를 찾아요. 찾으면 1점, 세 번 틀리거나 시간이 끝나면 다음 사람.
- **다 같이 협동**: 제한 시간 안에 모두 찾기. 틀리면 5초가 줄어요. 남은 시간으로 별 1~3개.
- **⭐ 도움**: 사람마다 켤 수 있어요. 시간 +15초, 힌트 +2번.
- **난이도**: 쉬움 5개 / 보통 7개 / 어려움 9개 (어려울수록 작고 미묘한 차이)
- **내 사진으로 만들기**: 태블릿으로 찍거나 고른 사진에서 틀린 곳을 자동으로 만들어요 (실험 기능).

## 사진 퍼즐 만들기 (개발용)
기본 사진의 틀린 곳은 사람이 하나하나 정해서 만듭니다.

```
pip install opencv-python-headless numpy
python3 tools/make_puzzle.py --grid tools/src/사진.jpg grid.jpg   # 좌표 확인용 격자
python3 tools/make_puzzle.py tools/specs/사진.json                # 퍼즐 만들기
python3 tools/make_puzzle.py --all                                # 전부 다시 만들기
```
명세 형식은 `tools/make_puzzle.py` 맨 위 설명을 보세요. 결과는 `photos/<id>/` 와 `js/puzzles.js` 에 저장되고, 확인용 그림은 `tools/preview/` 에 생겨요.

## 검사
```
node tests/smoke.js
```
(Playwright 필요) 실제 브라우저로 한 판을 끝까지 해 보며 점수·차례·힌트·시간·화면 배치를 확인해요.
