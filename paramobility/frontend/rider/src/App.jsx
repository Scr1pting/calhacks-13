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
      return <HomeScreen home={flow.home} />
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
    case 'loading':
      return <Headline lead="One moment.">Getting your rides.</Headline>
    default:
      return null
  }
}

export default function App() {
  const flow = useLeewayFlow()

  const bottomBar = flow.showBar
    ? flow.screen === 'chat'
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
    <div className="lw-desk">
      <PhoneShell
        topBar={flow.topBar}
        onBack={flow.onCloseChat}
        bottomBar={bottomBar}
      >
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
      <DemoPanel demo={flow.demo} />
    </div>
  )
}
