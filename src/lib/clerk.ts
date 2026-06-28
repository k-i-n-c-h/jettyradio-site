import { Clerk } from '@clerk/clerk-js'

let clerkInstance: Clerk | null = null
let clerkReady: Promise<void> | null = null

export function getClerk(): Promise<Clerk> {
  if (!clerkReady) {
    const key = import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY
    if (!key) throw new Error('Missing PUBLIC_CLERK_PUBLISHABLE_KEY')
    const clerk = new Clerk(key)
    clerkInstance = clerk
    clerkReady = clerk.load()
  }
  return clerkReady!.then(() => clerkInstance!)
}
