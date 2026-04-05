import { secondsToString } from '../../utils'
import { setAnalyzerActive } from './analyzer'
import { setIsLive } from './is-live'

let playerAbortController: AbortController | null = null

export const loadPlayer = async (src: string) => {
  const scrubber = document.getElementById('scrubber') as HTMLInputElement
  const scrubberContainer = document.getElementById(
    'scrubber-container',
  ) as HTMLElement
  const currentTimeEl = document.getElementById('track-current') as HTMLElement
  const durationEl = document.getElementById('track-duration') as HTMLElement
  const listenerEl = document.getElementById('listeners') as HTMLElement
  const onAirEl = document.getElementById('on-air-container') as HTMLElement
  const audio = document.getElementById('audio') as HTMLAudioElement

  playerAbortController?.abort()
  playerAbortController = new AbortController()
  const { signal } = playerAbortController

  currentTimeEl.textContent = secondsToString(0)
  scrubber.value = `0`
  scrubber.dispatchEvent(new Event('input'))
  audio.src = src
  scrubberContainer.style.display = 'block'
  listenerEl.style.display = 'none'
  onAirEl.classList.remove('is-on-air')
  setAnalyzerActive(false)
  setIsLive(false)

  let isSeeking = false

  audio.addEventListener(
    'loadedmetadata',
    () => {
      durationEl.textContent = secondsToString(audio.duration)
    },
    { signal },
  )
  audio.addEventListener(
    'timeupdate',
    () => {
      currentTimeEl.textContent = secondsToString(audio.currentTime)
      if (isSeeking) return
      const duration = audio.duration
      if (!isNaN(duration)) {
        const progress = (audio.currentTime / duration) * 100
        scrubber.value = `${progress}`
        scrubber.dispatchEvent(new Event('input'))
      }
    },
    { signal },
  )

  scrubber.addEventListener(
    'input',
    (e) => {
      // Hack for determining if user is adjusting input or the audio timeupdate event
      if (e.isTrusted) {
        scrubber.value = (e.target as HTMLInputElement)?.value
      }
    },
    { signal },
  )
  scrubber.addEventListener(
    'mousedown',
    () => {
      isSeeking = true
    },
    { signal },
  )
  scrubber.addEventListener(
    'mouseup',
    () => {
      isSeeking = false
      audio.currentTime = (audio.duration * scrubber.valueAsNumber) / 100
    },
    { signal },
  )
  scrubber.addEventListener(
    'touchstart',
    () => {
      isSeeking = true
    },
    { signal },
  )
  scrubber.addEventListener(
    'touchend',
    () => {
      isSeeking = false
      audio.currentTime = (audio.duration * scrubber.valueAsNumber) / 100
    },
    { signal },
  )

  window.dispatchEvent(
    new CustomEvent('player:load', { detail: { live: false } }),
  )
}
