export type NowPlaying = any // replace with your actual type

let nowPlaying: NowPlaying = null
const listeners = new Set<(np: NowPlaying) => void>()

export async function getNowPlaying() {
  if (nowPlaying) return nowPlaying
  const np = await getNowPlayingHttp()
  _setNowPlaying(np)
  return np
}

export function onNowPlayingUpdate(fn: (np: NowPlaying) => void) {
  listeners.add(fn)
  return () => listeners.delete(fn) // returns an unsubscribe function
}

export function _setNowPlaying(np: NowPlaying) {
  nowPlaying = np
  listeners.forEach((fn) => fn(np))
}

const getNowPlayingHttp = async () => {
  const NOW_PLAYING_URL =
    'https://stream.jettyradio.com/api/nowplaying_static/jettyradio.json'
  const res = await fetch(NOW_PLAYING_URL, { cache: 'no-store' })
  const data = await res.json()
  return data
}
