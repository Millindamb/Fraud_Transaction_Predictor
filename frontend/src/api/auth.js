import api from './client';

export const login = (email, password) =>
  api.post('/auth/login', { email, password }).then((r) => r.data);

export const me = () => api.get('/auth/me').then((r) => r.data);
