import { loadLiveRadioPlayer } from '.'
import { getIsLive } from './is-live'
import { setIsPlaying } from './is-playing'
export const togglePlayer = (onlyOn: boolean = false) => {
  const transBtn = document.getElementById(
    'transport-button',
  ) as HTMLButtonElement
  const audio = document.getElementById('audio') as HTMLAudioElement
  const liveAudio = document.getElementById('audio-live') as HTMLAudioElement
  const isLive = getIsLive()
  if (isLive) {
    if (!liveAudio.src) {
      loadLiveRadioPlayer()
    }
    audio.pause()
    if (liveAudio.paused) {
      setIsPlaying(true)
      liveAudio.play()
      transBtn.classList.add('playing')
    } else if (!onlyOn) {
      setIsPlaying(false)
      liveAudio.pause()
      transBtn.classList.remove('playing')
    }
  } else {
    liveAudio.pause()
    if (audio.paused) {
      setIsPlaying(true)
      audio.play()
      transBtn.classList.add('playing')
    } else if (!onlyOn) {
      setIsPlaying(false)
      audio.pause()
      transBtn.classList.remove('playing')
    }
  }
}
