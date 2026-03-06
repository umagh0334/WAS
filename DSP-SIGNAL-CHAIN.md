# DSP 신호 체인 문서

## 개요

이 문서는 Web Audio Mastering 애플리케이션의 오디오 처리 신호 체인을 설명합니다.

이 앱은 **내보내기-프리뷰 동등성(export-parity master preview)** 개념을 중심으로 구축되었습니다: FX ON 재생, 미터링, 내보내기 모두 동일한 전체 체인 렌더링을 사용합니다.

## 처리 아키텍처

앱은 세 가지 핵심 버퍼를 유지합니다:

- `originalBuffer`: 디코딩된 입력 오디오 (DC 오프셋 제거됨)
- `normalizedBuffer`: LUFS로 정규화된 복사본, FX OFF (레벨 매칭) 전용 및 최후 대안으로 사용
- `cachedRenderBuffer`: 전체 체인 마스터링 프리뷰 버퍼 (활성화 시 소프트 클립 + 최종 트루 피크 리미터 포함)

**전체 체인 렌더링이 발생하는 곳:**

- 우선: Web Worker 전체 체인 렌더 (`web/workers/dsp-worker.js`, `renderFullChain(..., mode: 'export')`)
- 대체: 메인 스레드 오프라인 렌더 (`web/ui/renderer.js`)

## 신호 흐름

### 재생 라우팅 (FX 토글)

- **FX ON (마스터 프리뷰):** `cachedRenderBuffer` -> 출력 (직접)
- **FX OFF (바이패스):**
  - Level Match ON: `normalizedBuffer` -> 출력
  - Level Match OFF: `originalBuffer` -> 출력

미터는 실제 재생 중인 오디오를 따라가므로, FX ON이 활성화되어 있으면 리미터가 프리뷰 버퍼에 적용되어 있기 때문에 미터에 최종 리미터 동작이 포함됩니다.

### 전체 체인 처리 순서 (마스터 프리뷰 + 내보내기)

이것은 동등성을 위한 표준 순서입니다 (Worker 경로).

1. Input Gain (입력 게인)
2. Phase Invert (위상 반전) (선택적, Stereo 섹션 활성화 시)
3. Reverse Audio (역재생) (선택적, Edit 섹션 활성화 시)
4. Dynamic Processor (De-harsh, 거친 소리 제거) (선택적)
5. Exciter (Add Air, 공기감 추가) (선택적, Polish 섹션 활성화 시)
6. Multiband Saturation (Tape Warmth, 테이프 온기) (선택적, Polish 섹션 활성화 시)
7. Tube Saturator (진공관 새츄레이터) (선택적, Polish 섹션 활성화 시)
8. Multiband Transient Shaper (Add Punch, 펀치 추가) (선택적)
9. Auto Level (동적 레벨링) (선택적, Loudness 섹션 활성화 시)
10. Final Filters (정리)
    - HPF 30 Hz (Clean Low End 활성화 시에만)
    - LPF 18 kHz (High Cut 활성화 시에만)
11. EQ (7-band) + Cut Mud (선택적)
12. Glue Compression (선택적)
13. Stereo Processing (스테레오 처리)
    - M/S Stereo Width
    - Center Bass (~200 Hz 이하 저음 모노화) (선택적)
14. LUFS 정규화 (게인만 적용) (선택적)
15. Mastering soft clipper (Maximizer 활성화 시) (선택적)
16. Lookahead true peak limiter (Maximizer 활성화 시) (선택적)

---

## 2. Phase Invert (위상 반전)

**파일:** `web/lib/dsp/phase.js`

**목적:** 모든 샘플의 극성을 반전시킵니다 (위상 180도 회전).

**기본값:** 비활성화

**알고리즘:**
- 각 채널의 모든 샘플에 -1을 곱하여 극성 반전
- Non-destructive: 새 버퍼 생성

**용도:** 위상 문제 진단, 녹음 시 발생한 극성 오류 수정.

