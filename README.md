# Web Audio Mastering

![Version](https://img.shields.io/badge/version-1.0.5-blue)
![Electron](https://img.shields.io/badge/Electron-39-47848F?logo=electron&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-F7DF1E?logo=javascript&logoColor=black)
![Web Audio API](https://img.shields.io/badge/Web_Audio_API-DSP-FF6600)
![License](https://img.shields.io/badge/license-ISC-green)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?logo=electron&logoColor=white)

AI 생성 음악(Suno, Udio 등) 또는 기타 오디오를 스트리밍 특화 품질로 마스터링하는 데스크톱 앱입니다. <br>OVEN 탑재 전, 기능개발을 위한 오리지널 프로젝트입니다.

## 기능

### 재생 & 모니터링
- **FX / Bypass** - 빠른 전후 비교, 공정한 음량 비교를 위한 선택적 **Level Match**
- **Waveform + Scrub** - 클릭 투 시크 파형과 스크러버
- **Waveform Zoom** - 줌 기능(400~800 pps), 단축키(+/-/0) 또는 Ctrl+Wheel 제어
- **Stereo Waveform View** - L/R 채널 분리 표시 토글 (모노 파일 자동 비활성화)
- **2x Waveform Height** - 파형 높이 2배 확대 (스테레오 뷰 조합 가능)
- **M/S Monitor Mode** - L/R ↔ M/S 모니터링 토글 (S 키). DSP 체인/익스포트 영향 없음
- **A-B Loop** - Shift+드래그 구간 선택, L 키 토글
- **Repeat** - 전체 곡 반복 재생 (R 키)
- **Spectrogram (Live)** - 실시간 주파수 히트맵
- **Full-chain Metering** - 실시간 스테레오 피크 측정
- **DC Offset Detection** - 로드 시 DC 오프셋 감지 및 자동 제거

### Quick Fix
- **Glue Compression** - 멀티밴드 컴프레서로 믹스를 하나로 붙이기
- **De-harsh** - 3~12kHz 대역의 거친 음, 공명, AI 아티팩트 억제 (멀티밴드 다이나믹 프로세서)
- **Clean Low End** - 30Hz 이하 서브베이스 럼블 제거 및 DC 오프셋 보정
- **High Cut** - 18kHz 이상 초고역 제거
- **Add Punch** - 멀티밴드 트랜지언트 셰이퍼로 킥/스네어에 펀치 추가

### Polish
- **Cut Mud** - 250Hz 주변 탁한 주파수 감소
- **Add Air** - 12kHz 고음역 부스트로 밝기 추가
- **Tape Warmth** - 아날로그 테이프 스타일 새츄레이션
- **Tube Saturator** - 진공관 비대칭 waveshaping (tanh + atan) 짝수 하모닉 생성. 프리셋: 12AX7(Warm), 12AT7(Bright), 6L6(Fat), 12AU7(Clean). Drive/Mix 슬라이더 포함

### EQ
- **7-Band Parametric EQ** - 60Hz, 150Hz, 400Hz, 1kHz, 3kHz, 8kHz, 16kHz
- **EQ Frequency Response Curve** - 실시간 주파수 응답 시각화
- **EQ Presets** - Flat, Vocal Boost, Bass Boost, Bright, Warm, AI Fix

### Stereo
- **Stereo Width** - 스테레오 이미지 조절 (0% 모노 ~ 200% 초와이드), 실시간 프리뷰
- **Pan** - L/R 채널 볼륨 밸런스 조절, 센터 스냅 지원
- **Center Bass** - ~200Hz 이하 베이스를 모노로 좁혀 클럽/스피커 호환성 향상
- **Phase Invert** - 위상 반전으로 위상 문제 수정

### Loudness
- **Input Gain** - 처리 전 입력 레벨 조정 (-12dB ~ +12dB)
- **Target LUFS** - 목표 음량 설정 (기본 -15 LUFS)
- **Ceiling** - 최대 피크 레벨 (-3dB ~ 0dB)
- **Auto Level** - 조용한/큰 구간 균형을 맞추는 지능형 게인 자동화
- **Normalize Loudness** - 목표 LUFS로 자동 정규화
- **Maximizer** - Soft Clipper + Lookahead Limiter로 피크 제한
- **True Peak** - 4x 오버샘플링 인터샘플 피크 감지 (방송 규격)

### Edit
- **Reverse Audio** - 오디오 역재생, FX 토글로 원본/역재생 즉시 전환
- **Stem Extract** - 6-source 스템 분리: Drums, Bass, Vocals, Guitars, Pianos, Instruments (Coming soon)

### Output
- **Monitor Mode** - Normal / Brickwall 모니터링 모드 (VU Meter 정확도)
- **Sample Rate** - 44.1kHz / 48kHz / 96kHz
- **Bit Depth** - 16-bit / 24-bit / 32-bit float
- **Output Presets** - Streaming (44.1kHz/16-bit), Studio (48kHz/24-bit)
- **High-Quality WAV Export** - 모든 처리가 적용된 무손실 출력

DSP 신호 체인에 대한 자세한 내용은 [DSP-SIGNAL-CHAIN.md](DSP-SIGNAL-CHAIN.md)를 참조하세요.

## 사용법

1. 오디오 파일(MP3, WAV, FLAC, AAC, M4A) 드래그 & 드롭
2. 내장 플레이어로 미리보기
3. EQ 및 마스터링 설정 조정
4. FX/Bypass 토글하여 전후 비교
5. "Export" 클릭

### 키보드 단축키

**재생 제어**
- `Space` - 재생/일시정지
- `Shift+Space` - 정지 (두 번째 누르면 처음으로 리셋)
- `R` - 반복 재생 토글
- `L` - A-B 루프 토글

**모니터링**
- `S` - M/S 모니터 모드 토글
- `M` - 모노 모니터 토글
- `D` - Dim 출력 토글

**Waveform 제어**
- `+` / `-` / `0` - 줌 인/아웃/리셋
- `Ctrl+Wheel` - 줌 인/아웃
- `Shift+드래그` - A-B 루프 구간 선택
- 일반 클릭 - 재생 위치 이동

**도움말**
- Info 버튼(ⓘ) - 모든 단축키 확인

## 소스에서 빌드

```bash
# 의존성 설치
npm install

# 개발 중 실행
npm start

# 네트워크의 다른 기기에서 접근 가능하도록 개발 서버 실행
npm run dev -- --host 0.0.0.0

# 웹 출력 빌드(GitHub Pages / 정적 호스팅)
npm run build:web

# 로컬에서 프로덕션 빌드 미리보기
npm run preview

# 플랫폼별 빌드
npm run build:win    # Windows
npm run build:mac    # macOS (Mac 필요)
npm run build:linux  # Linux
```

## 기술 스택

- Electron 39
- Vite 7(빌드 시스템)
- Web Audio API(미리보기 및 내보내기 처리)
- Pure JavaScript LUFS 측정(ITU-R BS.1770-4)
- WaveSurfer.js(파형 시각화)

## 라이선스
```
ISC License

Copyright (c) wyatt

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.
```
