import { $sessionStore } from '@clerk/astro/client'

type Submission = {
    id: string; title: string; submittedAt: string; audio: string; artwork: string;
    tracklist: string; tracklistArt: string; notes: string; admin: string; completed: string;
    status: 'new' | 'reviewed'; revision: number;
}
const root = document.querySelector<HTMLElement>('#submissions')!
const search = root.querySelector<HTMLInputElement>('#submission-search')!
const filter = root.querySelector<HTMLSelectElement>('#submission-filter')!
const refresh = root.querySelector<HTMLButtonElement>('#submission-refresh')!
const more = root.querySelector<HTMLButtonElement>('#submission-more')!
const status = root.querySelector<HTMLElement>('#submission-status')!
const list = root.querySelector<HTMLElement>('#submission-list')!
let records: Submission[] = []
let nextCursor: string | null = null
let sessionId: string | undefined
let controller = new AbortController()
let loading = false

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = '') {
    const node = document.createElement(tag)
    node.textContent = text
    return node
}
function content(value: string) {
    const fragment = document.createDocumentFragment()
    for (const part of (value || 'Not supplied').split(/(https?:\/\/[^\s<>"\[\]]+)/g)) {
        if (/^https?:\/\//.test(part)) {
            const link = element('a', part)
            link.href = part
            link.target = '_blank'
            link.rel = 'noopener noreferrer'
            fragment.append(link)
        } else fragment.append(document.createTextNode(part))
    }
    return fragment
}
async function api(path: string, signal: AbortSignal, init: RequestInit = {}) {
    if (!root.dataset.api) throw new Error('The Backstage connection is not configured.')
    const base = new URL(root.dataset.api)
    if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname)))
        throw new Error('The Backstage connection needs a secure URL.')
    const token = await $sessionStore.get()?.getToken()
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (!token) throw new Error('Sign in to load submissions.')
    const response = await fetch(new URL(path, base), { ...init, signal, cache: 'no-store', headers: {
        Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    } })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Could not complete this request.')
    return data
}
function card(record: Submission) {
    const details = element('details'), summary = element('summary', record.title)
    summary.append(element('span', `${new Date(record.submittedAt).toLocaleString()} · ${record.status === 'new' ? 'Needs review' : 'Reviewed'}`))
    const body = element('div')
    body.className = 'submission-body'
    const dl = element('dl')
    const fields: [keyof Submission, string][] = [
        ['audio', 'Audio'], ['artwork', 'Artwork'], ['tracklist', 'Tracklist'], ['tracklistArt', 'Tracklist art'],
        ['notes', 'Notes'], ['admin', 'Pickup name at import'], ['completed', 'Completed value at import'],
    ]
    for (const [key, label] of fields) {
        const value = element('dd')
        value.append(content(String(record[key])))
        dl.append(element('dt', label), value)
    }
    const button = element('button', record.status === 'new' ? 'Mark reviewed' : 'Return to needs review')
    button.className = 'btn btn-outline'
    button.addEventListener('click', async () => {
        const signal = controller.signal
        button.disabled = true
        try {
            const data = await api(`/api/submissions/${record.id}`, signal, { method: 'PUT', body: JSON.stringify({
                status: record.status === 'new' ? 'reviewed' : 'new', revision: record.revision,
            }) })
            if (signal.aborted) return
            Object.assign(record, data)
            render()
        } catch (error) {
            if (!signal.aborted) status.textContent = error instanceof Error ? error.message : 'Review could not be saved.'
        } finally { button.disabled = false }
    })
    body.append(dl, button)
    details.append(summary, body)
    return details
}
function render() {
    const query = search.value.trim().toLowerCase()
    const visible = records.filter(record => (filter.value === 'all' || record.status === filter.value) &&
        [record.title, record.tracklist, record.notes, record.admin].join(' ').toLowerCase().includes(query))
    list.replaceChildren(...visible.map(card))
    status.textContent = records.length ? `${visible.length} of ${records.length} loaded submissions shown.${nextCursor ? ' Load older submissions to search further back.' : ''}` : 'No submissions received yet.'
    if (records.length && !visible.length) list.append(element('p', 'No loaded submissions match these filters.'))
    more.hidden = !nextCursor
}
async function load(append = false) {
    if (loading) return
    controller.abort()
    controller = new AbortController()
    const signal = controller.signal
    loading = true
    refresh.disabled = more.disabled = search.disabled = filter.disabled = true
    status.textContent = 'Loading submissions…'
    try {
        const data = await api(`/api/submissions${append && nextCursor ? `?before=${encodeURIComponent(nextCursor)}` : ''}`, signal)
        if (signal.aborted) return
        records = append ? [...records, ...data.records] : data.records
        nextCursor = data.nextCursor
        render()
    } catch (error) {
        if (!signal.aborted) status.textContent = `${error instanceof Error ? error.message : 'Could not load submissions.'} Use Refresh to retry.`
    } finally {
        if (!signal.aborted) {
            loading = false
            refresh.disabled = more.disabled = search.disabled = filter.disabled = false
        }
    }
}
search.addEventListener('input', render)
filter.addEventListener('change', render)
refresh.addEventListener('click', () => void load())
more.addEventListener('click', () => void load(true))
$sessionStore.subscribe(session => {
    if (session?.status === 'active') {
        if (session.id !== sessionId) {
            controller.abort()
            loading = false
            records = []
            nextCursor = null
            list.replaceChildren()
            sessionId = session.id
            void load()
        }
    } else {
        controller.abort()
        loading = false
        sessionId = undefined
        records = []
        nextCursor = null
        list.replaceChildren()
        refresh.disabled = more.disabled = search.disabled = filter.disabled = true
        more.hidden = true
        search.value = ''
        filter.value = 'all'
        status.textContent = 'Sign in to load submissions.'
    }
})
