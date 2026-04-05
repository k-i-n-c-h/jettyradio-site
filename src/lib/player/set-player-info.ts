type SetPlayerInfoArgs = {
  thumbnail: string
  title: string
  dj: string
  live: boolean
  listeners?: number
}

export const setPlayerInfo = ({
  thumbnail,
  title,
  dj,
  live,
  listeners = 0,
}: SetPlayerInfoArgs) => {
  const titleEl = document.getElementById('title') as HTMLElement
  const djEl = document.getElementById('dj') as HTMLElement
  const listenerEl = document.getElementById('listeners') as HTMLElement
  const thumbnailEl = document.getElementById('thumbnail') as HTMLImageElement
  const onAirEl = document.getElementById('on-air-container') as HTMLElement
  if (live) {
    onAirEl.classList.add('live')
  } else {
    onAirEl.classList.remove('live')
  }
  titleEl.textContent = title
  djEl.textContent = dj
  thumbnailEl.src = thumbnail
  listenerEl.textContent = `${listeners} ${listeners === 1 ? 'listener' : 'listeners'}`
}
