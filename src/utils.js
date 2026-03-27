export const getDjSlug = (dj) => {
    if (dj.length <= 0) return 'other'
    return dj.toLowerCase().split(' ').join('-')
}