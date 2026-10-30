import { createRouter, type RouterHistory } from '@tanstack/react-router';
import { RouteError } from './components/route-error';
import { routeTree } from './routeTree.gen';

/** Browser history by default; tests pass a memory history to start at any path. */
export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    defaultErrorComponent: RouteError,
    ...(history && { history }),
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
