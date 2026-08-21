import api from './client';

export const listTransactions = (params) =>
  api.get('/transactions', { params }).then((r) => r.data);

export const getTransaction = (id) => api.get(`/transactions/${id}`).then((r) => r.data);

export const scoreTransaction = (payload) =>
  api.post('/transactions/score', payload).then((r) => r.data);

export const getStats = (range = '24h') =>
  api.get('/transactions/stats', { params: { range } }).then((r) => r.data);
