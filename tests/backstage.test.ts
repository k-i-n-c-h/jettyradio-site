import { describe, expect, test } from 'bun:test'
import { fields, parseDirectory, recordGroup, type DJRecord } from '../src/lib/backstage/directory'
import { createHandler } from '../desk-worker/src/index'

const record = (overrides: Partial<DJRecord> = {}): DJRecord => ({
    ...Object.fromEntries(fields.map(field => [field, ''])),
    id: 'test', status: 'Onboarded', slot: 'First Thursday 8-9pm', ...overrides,
}) as DJRecord

describe('DJ roster', () => {
    test('paused and pending slots are not treated as active residencies', () => {
        expect(recordGroup(record())).toBe('scheduled')
        expect(recordGroup(record({ status: 'Onboarded (PAUSED)' }))).toBe('paused')
        expect(recordGroup(record({ status: 'Pending' }))).toBe('other')
        expect(recordGroup(record({ slot: '' }))).toBe('other')
        expect(recordGroup(record({ status: 'Canceled' }))).toBe('other')
    })
    test('validates complete records without changing submitted spelling or case', () => {
        const row = record({ artist: 'mimixomi', show: 'MXO radio', bio: 'First line\nSecond line' })
        expect(parseDirectory([row])).toEqual([row])
        expect(() => parseDirectory([{}])).toThrow()
        expect(() => parseDirectory([row, row])).toThrow('duplicate')
    })
})


describe('Private DJ API', () => {
    const env = {
        ALLOWED_ORIGINS: 'https://jettyradio.com', CLERK_ISSUER: 'https://clerk.example.com',
        CLERK_JWT_KEY: 'test-public-key', CLERK_ALLOWED_USER_IDS: 'user_allowed',
        DB: { prepare: () => ({ bind: () => ({ first: async () => ({ data: JSON.stringify([record({email:'private@example.com'})]) }) }) }) },
    } as any
    const request = (token = 'valid', origin = 'https://jettyradio.com') => new Request('https://api.example.com/api/djs', {
        headers: { Origin: origin, ...(token ? {Authorization: `Bearer ${token}`} : {}) },
    })
    const handle = createHandler(async token => {
        if (token === 'invalid') throw new Error('Invalid signature')
        return {sub: token === 'outsider' ? 'user_outsider' : 'user_allowed', iss: env.CLERK_ISSUER, azp: 'https://jettyradio.com'}
    })
    test('rejects missing, invalid and non-team sessions before accessing the database', async () => {
        const inaccessible = {...env, DB: {prepare: () => {throw new Error('Must not read private data')}}}
        for (const [token, expected] of [['',401],['invalid',401],['outsider',403]] as const) {
            const response = await handle(request(token), inaccessible)
            expect(response.status).toBe(expected)
            expect(await response.text()).not.toContain('private@example.com')
        }
        expect((await handle(request('valid','https://outsider.example.com'), inaccessible)).status).toBe(403)
    })
    test('serves complete records to verified team members without caching', async () => {
        const response = await handle(request(), env)
        expect(response.status).toBe(200)
        expect(response.headers.get('Cache-Control')).toBe('no-store')
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://jettyradio.com')
        const data = await response.json() as {records: DJRecord[]}
        expect(data.records[0].email).toBe('private@example.com')
    })
    test('reports an unimported roster separately from an empty roster', async () => {
        const absent = {...env, DB: {prepare: () => ({bind: () => ({first: async () => null})})}}
        expect((await handle(request(), absent)).status).toBe(503)
    })
})
