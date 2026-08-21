import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('fg_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error?.response?.status;
    if (status === 401) {
      localStorage.removeItem('fg_token');
      localStorage.removeItem('fg_user');
      if (!window.location.pathname.startsWith('/login')) window.location.assign('/login');
    }
    // Normalise every failure into one readable shape for the UI
    return Promise.reject({
      status: status ?? 0,
      message:
        error?.response?.data?.message ||
        (status ? 'The request could not be completed.' : 'Cannot reach the risk service.'),
    });
  }
);

export default api;
