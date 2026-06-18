import { getGoogleCalendarEvents } from "./api";
import { SHOW_SLUG_REGEX } from "./constants";

const getShowSlugFromDescription = (description: string) => {
    const matches = description.match(SHOW_SLUG_REGEX)
    return matches?.[1]
}

const twoMonthsOut = new Date();
twoMonthsOut.setMonth(twoMonthsOut.getMonth() + 2);



export const getCalendarEvents = async () => {
    const events = await getGoogleCalendarEvents(twoMonthsOut)
    console.log(JSON.stringify(events[1]), null, 3)
    const eventsWithSlug = events.map((event) => ({
        ...event,
        startTime: new Date(event.start.dateTime),
        endTime: new Date(event.end.dateTime),
        showSlug: getShowSlugFromDescription(event.description)
    }))
    return eventsWithSlug
}