'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { queryDefaults } from '~/lib/hooks';

/**
 * React Query provider.
 *
 * The client is created once per browser instance inside state, not at module scope: a module
 * singleton would be shared by every request when this code runs on the server, leaking one
 * user's cache into another's render.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
    const [client] = useState(() => new QueryClient({ defaultOptions: queryDefaults }));
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