---

## 3. Reverse Audio (역재생)

**파일:** `web/lib/dsp/reverse.js`

**목적:** 오디오 버퍼의 샘플 순서를 역순으로 변환합니다.

**기본값:** 비활성화

**알고리즘:**
- 각 채널 독립적으로 샘플 순서 역전
- Non-destructive: 새 버퍼 생성
- FX 토글로 원본/역재생 즉시 전환 가능

---

## 4. Dynamic Processor (De-harsh, 거친 소리 제거)

**파일:** `web/lib/dsp/dynamic-processor.js`

**목적:** 다음을 결합한 지능형 멀티밴드 다이나믹 프로세서:
- **Multiband Compression** (밴드별 어택/릴리스를 가진 7 밴드)
- **Dynamic EQ** (공명 감지 및 수술적 피크 커팅)
- **De-esser behavior** (3-12kHz 범위에서 빠른 어택)

**기본값:** 활성화 - AI 생성 오디오에 필수적

### 주파수 밴드

| 밴드 | 주파수 범위 | 어택 | 릴리스 | 임계값 | 비율 | 목적 |
|------|------------|------|--------|--------|------|------|
| **Sub** | 0-80 Hz | 30ms | 200ms | -12 dB | 2:1 | 부드러운 제어 |
| **Bass** | 80-250 Hz | 20ms | 150ms | -15 dB | 2.5:1 | 저음 타이트하게 |
| **Low-mid** | 250-1000 Hz | 10ms | 100ms | -18 dB | 3:1 | 탁함 제어 |
| **Mid** | 1-3 kHz | 8ms | 80ms | -20 dB | 3.5:1 | 프레즌스 제어 |
| **Presence** | 3-6 kHz | 3ms | 40ms | -24 dB | 5:1 | 디에서 영역 |
| **Brilliance** | 6-12 kHz | 2ms | 30ms | -26 dB | 6:1 | AI 아티팩트 영역 |
| **Air** | 12-20 kHz | 5ms | 50ms | -22 dB | 3:1 | 고주파 제어 |

### 주요 기능

**공명 감지:**
- 빈별 평균 스펙트럼 추적
- 로컬 평균의 1.5배 이상인 피크 식별
- 공명 주파수에 수술적 다이나믹 컷 적용

**AI 아티팩트 모드:**
- 5-12kHz 범위에서 50% 더 공격적인 처리
- AI 오디오 아티팩트가 주로 존재하는 영역

**마스터링 프리셋 (기본값):**
- Dynamic EQ 민감도: 0.4
- 최대 컷: -8 dB
- 소프트 니 (+4 dB 더 넓음)
- 투명도를 위한 70% wet / 30% dry

### 알고리즘

1. FFT를 통해 신호를 7개의 주파수 밴드로 분할
2. 밴드별 엔벨로프 팔로워가 신호 레벨 추적
3. 소프트 니 게인 컴퓨터가 압축 결정
4. 공명 감지기가 평균에서 튀어나온 피크 발견
5. Dynamic EQ가 공명 빈에 추가 컷 적용
6. 빈별 게인 적용과 함께 오버랩-애드 재구성

---

## 5. Exciter (Add Air, 공기감 추가)

**파일:** `web/lib/dsp/exciter.js`

**목적:** 고주파수에 하모닉 콘텐츠를 추가하여 명료도와 프레즌스("공기감")를 향상시킵니다.

**기본값:** 활성화

**파라미터:**
| 파라미터 | 값 | 설명 |
|----------|-----|------|
| `hpfFreq` | 3500 Hz | 하이패스 필터 차단 주파수 |
| `hpfSlope` | 12 dB/oct | 필터 기울기 (LR2) |
| `drive` | 2.0 | 새츄레이션 드라이브 양 |
| `bias` | 0.1 | 짝수 하모닉용 바이어스 |
| `mix` | 18% | 병렬 믹스 (가산) |

