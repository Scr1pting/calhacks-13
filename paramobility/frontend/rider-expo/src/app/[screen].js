import { useLocalSearchParams } from 'expo-router'
import Page from '../components/Page'

// Every other page, at /<screen>: discover, recommend, home, chat, ...
// (the flow's screen names; see Page for the list).
export default function ScreenRoute() {
  const { screen } = useLocalSearchParams()
  return <Page name={screen} />
}
