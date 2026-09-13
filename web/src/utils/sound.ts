/**
 * 音效：大部分用 Web Audio API 合成，仅 all-in 惊呼用真实音频 wow.m4a。
 * 浏览器自动播放策略：首次用户手势时调用 unlockAudio() 解锁。
 */
import wowUrl from '@/assets/sounds/wow.m4a';

let ctx: AudioContext | null = null;
let enabled = (() => {
  try {
    return localStorage.getItem('th_sound') !== 'off';
  } catch {
    return true;
  }
})();

export function soundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(v: boolean): void {
  enabled = v;
  try {
    localStorage.setItem('th_sound', v ? 'on' : 'off');
  } catch {
    /* ignore */
  }
}

/** 在用户首次交互时调用，解锁 AudioContext */
export function unlockAudio(): void {
  ac()?.resume().catch(() => {});
}

function ac(): AudioContext | null {
  if (!enabled) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** 播放本地音频资源文件（受 enabled 开关约束） */
function playFile(url: string, volume = 1): void {
  if (!enabled) return;
  const a = new Audio(url);
  a.volume = volume;
  a.play().catch(() => {});
}

interface ToneOpts {
  type?: OscillatorType;
  gain?: number;
  glideTo?: number;
  when?: number;
}

/** 单个音调 */
function tone(freq: number, dur: number, opts: ToneOpts = {}): void {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + (opts.when ?? 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.glideTo) osc.frequency.exponentialRampToValueAtTime(opts.glideTo, t0 + dur);
  const vol = opts.gain ?? 0.12;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

let noiseBuffer: AudioBuffer | null = null;

/** 白噪声扫掠（牌/筹码质感） */
function noise(dur: number, filterFreq: number, gain = 0.1, when = 0, freqEnd?: number): void {
  const c = ac();
  if (!c) return;
  if (!noiseBuffer) {
    noiseBuffer = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const t0 = c.currentTime + when;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(filterFreq, t0);
  if (freqEnd) filter.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
  filter.Q.value = 1.2;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(g).connect(c.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

export const sfx = {
  /** 发牌：轻微"刷"声 */
  deal() {
    noise(0.09, 3200, 0.08, 0, 1800);
  },
  /** 翻公共牌 */
  flip() {
    noise(0.12, 2600, 0.1, 0, 1200);
  },
  /** 筹码入池：几次清脆碰撞 */
  chips() {
    for (let i = 0; i < 3; i++) {
      tone(2400 - i * 300, 0.06, { type: 'square', gain: 0.05, when: i * 0.05 });
    }
    noise(0.1, 4000, 0.05);
  },
  /** 弃牌：低沉纸牌拍桌 */
  fold() {
    noise(0.14, 500, 0.12);
    tone(140, 0.12, { gain: 0.08 });
  },
  /** 过牌：敲桌两下 */
  check() {
    tone(180, 0.07, { type: 'triangle', gain: 0.12 });
    tone(180, 0.07, { type: 'triangle', gain: 0.1, when: 0.12 });
  },
  /** 轮到你行动：轻柔提示 */
  yourTurn() {
    tone(880, 0.09, { gain: 0.07 });
    tone(1174, 0.12, { gain: 0.07, when: 0.1 });
  },
  /** 抽牌定庄结果 */
  dealer() {
    tone(1046, 0.15, { gain: 0.09 });
    tone(1318, 0.2, { gain: 0.09, when: 0.12 });
  },
  /** 全下：众人惊呼（真实音频 wow.m4a） */
  allin() {
    playFile(wowUrl);
  },
  /** 胜利：上行琶音 */
  win() {
    const notes = [523, 659, 784, 1046];
    notes.forEach((f, i) => tone(f, 0.22, { type: 'triangle', gain: 0.11, when: i * 0.11 }));
  },
  /** 输了：下行两音 */
  lose() {
    tone(392, 0.25, { type: 'triangle', gain: 0.09 });
    tone(311, 0.35, { type: 'triangle', gain: 0.09, when: 0.2 });
  },
  /** 表情投出：丢东西的"嗖——"呼啸声（噪声下扫 + 轻微尾音） */
  emojiWhoosh() {
    noise(0.22, 2600, 0.12, 0, 400);
    tone(1000, 0.16, { type: 'sine', gain: 0.04, glideTo: 200 });
  },
  /** 表情命中：轻快"啵" */
  emojiPop() {
    tone(760, 0.08, { type: 'sine', gain: 0.12 });
    tone(1180, 0.1, { type: 'sine', gain: 0.1, when: 0.05 });
  },
  /** 弹幕滑过：轻微提示音 */
  danmaku() {
    tone(660, 0.06, { type: 'sine', gain: 0.05 });
  },
};