**알고리즘:**
1. 하이패스 필터가 3.5kHz 이상의 주파수 격리
2. 바이어스가 있는 Tanh 새츄레이션이 하모닉 생성
3. 병렬 추가: `output = dry + (saturated * mix)`

**특성:** 거칠지 않으면서 프레즌스와 반짝임 추가.

---

## 6. Multiband Saturation (Tape Warmth, 테이프 온기)

**파일:** `web/lib/dsp/multiband-saturation.js`

**목적:** 주파수 의존적 새츄레이션을 가진 따뜻한 하모닉 색채.

**기본값:** 활성화

**크로스오버 주파수:**
| 밴드 | 주파수 범위 |
|------|------------|
| Low | 0 - 200 Hz |
| Mid | 200 Hz - 4 kHz |
| High | 4 kHz+ |

**Tape Warmth 프리셋:**
| 밴드 | 드라이브 | 바이어스 | 믹스 | 게인 |
|------|----------|---------|------|------|
| Low | 0.2 | 0.0 | 30% | 0 dB |
| Mid | 0.4 | 0.1 | 50% | 0 dB |
| High | 0.3 | 0.05 | 40% | 0 dB |

**바이패스 엔벨로프:**
| 파라미터 | 값 | 설명 |
|----------|-----|------|
| Threshold | -24 dB | 이 아래에서는 새츄레이션 바이패스 |
| Knee | 6 dB | 소프트 전환 영역 |
| Window | 100 ms | 분석 윈도우 |
| Lookahead | 5 ms | 트랜지언트 전에 엔벨로프 열림 |

**알고리즘:**
1. Linkwitz-Riley LR4 크로스오버 (-24 dB/oct)가 3개 밴드로 분할
2. 각 밴드: `wet = (tanh(drive * (sample + bias)) - biasOffset) * makeup`
3. 바이패스 엔벨로프가 조용한 섹션의 새츄레이션 방지 (노이즈 증폭 방지)
4. 밴드를 다시 합산

---

## 7. Tube Saturator (진공관 새츄레이터)

**파일:** `web/lib/dsp/tube-saturator.js`

**목적:** 비대칭 waveshaping을 사용하여 짝수 하모닉을 생성하는 진공관 에뮬레이션.

**기본값:** 비활성화

**프리셋:**
| 프리셋 | 모델 | 특성 |
|--------|------|------|
| 12AX7 | Warm | 따뜻하고 풍성한 새츄레이션 |
| 12AT7 | Bright | 밝고 선명한 하모닉 |
| 6L6 | Fat | 두텁고 풍부한 저음 |
| 12AU7 | Clean | 깨끗하고 미묘한 색채 |

**파라미터:**
| 파라미터 | 설명 |
|----------|------|
| Drive | 새츄레이션 강도 (~15-35%, 마스터링 그레이드) |
| Mix | 병렬 믹스 (~12-25%, 마스터링 그레이드) |

**알고리즘:**
- 비대칭 waveshaping: `tanh` + `atan` 조합
- 짝수 하모닉 생성 (2차, 4차 등) — 아날로그 진공관 특성
- 프리셋별 드라이브/바이어스/믹스 조합으로 다양한 톤 컬러

---

## 8. Multiband Transient Shaper (Add Punch, 펀치 추가)

**파일:** `web/lib/dsp/multiband-transient.js`

**목적:** 펀치와 스냅을 위한 밴드별 트랜지언트 향상.

**기본값:** 활성화

**크로스오버 주파수:**
| 밴드 | 주파수 범위 |
|------|------------|
| Low | 0 - 200 Hz |
| Mid | 200 Hz - 4 kHz |
| High | 4 kHz+ |

