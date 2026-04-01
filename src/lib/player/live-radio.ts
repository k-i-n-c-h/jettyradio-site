import {
  type NowPlaying,
  getNowPlaying,
  onNowPlayingUpdate,
  setPlayerInfo,
  loadPlayer,
} from './'
import { attachAnalyzer, setAnalyzerActive } from './analyzer'
import { setIsLive } from './is-live'

const LIVE_RADIO_URL =
  'https://stream.jettyradio.com/listen/jettyradio/radio.mp3'
const setLiveRadioInfo = (np: NowPlaying) => {
  if (!np) return
  const song = np.now_playing?.song
  const listeners = np.listeners?.current
  const live = np.live?.is_live
  const streamerName = np.live?.streamer_name
    ? np.live.streamer_name
    : 'Live DJ'
  const djName = live ? streamerName : song.artist

  setPlayerInfo({
    thumbnail: song.art,
    title: song.title,
    dj: djName,
    live,
    listeners,
  })
}

let unbind: () => {}

export const loadLiveRadioInfo = async () => {
  const scrubberContainer = document.getElementById(
    'scrubber-container',
  ) as HTMLElement
  const listenerEl = document.getElementById('listeners') as HTMLElement
  const onAirEl = document.getElementById('on-air-container') as HTMLElement
  scrubberContainer.style.display = 'none'
  listenerEl.style.display = 'block'
  onAirEl.classList.add('is-on-air')
  const np = await getNowPlaying()
  setLiveRadioInfo(np)
  unbind = onNowPlayingUpdate(setLiveRadioInfo)
}

// We unload to prevent the web socket from causing the title/other elements from being updated
export const unloadLiveRadioInfo = () => unbind()

export const loadLiveRadioPlayer = () => {
  const audio = document.getElementById('audio-live') as HTMLAudioElement
  audio.src = LIVE_RADIO_URL
  attachAnalyzer(audio)
  setAnalyzerActive(true)
  setIsLive(true)
  window.dispatchEvent(
    new CustomEvent('player:load', { detail: { live: true } }),
  )
}
