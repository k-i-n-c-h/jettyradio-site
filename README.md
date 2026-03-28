# jettyradio-site
```
     ____.       __    __           __________             .___.__        
    |    | _____/  |__/  |_ ___.__. \______   \_____     __| _/|__| ____  
    |    |/ __ \   __\   __<   |  |  |       _/\__  \   / __ | |  |/  _ \ 
/\__|    \  ___/|  |  |  |  \___  |  |    |   \ / __ \_/ /_/ | |  (  <_> )
\________|\___  >__|  |__|  / ____|  |____|_  /(____  /\____ | |__|\____/ 
              \/            \/              \/      \/      \/            
```

Santa Cruz-based internet radio


## Contributing
The site is built using [Astro](https://astro.build/), a framework that allows us to write normal HTML, CSS, and Javascript in a reusable way.

### Adding shows to archive

The shows are in `src/allShows.js`. All you need to do is copy the top existing show, add to the top, and fill out the right details! Keeping the shows like this lets us use the info in different ways, from filtering them by DJ or sorting by date. 
```js
{
    dj: "albus fr33ky",
    title: "wave of unusual size and force",
    date: new Date(2026, 2, 12), ///
    setlist: `
    Too Much Fun at the Temple of Doom - Simple Symmetry
    Explanation Of The Funk - Glenn Echo & Daniel Meinecke`,
    image: "https://stream.jettyradio.com/api/station/jettyradio/art/7c561f4a6746d2d6e206d97f-1773291267.jpg",
    downloadLink: "https://stream.jettyradio.com/api/station/1/ondemand/download/7c561f4a6746d2d6e206d97f",
  },
```
This is also a step closer to just querying AzuraCast for the shows and having it create this list for us automatically. We'd have to be more intentional of how we add the shows (like being consistent with naming, using metadata for adding setlists and any other info, can get creative), but it'll pay off as we expand shows & programming. life is all about scaling, you know?

### File Structure
#### `src/pages`
Every file in this directory becomes a page of the website. If you create a file `party-time.astro`, it will be accessible at `jettyradio.com/party-time`.
You're able to create subroutes by placing files in folders, so `pages/events/indexical` would be accessible at `jettyradio.com/events/indexical`.


You can also create "dynamic" routes. This lets us create many pages based on a set of rules or some data, so we don't have to create every page ourself. 
We're doing this now with `pages/dj/[slug].astro`. In that file, we take the list of all shows (at `src/allShows.js`) and create a list of every unique DJ name, which Astro uses to create individual pages for, listing only the archived shows for that DJ. 


#### `src/layouts`
This is where we keep our pages "layout", which is essentially all the stuff we want shared across every page. We only have one, called `main-layout`, and it has the HTML `<head>` section so every page has icons, a title, blah blah, but its also where we put the header & media player, because we want every page to have that.

#### `src/components` 
This is where we put our parts & pieces for actually building the UI. As just plain html & css, this is simply a nice way to organize things makes it easier to reuse. You can think of it as creating your own HTML elements. Components (along with the layout mentioned above) lets us make our home page (`index.html`) look like this 
```html
<MainLayout title="Jetty Radio">
	<NowPlaying />
	<Chat />
	<WebCounter />
</MainLayout>
```

While `.astro` files work great for plain HTML and CSS, we can also use it to create components that act as templates.In that way, the component only defines how information is displayed, but the info is coming from elsewhere. This is especially helpful for organizing more repetitive elements, like on our archive/shows page.


For example, our archives page consists of images, titles, dates, setlists, and download links. If we wanted to add a class to the title, we'd have to make the same update over 30 times. By decoupling the show data, we can pass it into a general purpose `<Show>` component (`at src/components/show.astro`) like this
```html
<Show
    dj={show.dj}
    title={show.title}
    date={show.date}
    setlist={show.setlist}
    image={show.image}
    downloadLink={show.downloadLink}
/>
```
We only have to make changes to the `<Show>` component and it will be reflected in every instance of it. 


#### `src/public` 
Assets like our favicons, the background image, etc... live here. They'll always be available at the root url `/`.


### Making changes
To make/test changes locally you need to
1. clone the github repository
2. intall [Bun](https://bun.com/) (easy instructions on their site)
3. run `bun run dev` in your terminal while you're in the project folder
4. go to the link it tells you. The site is running on your computer and any change you make to the code will be reflected here. 

Don't want to bother with installing `bun` and `git` and pulling off righteous hacks in your terminal?
Forget aboout iiiit! I added a `.devcontainer` file here so we can use Github's Codespaces feature, which spins up a whole dev environment in your browser without you doing anything! I'll make a video showing how to do this later, but if you're interested before I get that up, let me know and I can walk you though it!
> [!WARNING]
> **Important note:** Everyone gets 60 free hours of Codespace usage per month. That's more than enough for what we'll be doing, but it's important to remember to "stop" your codespace when you're done using it, because otherwise it stays on even after you've closed your browser. 