**밴드 설정:**
| 밴드 | 빠른 어택 | 빠른 릴리스 | 느린 어택 | 느린 릴리스 | 트랜지언트 게인 | 서스테인 게인 |
|------|-----------|-------------|-----------|-------------|----------------|--------------|
| Low | 5 ms | 50 ms | 25 ms | 250 ms | +5 dB | -2 dB |
| Mid | 3 ms | 40 ms | 20 ms | 200 ms | +4 dB | 0 dB |
| High | 5 ms | 30 ms | 15 ms | 150 ms | 0 dB | 0 dB |

**알고리즘:**
1. 빠르고 느린 엔벨로프 팔로워가 신호 추적
2. 트랜지언트 감지: `diff = fastEnv - slowEnv`
3. 양수 차이 = 트랜지언트 -> 부스트
4. 음수 차이 = 서스테인 -> 컷 (선택적)
5. 아티팩트 방지를 위한 20ms 스무딩

**특성:**
- Low 밴드: 킥/베이스 펀치 추가
- Mid 밴드: 스네어/보컬 어택 추가
- High 밴드: 그대로 유지 (거친 소리 방지)

---

## 9. Auto Level (동적 레벨링)

**파일:** `web/lib/dsp/dynamic-leveler.js`

**목적:** 조용한 구간과 큰 구간의 레벨 차이를 줄이는 지능형 게인 자동화.

**기본값:** 비활성화

**알고리즘:**
- 구간별 라우드니스 분석
- 조용한 구간은 부스트, 큰 구간은 감쇠
- 자연스러운 다이나믹스 유지하면서 전체 레벨 균형 개선

**용도:** 곡 내 섹션 간 볼륨 편차가 큰 경우 자동 레벨링.

---

## 10. Final Filters (최종 필터)

**파일:** `web/lib/dsp/final-filters.js` (applyFinalFilters)

**목적:** 라우드니스/피크 제어 전에 주파수 극단을 정리합니다.

**전체 체인 렌더에서 적용:**
| 필터 | 활성화 시점 | 타입 | 주파수 | 기울기 |
|------|-----------|------|--------|--------|
| HPF | Clean Low End | Highpass (biquad) | 30 Hz | 12 dB/oct |
| LPF | High Cut | Lowpass (1-pole) | 18 kHz | 6 dB/oct |

**논리:**
- HPF는 서브 베이스 럼블과 DC 오프셋 잔여물 제거
- LPF는 인터샘플 피크를 유발할 수 있는 초음파 콘텐츠 제거

---

## 14. LUFS 정규화

**파일:** `web/lib/dsp/normalizer.js`, `web/lib/dsp/lufs.js`

**목적:** ITU-R BS.1770-4에 따라 목표 통합 라우드니스로 정규화합니다.

**기본값:** 활성화

**파라미터:**
| 파라미터 | 기본값 | 설명 |
|----------|--------|------|
| Target LUFS | -14 LUFS | 사용자 설정 가능 (-16 ~ -6) |
| Ceiling | -1 dBTP | 트루 피크 천장 |

**알고리즘 (ITU-R BS.1770-4):**
1. K-weighting 필터:
   - High shelf: 1681.97 Hz, +4 dB, Q=0.71
   - High pass: 38.14 Hz, Q=0.5
2. 75% 오버랩이 있는 400ms 블록
3. 절대 게이트: -70 LUFS
4. 상대 게이트: 게이팅되지 않은 평균보다 -10 dB 아래
5. 게이팅된 블록에서 통합 라우드니스

**게인 적용:**
1. 필요한 게인 계산: `targetLUFS - currentLUFS`
2. 모든 샘플에 게인 적용
3. 전체 체인 렌더는 게인만 적용 (`skipLimiter: true`); 피크 제어는 아래 소프트 클리퍼 + 최종 리미터 단계에서 발생.

---

## 15. Soft Clipper (소프트 클리퍼)

**파일:** `web/lib/dsp/soft-clipper.js`

**목적:** 룩어헤드가 있는 새츄레이션 커브를 사용한 마스터링급 피크 감소. 리미팅 전에 피크 대 라우드니스 비율을 줄여서 과도한 리미터 펌핑 없이 더 큰 마스터를 가능하게 합니다.

