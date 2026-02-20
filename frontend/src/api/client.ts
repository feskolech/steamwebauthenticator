import axios, { type AxiosRequestConfig } from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json'
  }
});

let csrfToken: string | null = null;

async function refreshCsrfToken(): Promise<string> {
  const response = await api.get<{ csrfToken: string }>('/api/auth/csrf');
  csrfToken = response.data.csrfToken;
  return csrfToken;
}

function isSafeMethod(method?: string): boolean {
  if (!method) {
    return true;
  }
  return ['get', 'head', 'options'].includes(method.toLowerCase());
}

export async function request<T = unknown>(config: AxiosRequestConfig): Promise<T> {
  const method = config.method ?? 'get';
  if (!isSafeMethod(method)) {
    if (!csrfToken) {
      await refreshCsrfToken();
    }
    config.headers = {
      ...(config.headers ?? {}),
      'csrf-token': csrfToken
    };
  }

  try {
    const response = await api.request<T>(config);
    return response.data;
  } catch (error: any) {
    const maybeCode = error?.response?.data?.code || error?.response?.data?.message;
    if (
      !isSafeMethod(method) &&
      typeof maybeCode === 'string' &&
      maybeCode.toLowerCase().includes('csrf')
    ) {
      csrfToken = await refreshCsrfToken();
      const retryResponse = await api.request<T>({
        ...config,
        headers: {
          ...(config.headers ?? {}),
          'csrf-token': csrfToken
        }
      });
      return retryResponse.data;
    }

    throw error;
  }
}

export const apiClient = {
  get: <T>(url: string, config?: AxiosRequestConfig) => request<T>({ ...config, url, method: 'get' }),
  post: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    request<T>({ ...config, url, data, method: 'post' }),
  patch: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    request<T>({ ...config, url, data, method: 'patch' }),
  delete: <T>(url: string, config?: AxiosRequestConfig) =>
    request<T>({ ...config, url, method: 'delete' }),
  raw: api,
  refreshCsrfToken
};
