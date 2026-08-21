import api from './client';

export const listAlerts = (params) => api.get('/alerts', { params }).then((r) => r.data);

export const resolveAlert = (id, { outcome, note }) =>
  api.patch(`/alerts/${id}`, { outcome, note }).then((r) => r.data);