**기본값:** 활성화 (Maximizer가 켜져 있을 때)

**파라미터:**
| 파라미터 | 값 | 설명 |
|----------|-----|------|
| `ceiling` | -1 dB | 목표 천장 (리미터와 일치) |
| `lookaheadMs` | 0.5 ms | 트랜지언트용 매우 짧은 룩어헤드 |
| `releaseMs` | 10 ms | 투명도를 위한 빠른 릴리스 |
| `drive` | 1.5 | 새츄레이션 강도 |

**알고리즘:**
1. **게인 엔벨로프 계산:**
   - 임계값 이상의 피크에 대해 모든 채널 스캔 (ceiling + 3dB)
   - Tanh 새츄레이션 커브를 사용하여 필요한 게인 감소 계산
   - 트랜지언트를 조기에 잡기 위해 룩어헤드 윈도우(0.5ms) 적용
2. **엔벨로프 스무딩:**
   - 즉시 어택 (게인 감소 즉시 적용)
   - 지수적 릴리스 (10ms 시간 상수)
   - 게인 펌핑 아티팩트 방지
3. **최종 안전 클립:**
   - 스무딩된 게인 엔벨로프를 샘플에 적용
   - 천장 이상 남은 피크에 대한 부드러운 tanh 새츄레이션
   - 피크에 대해 최대 10% 추가 감소

**논리:**
조용한 소스(예: -18 LUFS)를 큰 타겟(예: -14 ~ -9 LUFS)으로 정규화할 때, 필요한 게인이 피크를 천장보다 훨씬 위로 밀어올릴 수 있습니다. 소프트 클리핑 없이는 리미터가 많은 작업을 해야 하므로 펌핑과 스쿼싱이 발생합니다. 소프트 클리퍼는 리미터에 도달하기 전에 피크를 부드럽게 깎아서 더 투명한 리미팅을 가능하게 합니다.

---

## 16. True Peak Limiter (트루 피크 리미터)

**파일:** `web/lib/dsp/limiter.js`

**목적:** 트루 피크 감지가 있는 투명한 피크 제어.

**기본값:** 활성화

**파라미터:**
| 파라미터 | 값 | 설명 |
|----------|-----|------|
| Ceiling | -1 dBTP | 트루 피크 천장 (선형: 0.891) |
| Lookahead | 3 ms | 피크가 도착하기 전에 감지 |
| Release | 100 ms | 게인 복구 시간 |
| Knee | 3 dB | 소프트 니 폭 |
| Preserve Transients | true | 트랜지언트에 더 부드러운 리미팅 |

**2단계 아키텍처:**

**Stage 1: 룩어헤드 게인 감소**
- 4배 오버샘플링된 트루 피크 감지 (Catmull-Rom 보간)
- 룩어헤드로 게인 엔벨로프 계산
- 투명도를 위한 부드러운 어택/릴리스

**Stage 2: 소프트 니 새츄레이션 안전망**
- 남은 피크 포착
- Tanh 시그모이드 커브 (하드 클리핑 없음)
- 인터샘플 피크 처리를 위한 오버샘플링

**트랜지언트 보존:**
- 크레스트 팩터(피크/RMS 비율) 분석
- 높은 크레스트 팩터 = 트랜지언트
- 트랜지언트는 약간 높은 유효 천장 획득 (최대 +0.5 dB)

---

## 상수 참조

**파일:** `web/lib/dsp/constants.js`

### K-Weighting (ITU-R BS.1770-4)
```javascript
HIGH_SHELF_FREQ: 1681.97 Hz
HIGH_SHELF_GAIN: 4.0 dB
HIGH_SHELF_Q: 0.71
HIGH_PASS_FREQ: 38.14 Hz
HIGH_PASS_Q: 0.5
```

