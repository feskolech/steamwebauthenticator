interface Window {
  turnstile?: {
    render: (
      container: string | HTMLElement,
      options: {
        sitekey: string;
        theme?: 'light' | 'dark' | 'auto';
        execution?: 'render' | 'execute';
        appearance?: 'always' | 'execute' | 'interaction-only';
        callback?: (token: string) => void;
        'expired-callback'?: () => void;
        'error-callback'?: () => void;
      }
    ) => string;
    remove: (widgetId: string) => void;
    reset: (widgetId?: string) => void;
    execute: (widgetId?: string) => void;
  };
}
