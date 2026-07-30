import { post } from './apiClient.js';
import logger from '../utils/logger.js';

async function createMaxLog({
  maxUserId,
  eventType,
  eventName,
  metadata = {},
}) {
  if (!maxUserId || !eventType || !eventName) {
    return null;
  }

  try {
    const response = await post('/api/logs/create', {
      platform: 'max',
      platformUserId: String(maxUserId),
      source: 'max_bot',
      eventType: String(eventType).trim(),
      eventName: String(eventName).trim(),
      metadata:
        metadata && typeof metadata === 'object' && !Array.isArray(metadata)
          ? metadata
          : {},
    });

    return response.data;
  } catch (error) {
    logger.warn('MAX log create failed', {
      maxUserId: String(maxUserId),
      eventType,
      eventName,
      error: error.response?.data || error.message,
    });

    return null;
  }
}

export {
  createMaxLog,
};
