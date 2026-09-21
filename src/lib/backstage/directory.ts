export const fields = ['submittedAt', 'status', 'cadence', 'name', 'pronouns',
    'artist', 'show', 'slot', 'format', 'email', 'requestedSlot', 'description',
    'bio', 'socials', 'delivery', 'contact', 'referral', 'notes', 'organizer'] as const
export type DJRecord = Record<typeof fields[number] | 'id', string>

export function parseDirectory(value: unknown): DJRecord[] {
    if (!Array.isArray(value) || !value.every(row => row && typeof row === 'object' &&
        ['id', ...fields].every(key => typeof row[key] === 'string')))
        throw new Error('The DJ directory has an invalid format.')
    if (new Set(value.map(row => row.id)).size !== value.length)
        throw new Error('The DJ directory has duplicate record IDs.')
    return value as DJRecord[]
}

export function recordGroup(row: DJRecord): 'scheduled' | 'paused' | 'other' {
    if (/paused/i.test(row.status)) return 'paused'
    return row.status.trim() === 'Onboarded' && row.slot.trim() ? 'scheduled' : 'other'
}

