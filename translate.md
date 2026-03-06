# UI Translation Guide

## Buttons & Controls
Keyboard Shortcuts : 키보드 단축키
Zoom Out : 축소 (-)
Zoom In : 확대 (+)
Reset Zoom : 줌 초기화 (0)
Play/Pause : 재생/일시정지 (Space)
Stop : 정지 (Shift+Space)
Toggle Repeat : 반복 재생 (R)
A-B Loop : A-B 구간 반복 (Shift+드래그로 구간 선택)
L/R / M/S Input : 입력 모드 전환 - L/R (좌우 스테레오) 또는 M/S (중앙-측면) 디코딩 (출시 예정)
Level Match : 레벨 매칭 (프리뷰가 정규화된 오디오 사용)
Toggle Effects (FX) : 효과 켜기/끄기
Toggle Spectrogram : 스펙트로그램 표시

---

## Status Badges
DC offset was detected and removed : DC 오프셋이 감지되어 제거되었습니다
Audio has been edited in this session : 이 세션에서 오디오가 편집되었습니다

---

## Quick Fix Section
Glue Compression : 멀티밴드 압축으로 믹스를 하나로 묶고 균형잡힌 주파수 제어를 제공합니다.
De-harsh : 멀티밴드 다이나믹 프로세서: 치찰음 제거, 공명 완화, 3-12kHz 범위의 AI 아티팩트를 부드럽게 처리합니다.
Clean Low End : 30Hz 이하의 서브베이스 럼블을 제거하고 DC 오프셋을 수정합니다.
High Cut : 18kHz 이상의 초고주파를 제거하여 더 깨끗한 사운드를 만듭니다.
Add Punch : 멀티밴드 트랜지언트 셰이퍼: 킥에 펀치(저역), 스네어에 스냅(중역)을 추가하고 고역은 그대로 유지합니다.

---

## Stereo Section
Width : 스테레오 폭: 0% = 모노, 100% = 원본, 200% = 매우 넓음
Mono Bass : 클럽/스피커 모노 호환성을 위해 약 200Hz 이하의 저음을 좁힙니다.
Phase Invert : 모든 채널의 극성을 반전합니다. 일반적인 용도로는 권장하지 않으며, 위상 보정이나 모노 호환성 테스트에만 사용하세요.

---

## Polish Section
Cut Mud : 명료도를 위해 250Hz 주변의 탁한 주파수를 감소시킵니다.
Add Air : 12kHz 하이 셸프 부스트로 반짝임과 밝기를 추가합니다.
Tape Warmth : 아날로그 온기를 위한 미묘한 테이프 스타일 새츄레이션을 추가합니다.
Tube Saturator : 진공관 앰프의 비선형 특성을 시뮬레이션하여 음악적인 하모닉을 추가합니다 (출시 예정)

---

## Output Section
Sample Rate : 48kHz는 배급사가 선호합니다. 인코딩 파이프라인을 통해 더 나은 품질을 제공합니다.
Bit Depth : 24비트는 배급사가 선호합니다. 인코딩 과정에서 더 많은 헤드룸을 제공합니다.
Streaming : 44.1kHz/16-bit - 스트리밍 플랫폼(Spotify, Apple Music)을 위한 표준 품질
Studio : 48kHz/24-bit - 스튜디오 음악 제작 및 비디오 편집을 위한 전문가급 품질

---

## Loudness Section
Input Gain : 처리 전 입력 레벨을 조정합니다. 더블클릭하면 0dB로 초기화됩니다.
Ceiling : 최대 피크 레벨. -1dB가 스트리밍 표준입니다.
Auto Level : 조용한 섹션과 큰 섹션의 균형을 맞추는 지능형 게인 자동화입니다.
Normalize Loudness : 목표 LUFS로 라우드니스를 정규화합니다. Spotify는 -14, 더 큰 마스터는 -9입니다.
Target : 목표 라우드니스: -16(조용함) ~ -6(큼). -14는 Spotify 표준, -9는 현대 마스터링의 일반적인 값입니다.
True Peak Limit : 피크를 천장 값으로 제한하여 오디오가 클리핑되는 것을 방지합니다.

---

## Edit Section
Reverse Audio : 전체 오디오를 역재생합니다. 리버스 효과를 만들고 숨겨진 콘텐츠를 드러냅니다.
Insert Silence : 커서 위치에 무음을 삽입합니다 (출시 예정)

---

## EQ Section
60Hz (Sub Bass) : 60Hz에서 로우 셸프
150Hz (Low) : 150Hz에서 피크
400Hz (Low-Mid) : 400Hz에서 피크
1kHz (Mid) : 1kHz에서 피크
3kHz (High-Mid) : 3kHz에서 피크
8kHz (High) : 8kHz에서 피크
16kHz (Air) : 16kHz에서 하이 셸프
