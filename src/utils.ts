export const getDjSlug = (dj: string) => {
    if (dj.length <= 0) return 'other'
    return dj.toLowerCase().split(' ').join('-')
}

// Parses dates in the format "02/06/2026"
export const getDateFromString = (date?: string) => {
    if (!date) return new Date(2026, 0, 1);
    const [month, day, year] = date.split("/").map(Number);
    return new Date(year, month - 1, day);
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