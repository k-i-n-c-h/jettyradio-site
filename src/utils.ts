export const getDjSlug = (dj: string) => {
    if (dj.length <= 0) return 'other'
    return dj.toLowerCase().split(' ').join('-')
}

export const formatShowDate = (date: Date) => date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
})

export const secondsToString = (seconds: number) => {
    const hours = seconds / (60 * 60)
    const displayHours = Math.floor(hours)
    const displayMinutes = Math.floor(hours % 1 * 60);
    const displaySeconds = Math.floor((hours * 60) % 1 * 60);
    const h = displayHours ? `${displayHours}:` : ''
    const m = `${displayMinutes < 10 ? '0' : ''}${displayMinutes}:`
    const s = `${displaySeconds < 10 ? '0' : ''}${displaySeconds}`
    return `${h}${m}${s}`
}