import api from './client';

export const listRules = () => api.get('/rules').then((r) => r.data);
export const updateRule = (id, patch) => api.patch(`/rules/${id}`, patch).then((r) => r.data);