### LUFS 측정
```javascript
BLOCK_SIZE: 400 ms
BLOCK_OVERLAP: 75%
ABSOLUTE_GATE: -70 LUFS
RELATIVE_GATE: -10 dB
LOUDNESS_OFFSET: -0.691
```

### Limiter
```javascript
CEILING: -1 dBTP (0.891 linear)
LOOKAHEAD: 3 ms
RELEASE: 100 ms
KNEE: 3 dB
PRESERVE_TRANSIENTS: true
```

### Audio
```javascript
SAMPLE_RATE: 48000 Hz (기본 내보내기)
BIT_DEPTH: 24 (기본 내보내기)
TARGET_LUFS: -14
```

---

## 기본 설정 요약

| 기능 | 기본값 | UI 컨트롤 |
|------|--------|----------|
| Input Gain | 0 dB | Loudness 패널 |
| Phase Invert | OFF | Stereo 패널 |
| Reverse Audio | OFF | Edit 패널 |
| De-harsh | ON | Quick Fix 패널 |
| Clean Low End (HPF 30Hz) | ON | Quick Fix 패널 |
| High Cut | ON | Quick Fix 패널 |
| Add Punch | ON | Quick Fix 패널 |
| Add Air | ON | Polish 패널 |
| Tape Warmth | ON | Polish 패널 |
| Tube Saturator | OFF | Polish 패널 |
| Auto Level | OFF | Loudness 패널 |
| Mono Bass | ON | Stereo 패널 |
| Normalize Loudness | ON | Loudness 패널 |
| Maximizer | ON | Loudness 패널 |
| Target LUFS | -14 | Loudness 슬라이더 |
| Ceiling | -1 dB | Loudness 페이더 |
| Stereo Width | 100% | Stereo 슬라이더 |
| Sample Rate | 48 kHz | Output 패널 |
| Bit Depth | 24-bit | Output 패널 |

---

## 파일 구조

```text
web/lib/dsp/
├── index.js                  # 메인 exports (배럴 파일)
├── constants.js              # 모든 상수
├── utils.js                  # 유틸리티 함수 (dB 변환 등)
├── fft.js                    # FFT 프로세서
├── lufs.js                   # LUFS 측정
├── true-peak.js              # 트루 피크 감지
├── normalizer.js             # LUFS 정규화
├── limiter.js                # 룩어헤드 리미터
├── soft-clipper.js           # 룩어헤드가 있는 마스터링 소프트 클리퍼
├── dynamic-processor.js      # 하이브리드 멀티밴드 다이나믹스 (De-harsh)
├── exciter.js                # 고주파 익사이터
├── saturation.js             # 싱글 밴드 새츄레이션
├── multiband-saturation.js   # 3밴드 새츄레이션 (Tape Warmth)
├── multiband-transient.js    # 3밴드 트랜지언트 셰이퍼 (Add Punch)
├── transient.js              # 싱글 밴드 트랜지언트 셰이퍼
├── stereo.js                 # 스테레오 처리 (M/S, width)
├── dynamic-leveler.js        # 다이나믹 레인지 레벨링 (Auto Level)
├── multiband.js              # 멀티밴드 압축
├── biquad.js                 # 통합 바이쿼드 필터 모듈 (5가지 필터 타입)
├── glue-compressor.js        # 글루 컴프레서
├── tube-saturator.js         # 진공관 새츄레이터
├── phase.js                  # 위상 반전
├── reverse.js                # 오디오 역재생
├── final-filters.js          # 최종 필터 (HPF/LPF)
└── dc-offset.js              # DC 오프셋 제거

web/workers/
├── worker-interface.js       # Worker 메시징 + 진행률 배관
└── dsp-worker.js             # 전체 체인 렌더 구현 (프리뷰/내보내기 동등성)

web/ui/
├── renderer.js               # 메인 스레드 오프라인 렌더 대체
└── encoder.js                # WAV 인코더 (비동기/진행률 지원)
```

---