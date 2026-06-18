export interface AzuraShow {
    title: string
    artist: string
    art: string
    unique_id: string
    lyrics?: string
    custom_fields: {
        archive?: string
        air_date?: string
    }
    playlists: [
        { id: number }
    ]
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