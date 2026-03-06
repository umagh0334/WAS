# Changelog

모든 주요 변경사항을 버전별로 기록합니다.

---

## v1.0.5 (2026-01-27 ~ 현재)

### 신규 기능
- **섹션별 마스터 ON/OFF 토글** — EQ, Polish, Stereo, Loudness, Edit 섹션에 독립 토글 추가
- **High Cut 별도 토글** — 18kHz LPF를 Quick Fix에 "High Cut" 토글로 분리
- **Reverse Audio** — 오디오 역재생, FX 토글로 원본/역재생 즉시 전환
- **Tube Saturator** — 진공관 비대칭 waveshaping (tanh + atan) 짝수 하모닉 생성. 프리셋: 12AX7, 12AT7, 6L6, 12AU7
- **M/S Monitor Mode** — L/R ↔ M/S 모니터링 토글 (S 키). DSP 체인/익스포트 영향 없음
- **Mono File Guard** — 모노 파일 로드 시 Stereo View, M/S 모니터 자동 비활성화
- **EQ 주파수 응답 커브** — Canvas 기반 실시간 주파수 응답 시각화
- **Stereo Waveform View** — L/R 채널 분리 표시 토글
- **2x Waveform Height** — 파형 높이 2배 확대 (스테레오 뷰 조합 가능)
- **L/R Pan** — 좌우 채널 밸런스 조절 (-100L ~ +100R), 센터 스냅 ±5
- **Brickwall Limiter** — WaveShaperNode 기반 하드 클램프 모니터링 모드
- **32-bit Float Export** — IEEE_FLOAT 포맷 WAV 내보내기
- **96kHz Sample Rate** — 96kHz 출력 옵션 추가
- **Stem Extract UI** — 6-source 스템 분리 UI (Drums, Bass, Vocals, Guitars, Pianos, Instruments). Coming soon
- **키보드 단축키 추가** — S(M/S 모니터), M(모노 모니터), D(Dim 출력)

### 버그 수정
- A-B Loop 정지 상태 생성 시 재생 위치 오류
- 새 파일 로드 시 스테레오 뷰 오류
- 파형 수직 중앙 정렬 오류
- Reverse Audio + EQ 조합 시 미적용 버그
- Worker EQ 밴드 불일치 (5밴드 → 7밴드)
- Zoom 한 번에 여러 단계 점프
- Zoom In 초기값 과도하게 큰 문제
- Export 리샘플링 버그 (96kHz 2배속, 44.1kHz 늘어짐)
- Export 유효성 검증 누락 (96kHz, 32-bit)
- EQ 프리셋 버튼 위치 밀림 (border 불일치)
- Tube Saturator 프리셋 마스터링 그레이드 재조정

### UI/UX 개선
- Auto Level을 Quick Fix → Loudness 섹션으로 이동
- Output 섹션 헤더 표준화
- EQ/Output 프리셋 버튼 하단 정렬
- Waveform 커스텀 스크롤바 (Shadow DOM 대응)
- A-B Loop 커서 기반 기본 구간 (10초)
- 모달 활성 시 배경 스크롤 차단
- 시간 표시 포맷 통일 (`0:00:00`)
- Target LUFS 기본값 -15 LUFS로 변경
- Stereo Scope 섹션 disabled 시에도 항상 활성 표시

### 코드 품질 & 보안
- Dead code 삭제 (encoder.js, waveform.js)
- WAV 인코딩 3중 중복 → 1개 통합
- Barrel export 정리 (90+ → 24)
- Legacy DSP 모듈 이동 (web/dsp/ → web/lib/dsp/)
- 바이쿼드 필터 통합 (biquad.js, 6개 파일 중복 제거)
- CSP, Electron sandbox, DevTools 게이팅
- Navigation guard + Path allowlist
- 접근성: 18개 aria-label, 3개 role="dialog"
- LUFS NaN/-Infinity 가드
- DSP 체인 renderer↔worker 일관성 수정
- 의존성 보안 취약점 수정

---

## v1.0.4 (2026-01-26)

### 신규 기능
- **Waveform Zoom** — 400~800 pps, 키보드(+/-/0) 및 Ctrl+Wheel
- **A-B Loop** — Shift+드래그 구간 선택, L 키 토글, 드래그 프리뷰
- **Repeat** — 전체 곡 반복 재생 (R 키)
- **Apply 버튼** — 설정 변경 후 캐시 생성
- **Keyboard Shortcuts 모달** — ⓘ 버튼
- **EQ 7밴드 확장** — 5밴드 → 7밴드 (60/150/400/1k/3k/8k/16kHz)

### 버그 수정 & 개선
- 모달 활성화 시 입력 차단
- 헤더 고정 (Sticky Header)
- Apply 시작 시 재생 중지
- Export 모달 레이아웃 개선
- 재생 중 A-B 루프 즉시 재생
- Fader 0.0dB 스냅 (자석 효과)
- 버튼 색상 통일 (OFF: 회색, ON: 주황색)
- 시간 표시 mm:ss:ms, waveform 상단 이동
- 더블클릭 Stop 리셋

---

## v1.0.3

### 신규 기능
- Apply 버튼 UI 및 캐시 렌더링 워크플로우
- Waveform Zoom + 키보드/마우스 지원
- A-B Loop + 드래그 프리뷰
- Repeat 기능

### 버그 수정
- FX 바이패스 토글 후 미터/스크러버 멈춤 현상 수정
- Export 진행률 표시 멈춤 → WAV 인코딩 단계까지 부드럽게 업데이트
- Chromium 컴프레서 ratio 값 경고 스팸 해결 (클램핑 처리)

### 변경사항
- 마스터 프리뷰 (FX ON) 시 캐시된 풀 체인 렌더 사용 → Export와 동일한 결과
- GitHub Pages 배포: raw `web/` 대신 번들된 `dist/` 빌드 및 배포
- 레포 구조 정리: 미사용 legacy `src/` 및 중복 루트 에셋 제거, `web/`을 단일 소스로 통합

### UI 개선
- 시간 표시, 버튼 색상, FX 상태 수정
- 더블클릭 Stop 리셋
- Keyboard Shortcuts 모달
