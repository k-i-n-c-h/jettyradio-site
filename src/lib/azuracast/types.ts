export interface AzuraShow {
    id: number
    unique_id: string
    song_id: string
    art: string
    path: string
    mtime: number
    uploaded_at: number
    art_updated_at: number
    length: number
    length_text: string
    custom_fields: {
        air_date?: string
        archive?: string
    }
    playlists: ShowPlaylist[]
    text: string
    artist: string
    title: string
    album: string
    genre: any
    isrc: any
    lyrics?: string
}

export interface ShowPlaylist {
    id: number
    name: string
    short_name: string
    folder: any
    count: number
}

export interface Show extends AzuraShow {
    artists: string[]
    setlist: string
    date: Date
    download: string
}

export interface AzuraPlaylist {
    station_id: number
    name: string
    description: string
    type: string
    source: string
    order: string
    remote_url: any
    remote_type: string
    remote_buffer: number
    is_enabled: boolean
    is_jingle: boolean
    play_per_songs: number
    play_per_minutes: number
    play_per_hour_minute: number
    weight: number
    include_in_requests: boolean
    include_in_on_demand: boolean
    backend_options: string[]
    avoid_duplicates: boolean
    played_at: string
    queue_reset_at: any
    schedule_items: ScheduleItem[]
    podcasts: any[]
    id: number
    short_name: string
    num_songs: number
    total_length: number
}

export interface ScheduleItem {
    start_time: number
    end_time: number
    start_date: any
    end_date: any
    days: number[]
    loop_once: boolean
    id: number
}