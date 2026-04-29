import { clerkMiddleware, createRouteMatcher } from '@clerk/astro/server';

const isAdminRoute = createRouteMatcher(['/admin(.*)']);

export const onRequest = clerkMiddleware((auth, context) => {
  if (isAdminRoute(context.request) && !auth().userId) {
    return auth().redirectToSignIn();
  }
});
