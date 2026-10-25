import Page from '../components/Page'

// The chat with Leeway. Its own route rather than [screen], so the stack can
// open it like a search view (see _layout): fading in over the page it was
// opened from, closed with an X instead of a back button.
export default function ChatRoute() {
  return <Page name="chat" />
}
