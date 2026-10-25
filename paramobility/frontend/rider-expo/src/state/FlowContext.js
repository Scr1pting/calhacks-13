import { createContext, useContext } from 'react'
import { useLeewayFlow } from './useLeewayFlow'

// One flow for the whole app: the root layout owns it, and every page of the
// navigation stack reads it.
const FlowContext = createContext(null)

export function FlowProvider({ children }) {
  const flow = useLeewayFlow()
  return <FlowContext.Provider value={flow}>{children}</FlowContext.Provider>
}

export const useFlow = () => useContext(FlowContext)
