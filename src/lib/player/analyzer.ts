let analyzerActive = false
let analyzer: AnalyserNode | null = null
let audioCtx: AudioContext | null = null
let sourceNode: MediaElementAudioSourceNode | null = null

export const attachAnalyzer = (audio: HTMLAudioElement) => {
  if (audioCtx) return
  audioCtx = new AudioContext()
  analyzer = audioCtx.createAnalyser()
  analyzer.fftSize = 512
  analyzer.maxDecibels = -10
  // analyzer.minDecibels = -110
  sourceNode = audioCtx.createMediaElementSource(audio)
  sourceNode.connect(analyzer)
  analyzer.connect(audioCtx.destination)
}

export const setAnalyzerActive = (isActive: boolean) =>
  (analyzerActive = isActive)

export const getAnalyzer = () => {
  const isIphone = /iPhone/i.test(navigator.userAgent)
  // we can't analyze streaming audio on iphone :(
  if (isIphone) return false
  return analyzerActive ? analyzer : null
}
