import { useEffect, useRef } from 'react'
import { router, usePathname } from 'expo-router'

// Keeps the native navigation stack and the flow in step. The flow decides
// which page to show (`flow.route`), often in response to the backend (a call
// starting, a plan being ready); this turns each change into a push, or a pop
// back to the page when it's already in the stack. The other way round, a page
// the rider goes back to (back button, edge swipe, Android or browser back)
// is reported to the flow.
//
// "chatHome" is the stack's root, at "/"; every other page is "/<name>".

const hrefOf = (name) => (name === 'chatHome' ? '/' : `/${name}`)
const nameOf = (pathname) => (pathname === '/' ? 'chatHome' : pathname.slice(1))

export function useNavSync(flow) {
  const pathname = usePathname()
  // The pages in the stack, bottom to top, as this hook has navigated them.
  const stack = useRef(['chatHome'])

  useEffect(() => {
    const target = flow.route
    const pages = stack.current
    // The chat is an overlay over the stack (src/app/_layout.js), not a page.
    if (target === 'chat' || target === pages.at(-1)) return
    const i = pages.lastIndexOf(target)
    if (i === 0) {
      router.dismissAll()
      stack.current = ['chatHome']
    } else if (i > 0) {
      router.dismissTo(hrefOf(target))
      stack.current = pages.slice(0, i + 1)
    } else {
      router.push(hrefOf(target))
      stack.current = [...pages, target]
    }
  }, [flow.route])

  useEffect(() => {
    const name = nameOf(pathname)
    const pages = stack.current
    if (name === pages.at(-1)) return
    const i = pages.lastIndexOf(name)
    stack.current = i >= 0 ? pages.slice(0, i + 1) : [...pages, name]
    if (name !== flow.route) flow.onRouteChange(name)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])
}
