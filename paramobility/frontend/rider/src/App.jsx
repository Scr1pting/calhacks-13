import PhoneShell from './components/PhoneShell.jsx'
import AskLeewayBar from './components/AskLeewayBar.jsx'
import DemoPanel from './components/DemoPanel.jsx'
import { useLeewayFlow } from './state/useLeewayFlow.js'

import CalendarDiscoveryScreen from './screens/CalendarDiscoveryScreen.jsx'
import RecommendedBookingScreen from './screens/RecommendedBookingScreen.jsx'
import BookingProgressScreen from './screens/BookingProgressScreen.jsx'
import HomeScreen from './screens/HomeScreen.jsx'
import EmptyHomeScreen from './screens/EmptyHomeScreen.jsx'
import EverydayHomeScreen from './screens/EverydayHomeScreen.jsx'
import CallingClinicScreen from './screens/CallingClinicScreen.jsx'
import OutcomeScreen from './screens/OutcomeScreen.jsx'
import RiderDecisionScreen from './screens/RiderDecisionScreen.jsx'
import ChatScreen from './screens/ChatScreen.jsx'
import ChatHomeScreen from './screens/ChatHomeScreen.jsx'
import LiveTripScreen from './screens/LiveTripScreen.jsx'
import Headline from './components/Headline.jsx'

function renderScreen(flow) {
  switch (flow.screen) {
    case 'discover':
      return <CalendarDiscoveryScreen discover={flow.discover} />
    case 'recommend':
      return <RecommendedBookingScreen recommend={flow.recommend} />
    case 'working':
      return <BookingProgressScreen working={flow.working} />
    case 'home':
      return flow.ride ? <LiveTripScreen ride={flow.ride} /> : <HomeScreen home={flow.home} />
    case 'ride':
      return <LiveTripScreen ride={flow.ride} />
    case 'empty':
      return <EmptyHomeScreen empty={flow.empty} />
    case 'everyday':
      return <EverydayHomeScreen everyday={flow.everyday} />
    case 'call':
      return <CallingClinicScreen call={flow.call} />
    case 'outcome':
      return <OutcomeScreen outcome={flow.outcome} />
    case 'decision':
      return <RiderDecisionScreen decision={flow.decision} />
    case 'chat':
      return <ChatScreen chat={flow.chat} />
    case 'chatHome':
      return <ChatHomeScreen chatHome={flow.chatHome} />
    case 'loading':
      return <Headline lead="One moment.">Getting your rides.</Headline>
    default:
      return null
  }
}

// The phone itself: the screen the flow is on, with its top and bottom bars.
// The dashboard's presentation film shows this too, driven by the same flow.
export function LeewayPhone({ flow }) {
  const bottomBar = flow.showBar
    ? flow.screen === 'chat' || flow.screen === 'chatHome'
      ? (
          <AskLeewayBar
            mode="input"
            value={flow.chat.draft}
            onChange={(e) => flow.chat.onDraftChange(e.target.value)}
            onKeyDown={flow.chat.onEnter}
            onSend={flow.chat.onSend}
            voice={flow.voice}
          />
        )
      : <AskLeewayBar mode="button" onOpenChat={flow.onOpenChat} voice={flow.voice} />
    : null

  return (
    <PhoneShell topBar={flow.topBar} onBack={flow.onCloseChat} bottomBar={bottomBar}>
      {flow.error && (
        <div className="lw-error" role="alert">
          <span>Something went wrong: {flow.error}</span>
          <button type="button" onClick={flow.onDismissError} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {renderScreen(flow)}
    </PhoneShell>
  )
}

export default function App() {
  const flow = useLeewayFlow()
  return (
    <div className="lw-desk">
      <LeewayPhone flow={flow} />
      <DemoPanel demo={flow.demo} />
    </div>
  )
}
