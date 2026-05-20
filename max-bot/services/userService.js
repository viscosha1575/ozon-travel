import { post } from './apiClient.js';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildFallbackNickname(maxUserId) {
  return `player_${String(maxUserId).trim()}`;
}

function isNicknameConflictError(error) {
  const status = Number(error?.response?.status);
  const message = String(error?.response?.data?.message || error?.message || '').toLowerCase();

  return status === 409 && (message.includes('никнейм') || message.includes('nickname'));
}

async function addUser({
  maxUserId,
  username,
  firstName,
  lastName,
  referralCode,
}) {
  const normalizedMaxUserId = String(maxUserId).trim();
  const normalizedUsername = normalizeString(username);
  const normalizedFirstName = normalizeString(firstName);
  const normalizedLastName = normalizeString(lastName);
  const fallbackNickname = buildFallbackNickname(normalizedMaxUserId);
  const preferredNickname = normalizedUsername || normalizedFirstName || fallbackNickname;

  const createPayload = {
    platform: 'max',
    firstName: normalizedFirstName,
    lastName: normalizedLastName,
    platformUserId: normalizedMaxUserId,
    platformNickname: normalizedUsername,
    invitedByReferralCode: referralCode || undefined,
  };

  try {
    const res = await post('/api/users/create', {
      ...createPayload,
      gameNickname: preferredNickname,
    });

    return res.data;
  } catch (error) {
    if (!isNicknameConflictError(error) || preferredNickname === fallbackNickname) {
      throw error;
    }

    const res = await post('/api/users/create', {
      ...createPayload,
      gameNickname: fallbackNickname,
    });

    return res.data;
  }
}

async function setSubscriptionStatus({ maxUserId, isSubscribed }) {
  const res = await post('/api/users/set-subscription-status', {
    platform: 'max',
    platformUserId: String(maxUserId),
    isSubscribed: Boolean(isSubscribed),
  });

  return res.data;
}

async function getUserByPlatform({ platform, platformUserId, apiBaseUrl }) {
  const res = await post('/api/users/get-by-platform', {
    platform,
    platformUserId: String(platformUserId),
  }, {
    apiBaseUrl,
  });

  return res.data;
}

async function getUserByMaxCode({ maxUniqueCode, platform, apiBaseUrl }) {
  const res = await post('/api/users/get-by-max-code', {
    maxUniqueCode: String(maxUniqueCode).trim().toUpperCase(),
    platform,
  }, {
    apiBaseUrl,
  });

  return res.data;
}

export {
  addUser,
  getUserByMaxCode,
  getUserByPlatform,
  setSubscriptionStatus,
};
