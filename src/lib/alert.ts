// Aviso "na própria tela": som, tela acesa e título da aba.
//
// Funciona em qualquer navegador (inclusive Safari no iPhone, onde o Web Push
// só existe depois de instalar o app na Tela de Início), desde que a página
// fique aberta. Tudo aqui é melhoria progressiva: se o navegador não suportar,
// as funções simplesmente não fazem nada.

let audioCtx: AudioContext | null = null
let wakeLock: WakeLockSentinel | null = null

type AudioContextCtor = typeof AudioContext

/**
 * Libera o áudio. Precisa ser chamado dentro de um toque do usuário —
 * navegadores móveis bloqueiam som que não nasce de um gesto.
 */
export function unlockAudio(): boolean {
  try {
    const Ctor: AudioContextCtor | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext
    if (!Ctor) return false

    if (!audioCtx) audioCtx = new Ctor()
    if (audioCtx.state === 'suspended') void audioCtx.resume()

    // Um buffer silencioso "destrava" o áudio no iOS.
    const source = audioCtx.createBufferSource()
    source.buffer = audioCtx.createBuffer(1, 1, 22050)
    source.connect(audioCtx.destination)
    source.start(0)
    return true
  } catch {
    return false
  }
}

export function isAudioUnlocked(): boolean {
  return audioCtx !== null
}

/** Três notas ascendentes, repetidas. Só toca se unlockAudio() já rodou. */
export function playReadyChime(repeat = 3): void {
  const ctx = audioCtx
  if (!ctx) return
  try {
    if (ctx.state === 'suspended') void ctx.resume()
    const start = ctx.currentTime + 0.05
    const notes = [880, 1108.73, 1318.51] // Lá5, Dó#6, Mi6

    for (let r = 0; r < repeat; r++) {
      notes.forEach((frequency, i) => {
        const t = start + r * 1.1 + i * 0.18
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.value = frequency
        gain.gain.setValueAtTime(0.0001, t)
        gain.gain.exponentialRampToValueAtTime(0.5, t + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(t)
        osc.stop(t + 0.5)
      })
    }
  } catch {
    // sem som — a vibração e a tela continuam avisando
  }
}

/** Mantém a tela acesa enquanto o cliente espera com a página aberta. */
export async function keepScreenAwake(): Promise<boolean> {
  try {
    if (!('wakeLock' in navigator)) return false
    if (wakeLock && !wakeLock.released) return true
    wakeLock = await navigator.wakeLock.request('screen')
    return true
  } catch {
    return false
  }
}

export function releaseScreen(): void {
  wakeLock?.release().catch(() => {})
  wakeLock = null
}
