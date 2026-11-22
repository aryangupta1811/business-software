import type { Permission } from '@business-software/shared';
import { createRouter, type RouterHistory } from '@tanstack/react-router';
import type { ParseKeys } from 'i18next';
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
  // A page names its title here; the top bar shows it as the page's <h1>.
  interface StaticDataRouteOption {
    titleKey?: ParseKeys;
    // What a login must hold to open the page; without it the page says "You can't open this
    // page". The server checks the same permission on every request (P1.5 design §6).
    permission?: Permission;
    // The page reads branch data, so the owner's branch picker shows in its top bar (P1.6).
    branchPicker?: boolean;
  }
}
