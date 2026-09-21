import { $sessionStore } from '@clerk/astro/client'
import { parseDirectory, recordGroup, type DJRecord } from './directory'

const root = document.querySelector<HTMLElement>('#dj-directory')!
const search = root.querySelector<HTMLInputElement>('#dj-search')!
const scope = root.querySelector<HTMLSelectElement>('#dj-status')!
const refresh = root.querySelector<HTMLButtonElement>('#dj-refresh')!
const status = root.querySelector<HTMLElement>('#dj-count')!
const list = root.querySelector<HTMLElement>('.directory-list')!
const overview = root.querySelector<HTMLElement>('.overview')!
const empty = root.querySelector<HTMLElement>('#dj-empty')!
let records: DJRecord[] = []
let sessionId: string | undefined
let request: AbortController | undefined

const groups: { title: string; fields: [keyof DJRecord, string][] }[] = [
    { title: 'Show details', fields: [
        ['show', 'Show name'], ['slot', 'Official time slot'], ['cadence', 'Cadence'],
        ['format', 'Show format'], ['description', 'Show description'],
        ['requestedSlot', 'Original scheduling request'],
    ] },
    { title: 'Host & contact', fields: [
        ['name', 'Name'], ['artist', 'Host / artist name'], ['pronouns', 'Pronouns'],
        ['email', 'Email'], ['contact', 'Additional contact / preferred method'],
        ['socials', 'Socials'], ['bio', 'Artist / host bio'],
    ] },
    { title: 'Station notes', fields: [
        ['status', 'Status'], ['organizer', 'Organizer / point person'],
        ['delivery', 'Audio delivery / help needed'], ['notes', 'Status notes'],
        ['referral', 'How they heard about Jetty'], ['submittedAt', 'Submitted'],
    ] },
]

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
    const node = document.createElement(tag)
    node.textContent = text
    node.className = className
    return node
}

function content(value: string, key: keyof DJRecord): Node {
    if (!value.trim()) return element('span', 'Not supplied', 'missing')
    if (key === 'email' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
        const link = element('a', value.trim())
        link.href = `mailto:${value.trim()}`
        return link
    }
    const fragment = document.createDocumentFragment()
    // Render as text, never HTML. Only explicit http(s) links are clickable.
    const parts = value.split(/((?:https?:\/\/|www\.)[^\s<>"\[\]]+)/g)
    parts.forEach((part, index) => {
        if (index % 2 === 0) fragment.append(document.createTextNode(part))
        else {
            const link = element('a', part)
            link.href = part.startsWith('www.') ? `https://${part}` : part
            link.target = '_blank'
            link.rel = 'noopener noreferrer'
            fragment.append(link)
        }
    })
    return fragment
}

function card(row: DJRecord): HTMLDetailsElement {
    const details = element('details', '', 'dj-record')
    const summary = element('summary')
    const artist = element('div', '', 'artist')
    artist.append(element('h2', row.artist || row.name || 'Name not supplied'), element('span', row.show || 'Show name not supplied'))
    const slot = element('div', '', 'slot')
    slot.append(element('span', row.slot.trim() || 'No official slot'), element('small', row.cadence.trim() || 'Cadence not supplied'))
    const expand = element('span', '+', 'expand')
    expand.setAttribute('aria-hidden', 'true')
    summary.append(artist, slot, element('span', row.status.trim() || 'No status', `status-label ${recordGroup(row)}`), expand)
    const body = element('div', '', 'record-details')
    for (const group of groups) {
        const section = element('section')
        section.append(element('h3', group.title))
        const dl = element('dl')
        for (const [key, label] of group.fields) {
            const field = element('div'), dd = element('dd')
            dd.append(content(row[key], key))
            field.append(element('dt', label), dd)
            dl.append(field)
        }
        section.append(dl)
        body.append(section)
    }
    details.append(summary, body)
    return details
}

function render() {
    const query = search.value.trim().toLowerCase()
    const visible = records.filter(row => (scope.value === 'all' || recordGroup(row) === scope.value) &&
        Object.values(row).join(' ').toLowerCase().includes(query))
    list.replaceChildren(...visible.map(card))
    status.textContent = `${visible.length} ${visible.length === 1 ? 'show' : 'shows'} · Open a show for full details.`
    empty.hidden = visible.length > 0
}

function clear() {
    records = []
    list.replaceChildren()
    overview.hidden = empty.hidden = true
    search.disabled = scope.disabled = refresh.disabled = true
}

async function load() {
    request?.abort()
    const controller = new AbortController()
    request = controller
    clear()
    status.textContent = 'Loading the DJ directory…'
    try {
        if (!root.dataset.api) throw new Error('The station connection is not configured. Ask the organizer to connect Backstage.')
        const base = new URL(root.dataset.api)
        if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname)))
            throw new Error('The station connection needs a secure backend URL.')
        const token = await $sessionStore.get()?.getToken()
        if (controller.signal.aborted) return
        if (!token) throw new Error('Sign in to Jetty Backstage to load the directory.')
        const response = await fetch(new URL('/api/djs', base), {
            headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: 'no-store',
        })
        const data = await response.json()
        if (controller.signal.aborted) return
        if (!response.ok) throw new Error(data.error || 'Could not load the DJ directory.')
        records = parseDirectory(data.records).sort((a, b) =>
            (a.artist || a.name).localeCompare(b.artist || b.name) || a.show.localeCompare(b.show))
        const scheduled = records.filter(row => recordGroup(row) === 'scheduled')
        root.querySelector('#dj-artist-total')!.textContent = String(new Set(scheduled.map(row => (row.artist || row.name).trim().toLowerCase())).size)
        root.querySelector('#dj-show-total')!.textContent = String(scheduled.length)
        root.querySelector('#dj-paused-total')!.textContent = String(records.filter(row => recordGroup(row) === 'paused').length)
        overview.hidden = false
        search.disabled = scope.disabled = false
        render()
    } catch (error) {
        if (!controller.signal.aborted) status.textContent = `${error instanceof Error ? error.message : 'Could not load the directory.'} Use Refresh to retry.`
    } finally {
        if (!controller.signal.aborted) refresh.disabled = false
    }
}

search.addEventListener('input', render)
scope.addEventListener('change', render)
refresh.addEventListener('click', () => void load())
root.querySelector('form')!.addEventListener('submit', event => event.preventDefault())
$sessionStore.subscribe(session => {
    if (session?.status === 'active') {
        if (session.id !== sessionId) {
            sessionId = session.id
            void load()
        }
    } else {
        sessionId = undefined
        request?.abort()
        clear()
        search.value = ''
        scope.value = 'scheduled'
        status.textContent = 'Sign in to load the DJ directory.'
    }
})
