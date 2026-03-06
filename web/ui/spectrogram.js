export class Spectrogram {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.tempCanvas = null;
        this.tempCtx = null;
        this.imageDataCache = null;

        this.analyser = null;
        this.animationFrame = null;
        this.isVisible = false;
        this.isFrozen = false; // Freeze state for click-and-hold

        // Parameters
        this.pt = 11; // 2^11 = 2048 samples (matches app.js analyser default)
        this.fftSize = 1 << this.pt;
        this.sampleRate = 48000;
        this.dr = -96; // dB Range floor

        // Buffers
        this.timeDomainBuffer = new Float32Array(this.fftSize);
        this.spectrum = new Float32Array(this.fftSize >> 1).fill(-144);
        this.spectrogramBuffer = new Float32Array(256 * 1024).fill(-144); // 256 bins x 1024 history

        // FFT Resources
        this.real = new Float32Array(this.fftSize);
        this.imag = new Float32Array(this.fftSize);
        this.window = new Float32Array(this.fftSize);
        this.sinTable = new Float32Array(this.fftSize);
        this.cosTable = new Float32Array(this.fftSize);

        // Initialization
        this.initTables();
    }

    initTables() {
        for (let i = 0; i < this.fftSize; i++) {
            const angle = -2 * Math.PI * i / this.fftSize;
            this.sinTable[i] = Math.sin(angle);
            this.cosTable[i] = Math.cos(angle);
            // Hann Window
            this.window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / this.fftSize));
        }
    }

    mount(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        // Create Main Canvas
        this.canvas = document.createElement('canvas');
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.display = 'block';
        this.canvas.style.backgroundColor = '#111';
        this.canvas.style.cursor = 'pointer';
        this.canvas.style.pointerEvents = 'auto';
        this.canvas.style.userSelect = 'none';
        this.canvas.style.position = 'relative';
        this.canvas.style.zIndex = '10';

        this.ctx = this.canvas.getContext('2d', { alpha: false });
        this.dpr = window.devicePixelRatio || 1;

        // Create Temp Canvas for scrolling logic
        this.tempCanvas = document.createElement('canvas');
        this.tempCanvas.width = 1024;
        this.tempCanvas.height = 256;
        this.tempCtx = this.tempCanvas.getContext('2d');
        this.imageDataCache = this.tempCtx.createImageData(1024, 256);

        // Initialize black background
        const data = this.imageDataCache.data;
        for (let i = 0; i < data.length; i += 4) {
            data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
        }

        container.innerHTML = '';
        container.appendChild(this.canvas);

        // DPR-aware canvas sizing
        this._resizeCanvas();
        this._resizeObserver = new ResizeObserver(() => this._resizeCanvas());
        this._resizeObserver.observe(container);

        // Add freeze on click-and-hold (attach AFTER canvas is in DOM)
        this.canvas.addEventListener('mousedown', (e) => {
            e.preventDefault();
            this.freeze();
            this.canvas.style.cursor = 'grabbing';
        });

        this.canvas.addEventListener('mouseup', (e) => {
            e.preventDefault();
            this.unfreeze();
            this.canvas.style.cursor = 'pointer';
        });

        this.canvas.addEventListener('mouseleave', (e) => {
            if (this.isFrozen) {
                this.unfreeze();
                this.canvas.style.cursor = 'pointer';
            }
        });

        // Add touch support for mobile devices
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.freeze();
        });

        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.unfreeze();
        });
    }

    _resizeCanvas() {
        if (!this.canvas) return;
        this.dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        this.canvas.width = Math.round(rect.width * this.dpr);
        this.canvas.height = Math.round(rect.height * this.dpr);
    }

    connect(analyserNode) {
        this.analyser = analyserNode;
        this.sampleRate = analyserNode.context.sampleRate;

        // Ensure analyser size matches our FFT if possible, or just use our size
        // this.analyser.fftSize = this.fftSize; 
    }

    start() {
        if (!this.analyser || !this.ctx) return;

        // Wait for browser to compute layout after container becomes visible
        requestAnimationFrame(() => {
            const width = this.canvas.offsetWidth;
            const height = this.canvas.offsetHeight;

            if (width === 0 || height === 0) {
                // Try again after a short delay if canvas isn't sized yet
                setTimeout(() => {
                    if (this.canvas.offsetWidth > 0 && this.canvas.offsetHeight > 0) {
                        this.isVisible = true;
                        this.loop();
                    }
                }, 100);
                return;
            }

            this.isVisible = true;
            this.loop();
        });
    }

    stop() {
        this.isVisible = false;
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
    }

    freeze() {
        this.isFrozen = true;
    }

    unfreeze() {
        this.isFrozen = false;
    }

    loop() {
        if (!this.isVisible) return;

        this.process();
        this.draw();

        this.animationFrame = requestAnimationFrame(() => this.loop());
    }

    process() {
        if (!this.analyser || this.isFrozen) return;

        // Get time domain data
        this.analyser.getFloatTimeDomainData(this.timeDomainBuffer);

        // Windowing & Prepare FFT
        this.imag.fill(0);
        for (let i = 0; i < this.fftSize; i++) {
            this.real[i] = this.timeDomainBuffer[i] * this.window[i];
        }

        // Perform FFT
        this.fft(this.real, this.imag);

        // Compute Magnitude dB
        const fftHalf = this.fftSize >> 1;
        // Compensation for Hann window (approx 6.02dB loss for coherent signals, but let's stick to reference power calc)
        // Reference used: 
        // correctionAC_val = 10 * Math.log10(16); (+12dB)
        // fftNormalization = -20 * Math.log10(fftSize);

        const correctionAC = 10 * Math.log10(16);
        const fftNorm = -20 * Math.log10(this.fftSize);

        for (let i = 0; i < fftHalf; i++) {
            const rawPower = this.real[i] * this.real[i] + this.imag[i] * this.imag[i];
            const db = 10 * Math.log10(rawPower + 1e-24) + correctionAC + fftNorm;
            this.spectrum[i] = db < -144 ? -144 : db;
        }

        // Update Spectrogram Buffer (Scroll Left)
        const spectroWidth = 1024;
        const spectroHeight = 256;

        // Shift buffer
        // For performance in JS without typed array copyWithin support (old browsers), but modern JS has it.
        // this.spectrogramBuffer.copyWithin(0, 1) -> No, we want row-based shifting?
        // Reference implementation:
        /*
            for (let y = 0; y < spectroHeight; y++) {
                const rowStartBuffer = y * spectroWidth;
                this.spectrogramBuffer.copyWithin(rowStartBuffer, rowStartBuffer + 1, rowStartBuffer + spectroWidth);
            }
        */

        // Let's scroll the IMAGE DATA directly for efficiency, avoiding huge array copies if possible?
        // Actually, drawing the previous frame offset by -1 pixel is faster for canvas.
        // But we need the pixel data to generate the new column.

        // Let's stick to the buffer approach for correctness with the reference look.
        for (let y = 0; y < spectroHeight; y++) {
            const rowStart = y * spectroWidth;
            this.spectrogramBuffer.copyWithin(rowStart, rowStart + 1, rowStart + spectroWidth);

            // Update Image Data Cache (shift left)
            const rowStartImg = rowStart * 4;
            this.imageDataCache.data.copyWithin(rowStartImg, rowStartImg + 4, rowStartImg + spectroWidth * 4);
        }

        // Append new column
        this.updateLatestColumn(spectroWidth, spectroHeight, fftHalf);
    }

    updateLatestColumn(width, height, fftHalf) {
        const minFreq = 20;
        const maxFreq = 22000; // Cap at 22k for visibility
        const nyquist = this.sampleRate / 2;
        const logMin = Math.log10(minFreq);
        const logMax = Math.log10(maxFreq);
        const logRange = logMax - logMin;

        for (let y = 0; y < height; y++) {
            // Map y (0=top to height=bottom) to Freq (High to Low)
            const freq = Math.pow(10, logMax - (y / (height - 1)) * logRange);

            let dbValue = -144;

            if (freq >= minFreq && freq <= nyquist) {
                const binFloat = (freq * this.fftSize) / this.sampleRate;
                const bin1 = Math.floor(binFloat);

                if (bin1 < fftHalf) {
                    const bin2 = bin1 + 1 < fftHalf ? bin1 + 1 : bin1;
                    const frac = binFloat - bin1;
                    const v1 = this.spectrum[bin1];
                    const v2 = this.spectrum[bin2];
                    dbValue = v1 + (v2 - v1) * frac;
                }
            }

            // Write to buffer
            this.spectrogramBuffer[y * width + (width - 1)] = dbValue;

            // Write to Image Data
            const color = this.dbToColor(dbValue);
            const offset = (y * width + (width - 1)) * 4;
            this.imageDataCache.data[offset] = color[0];
            this.imageDataCache.data[offset + 1] = color[1];
            this.imageDataCache.data[offset + 2] = color[2];
            this.imageDataCache.data[offset + 3] = 255;
        }
    }

    fft(real, imag) {
        const n = real.length;
        const bits = this.pt; // log2(n)

        // Bit Reversal
        for (let i = 0; i < n; i++) {
            let result = 0;
            let x = i;
            for (let b = 0; b < bits; b++) {
                result = (result << 1) | (x & 1);
                x >>= 1;
            }
            const j = result;

            if (j > i) {
                const tr = real[i]; real[i] = real[j]; real[j] = tr;
                const ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
            }
        }

        // Butterfly
        for (let size = 2; size <= n; size <<= 1) {
            const halfSize = size >> 1;
            const step = n / size; // Table stride

            for (let i = 0; i < n; i += size) {
                for (let j = i, k = 0; j < i + halfSize; j++, k += step) {
                    const cos_w = this.cosTable[k];
                    const sin_w = this.sinTable[k];

                    const tr = real[j + halfSize] * cos_w - imag[j + halfSize] * sin_w;
                    const ti = real[j + halfSize] * sin_w + imag[j + halfSize] * cos_w;

                    real[j + halfSize] = real[j] - tr;
                    imag[j + halfSize] = imag[j] - ti;
                    real[j] += tr;
                    imag[j] += ti;
                }
            }
        }
    }

    dbToColor(db) {
        if (db > 0) db = 0;
        const normalized = (db - this.dr) / (-this.dr); // dr is negative e.g. -96
        const val = Math.max(0, Math.min(1, normalized));

        // Reference color stops (Black -> Blue -> Cyan -> Green -> Yellow -> Red -> White)
        const stops = [
            { p: 0.000, r: 0, g: 0, b: 0 },
            { p: 0.166, r: 0, g: 0, b: 255 },
            { p: 0.333, r: 0, g: 255, b: 255 },
            { p: 0.500, r: 0, g: 255, b: 0 },
            { p: 0.666, r: 255, g: 255, b: 0 },
            { p: 0.833, r: 255, g: 0, b: 0 },
            { p: 1.000, r: 255, g: 255, b: 255 }
        ];

        let lower = stops[0], upper = stops[stops.length - 1];
        for (let i = 0; i < stops.length - 1; i++) {
            if (val >= stops[i].p && val <= stops[i + 1].p) {
                lower = stops[i];
                upper = stops[i + 1];
                break;
            }
        }

        const range = upper.p - lower.p;
        const mix = range === 0 ? 0 : (val - lower.p) / range;
        const brt = 1.0; // Brightness

        const r = Math.round((lower.r + (upper.r - lower.r) * mix) * brt);
        const g = Math.round((lower.g + (upper.g - lower.g) * mix) * brt);
        const b = Math.round((lower.b + (upper.b - lower.b) * mix) * brt);

        return [r, g, b];
    }

    draw() {
        if (!this.ctx || !this.imageDataCache) return;

        const w = this.canvas.width;
        const h = this.canvas.height;

        // Draw background
        this.ctx.fillStyle = '#111';
        this.ctx.fillRect(0, 0, w, h);

        // Put temp image data
        this.tempCtx.putImageData(this.imageDataCache, 0, 0);

        // Draw scaled to main canvas
        this.ctx.drawImage(this.tempCanvas, 0, 0, 1024, 256, 0, 0, w, h);

        // Draw Grid (Simplified)
        const d = this.dpr;
        this.ctx.strokeStyle = '#444';
        this.ctx.lineWidth = d;
        this.ctx.fillStyle = '#888';
        this.ctx.font = `${12 * d}px Inter, sans-serif`;
        this.ctx.textAlign = 'right';

        const gridFreqs = [100, 200, 500, 1000, 2000, 5000, 10000, 20000];
        const logMin = Math.log10(20);
        const logMax = Math.log10(22000);
        const logRange = logMax - logMin;

        gridFreqs.forEach(freq => {
            const yNorm = (Math.log10(freq) - logMin) / logRange;
            const y = (1 - yNorm) * h;

            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(w, y);
            this.ctx.stroke();

            this.ctx.fillText(freq < 1000 ? freq + ' Hz' : (freq / 1000) + ' kHz', w - 10 * d, y + 4 * d);
        });

        // Draw frozen indicator
        if (this.isFrozen) {
            this.ctx.strokeStyle = '#ff9f43';
            this.ctx.lineWidth = 4 * d;
            this.ctx.strokeRect(2 * d, 2 * d, w - 4 * d, h - 4 * d);

            this.ctx.fillStyle = '#ff9f43';
            this.ctx.font = `bold ${16 * d}px Inter, sans-serif`;
            this.ctx.textAlign = 'left';
            this.ctx.fillText('FROZEN', 10 * d, 25 * d);
        }
    }
}

export const spectrogram = new Spectrogram();
