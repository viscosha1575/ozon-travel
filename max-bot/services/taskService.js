import { post } from './apiClient.js';

async function getTasksForUser({ userId, apiBaseUrl }) {
  const res = await post('/api/tasks/user', {
    userId: String(userId),
  }, {
    apiBaseUrl,
  });

  return res.data;
}

async function completeTask({ taskId, userId, apiBaseUrl }) {
  const res = await post('/api/tasks/complete', {
    taskId: String(taskId),
    userId: String(userId),
  }, {
    apiBaseUrl,
  });

  return res.data;
}

export {
  completeTask,
  getTasksForUser,
};
