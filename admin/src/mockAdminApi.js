function hoursAgo(value) {
  return new Date(Date.now() - value * 60 * 60 * 1000).toISOString();
}

function daysAgo(value, extraHours = 0) {
  return new Date(Date.now() - (value * 24 + extraHours) * 60 * 60 * 1000).toISOString();
}

function buildDisplayName(player) {
  return [player.firstName, player.lastName].filter(Boolean).join(" ").trim() || player.username || `Игрок #${player.id}`;
}

function createMockPlayer({
  id,
  username,
  firstName,
  lastName,
  daysCreatedAgo,
  hoursSeenAgo,
  hasReferral = false,
  referredByCode = null,
  subscribedToChannel = false,
  utmSlug = null,
  gameCompletionState = null,
  raffleWon = null,
  codeId = null,
  promoCode = null,
}) {
  return {
    id,
    telegramUserId: 900000 + id,
    username,
    firstName,
    lastName,
    referralCode: `OZONTRAVEL-${String(id).padStart(4, "0")}`,
    referredByCode,
    hasReferral,
    subscribedToChannel,
    utmSlug,
    gameCompletionState,
    raffleWon,
    codeId,
    promoCode,
    authProvider: "telegram",
    createdAt: daysAgo(daysCreatedAgo, id % 6),
    updatedAt: hoursAgo(Math.max(1, hoursSeenAgo - 1)),
    lastSeenAt: hoursAgo(hoursSeenAgo),
  };
}

function createMockSession({
  id,
  playerId,
  status,
  foundSneakersCount,
  remainingSeconds,
  daysStartedAgo,
  hoursStartedAgo = 0,
  pauseCount = 0,
  finishedOffsetHours = null,
}) {
  const startedAt = new Date(Date.now() - ((daysStartedAgo * 24) + hoursStartedAgo) * 60 * 60 * 1000);
  const finishedAt = finishedOffsetHours == null ? null : new Date(startedAt.getTime() + finishedOffsetHours * 60 * 60 * 1000);

  return {
    id,
    playerId,
    status,
    remainingSeconds,
    foundSneakersCount,
    pauseCount,
    startedAt: startedAt.toISOString(),
    lastResumedAt: startedAt.toISOString(),
    lastPausedAt: pauseCount > 0 ? new Date(startedAt.getTime() + 20 * 60 * 1000).toISOString() : null,
    lastHeartbeatAt: new Date(startedAt.getTime() + 35 * 60 * 1000).toISOString(),
    finishedAt: finishedAt ? finishedAt.toISOString() : null,
    expiredAt: null,
  };
}

function createMockLog({
  id,
  playerId,
  gameSessionId,
  source = "unity",
  action,
  details,
  hoursAgoValue,
}) {
  return {
    id,
    playerId,
    gameSessionId,
    source,
    action,
    details,
    createdAt: hoursAgo(hoursAgoValue),
  };
}

function createMockPromoCode({
  id,
  code,
  assignedPlayerId = null,
  hoursCreatedAgo = 24,
  hoursAssignedAgo = null,
}) {
  return {
    id,
    code,
    assignedPlayerId,
    assignedAt: hoursAssignedAgo == null ? null : hoursAgo(hoursAssignedAgo),
    createdAt: hoursAgo(hoursCreatedAgo),
    updatedAt: hoursAgo(hoursAssignedAgo ?? hoursCreatedAgo),
  };
}

function createMockPrize({
  id,
  title,
  category,
  promoCodeType = "",
  type,
  hasPrizeLimit = true,
  promoCodesFileName = "",
  promoCodes = [],
  promoCodeValue = "",
  totalCount = 0,
  remainingCount = 0,
  chanceValue = "1x",
  hasUserLimit = true,
  userLimitCount = 1,
  activeFrom = "",
  activeTo = "",
  rouletteImage = null,
  myPrizeText = "",
  rouletteDescription = "",
}) {
  return {
    id,
    title,
    category,
    promoCodeType,
    type,
    hasPrizeLimit,
    promoCodesFileName,
    promoCodes,
    promoCodeValue,
    totalCount,
    remainingCount,
    chanceValue,
    hasUserLimit,
    userLimitCount,
    activeFrom,
    activeTo,
    rouletteImage,
    myPrizeText,
    rouletteDescription,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function createMockPush({
  id,
  title,
  message,
  html = "",
  audienceKey = "all_users",
  audienceLabel,
  selectedUsers = [],
  imageUrl = null,
  disableLinkPreview = false,
  status = "template",
  recipientsCount = 0,
  deliveredCount = 0,
  openedCount = 0,
  clickedCount = 0,
  hoursCreatedAgo = 24,
  hoursScheduledAgo = null,
  hoursSentAgo = null,
  hoursTestSentAgo = null,
}) {
  return {
    id,
    title,
    message,
    html,
    audienceKey,
    audienceLabel,
    selectedUsers,
    imageUrl,
    disableLinkPreview: Boolean(disableLinkPreview),
    status,
    recipientsCount,
    deliveredCount,
    openedCount,
    clickedCount,
    createdAt: hoursAgo(hoursCreatedAgo),
    scheduledAt: hoursScheduledAgo == null ? null : hoursAgo(hoursScheduledAgo),
    sentAt: hoursSentAgo == null ? null : hoursAgo(hoursSentAgo),
    testSentAt: hoursTestSentAgo == null ? null : hoursAgo(hoursTestSentAgo),
    updatedAt: hoursAgo(hoursSentAgo ?? hoursScheduledAgo ?? hoursCreatedAgo),
  };
}

const mockState = {
  players: [
    createMockPlayer({ id: 1, username: "mila.design", firstName: "Мила", lastName: "Иванова", daysCreatedAgo: 1, hoursSeenAgo: 0.15, subscribedToChannel: true, gameCompletionState: "completed", raffleWon: true, codeId: "12345678", promoCode: "TEST-OZONTRAVEL-0001" }),
    createMockPlayer({ id: 2, username: "roma.runner", firstName: "Роман", lastName: "Петров", daysCreatedAgo: 2, hoursSeenAgo: 1.2, gameCompletionState: "time-ended", raffleWon: false }),
    createMockPlayer({ id: 3, username: "katya.style", firstName: "Катя", lastName: "Соколова", daysCreatedAgo: 3, hoursSeenAgo: 0.5, hasReferral: true, referredByCode: "OZONTRAVEL-0001", subscribedToChannel: true, gameCompletionState: "completed", promoCode: "TEST-OZONTRAVEL-0002" }),
    createMockPlayer({ id: 4, username: "nikita.arc", firstName: "Никита", lastName: "Орлов", daysCreatedAgo: 4, hoursSeenAgo: 5.2 }),
    createMockPlayer({ id: 5, username: "dasha.wave", firstName: "Дарья", lastName: "Морозова", daysCreatedAgo: 5, hoursSeenAgo: 0.35, hasReferral: true, referredByCode: "OZONTRAVEL-0003", subscribedToChannel: true, gameCompletionState: "completed-after-time", promoCode: "TEST-OZONTRAVEL-0003" }),
    createMockPlayer({ id: 6, username: "artem.k", firstName: "Артем", lastName: "Кузнецов", daysCreatedAgo: 6, hoursSeenAgo: 13 }),
    createMockPlayer({ id: 7, username: "vika.move", firstName: "Вика", lastName: "Семенова", daysCreatedAgo: 7, hoursSeenAgo: 0.8, gameCompletionState: "time-ended" }),
    createMockPlayer({ id: 8, username: "alex.kick", firstName: "Алексей", lastName: "Федоров", daysCreatedAgo: 8, hoursSeenAgo: 24 }),
    createMockPlayer({ id: 9, username: "sonya.sun", firstName: "Соня", lastName: "Лебедева", daysCreatedAgo: 9, hoursSeenAgo: 1.7, subscribedToChannel: true, gameCompletionState: "completed", raffleWon: false, promoCode: "TEST-OZONTRAVEL-0004" }),
    createMockPlayer({ id: 10, username: "tim.trail", firstName: "Тимур", lastName: "Егоров", daysCreatedAgo: 10, hoursSeenAgo: 33 }),
    createMockPlayer({ id: 11, username: "lena.run", firstName: "Елена", lastName: "Новикова", daysCreatedAgo: 11, hoursSeenAgo: 0.4 }),
    createMockPlayer({ id: 12, username: "max.field", firstName: "Максим", lastName: "Громов", daysCreatedAgo: 14, hoursSeenAgo: 8 }),
  ],
  sessions: [
    createMockSession({ id: 101, playerId: 1, status: "finished", foundSneakersCount: 10, remainingSeconds: 0, daysStartedAgo: 0, hoursStartedAgo: 2, finishedOffsetHours: 0.12 }),
    createMockSession({ id: 102, playerId: 2, status: "finished", foundSneakersCount: 8, remainingSeconds: 0, daysStartedAgo: 0, hoursStartedAgo: 4, pauseCount: 1, finishedOffsetHours: 0.2 }),
    createMockSession({ id: 103, playerId: 3, status: "active", foundSneakersCount: 6, remainingSeconds: 284, daysStartedAgo: 0, hoursStartedAgo: 1 }),
    createMockSession({ id: 104, playerId: 4, status: "paused", foundSneakersCount: 4, remainingSeconds: 412, daysStartedAgo: 1, hoursStartedAgo: 3, pauseCount: 2 }),
    createMockSession({ id: 105, playerId: 5, status: "finished", foundSneakersCount: 10, remainingSeconds: 0, daysStartedAgo: 1, hoursStartedAgo: 7, finishedOffsetHours: 0.15 }),
    createMockSession({ id: 106, playerId: 6, status: "finished", foundSneakersCount: 7, remainingSeconds: 0, daysStartedAgo: 2, hoursStartedAgo: 2, finishedOffsetHours: 0.18 }),
    createMockSession({ id: 107, playerId: 7, status: "active", foundSneakersCount: 2, remainingSeconds: 521, daysStartedAgo: 2, hoursStartedAgo: 6 }),
    createMockSession({ id: 108, playerId: 8, status: "finished", foundSneakersCount: 9, remainingSeconds: 0, daysStartedAgo: 3, hoursStartedAgo: 4, finishedOffsetHours: 0.2 }),
    createMockSession({ id: 109, playerId: 9, status: "finished", foundSneakersCount: 10, remainingSeconds: 0, daysStartedAgo: 3, hoursStartedAgo: 9, finishedOffsetHours: 0.11 }),
    createMockSession({ id: 110, playerId: 10, status: "active", foundSneakersCount: 1, remainingSeconds: 566, daysStartedAgo: 4, hoursStartedAgo: 5 }),
    createMockSession({ id: 111, playerId: 11, status: "paused", foundSneakersCount: 5, remainingSeconds: 337, daysStartedAgo: 5, hoursStartedAgo: 1, pauseCount: 1 }),
    createMockSession({ id: 112, playerId: 12, status: "finished", foundSneakersCount: 6, remainingSeconds: 0, daysStartedAgo: 6, hoursStartedAgo: 10, finishedOffsetHours: 0.22 }),
    createMockSession({ id: 113, playerId: 1, status: "finished", foundSneakersCount: 10, remainingSeconds: 0, daysStartedAgo: 7, hoursStartedAgo: 2, finishedOffsetHours: 0.1 }),
    createMockSession({ id: 114, playerId: 3, status: "finished", foundSneakersCount: 10, remainingSeconds: 0, daysStartedAgo: 8, hoursStartedAgo: 5, finishedOffsetHours: 0.14 }),
    createMockSession({ id: 115, playerId: 5, status: "finished", foundSneakersCount: 10, remainingSeconds: 0, daysStartedAgo: 10, hoursStartedAgo: 8, finishedOffsetHours: 0.16 }),
    createMockSession({ id: 116, playerId: 7, status: "finished", foundSneakersCount: 8, remainingSeconds: 0, daysStartedAgo: 12, hoursStartedAgo: 3, finishedOffsetHours: 0.2 }),
    createMockSession({ id: 117, playerId: 9, status: "finished", foundSneakersCount: 10, remainingSeconds: 0, daysStartedAgo: 15, hoursStartedAgo: 4, finishedOffsetHours: 0.12 }),
    createMockSession({ id: 118, playerId: 11, status: "active", foundSneakersCount: 3, remainingSeconds: 487, daysStartedAgo: 20, hoursStartedAgo: 6 }),
  ],
  logs: [
    createMockLog({ id: 1001, playerId: 1, gameSessionId: 101, action: "found-sneaker", details: { sneakerNumber: 10 }, hoursAgoValue: 1.7 }),
    createMockLog({ id: 1002, playerId: 1, gameSessionId: 101, action: "swipe", details: { direction: "left" }, hoursAgoValue: 1.9 }),
    createMockLog({ id: 1003, playerId: 2, gameSessionId: 102, action: "finish", details: { reason: "time-ended" }, hoursAgoValue: 3.5 }),
    createMockLog({ id: 1004, playerId: 3, gameSessionId: 103, action: "heartbeat", details: { status: "active" }, hoursAgoValue: 0.3 }),
    createMockLog({ id: 1005, playerId: 4, gameSessionId: 104, action: "pause", details: { count: 2 }, hoursAgoValue: 20 }),
    createMockLog({ id: 1006, playerId: 5, gameSessionId: 105, action: "found-sneaker", details: { sneakerNumber: 10 }, hoursAgoValue: 29 }),
    createMockLog({ id: 1007, playerId: 6, gameSessionId: 106, action: "swipe", details: { direction: "right" }, hoursAgoValue: 49 }),
    createMockLog({ id: 1008, playerId: 7, gameSessionId: 107, action: "heartbeat", details: { status: "active" }, hoursAgoValue: 54 }),
    createMockLog({ id: 1009, playerId: 8, gameSessionId: 108, action: "finish", details: { reason: "time-ended" }, hoursAgoValue: 76 }),
    createMockLog({ id: 1010, playerId: 9, gameSessionId: 109, action: "promo-issued", details: { promoCode: "TEST-OZONTRAVEL-0004" }, hoursAgoValue: 82 }),
    createMockLog({ id: 1011, playerId: 10, gameSessionId: 110, action: "start", details: { source: "unity" }, hoursAgoValue: 101 }),
    createMockLog({ id: 1012, playerId: 11, gameSessionId: 111, action: "pause", details: { count: 1 }, hoursAgoValue: 121 }),
    createMockLog({ id: 1013, playerId: 12, gameSessionId: 112, action: "finish", details: { reason: "time-ended" }, hoursAgoValue: 147 }),
  ],
  utmVisits: [
    { id: 2001, playerId: 1, utmSlug: "test", wasExistingPlayer: false, createdAt: hoursAgo(3) },
    { id: 2002, playerId: 3, utmSlug: "test", wasExistingPlayer: true, createdAt: hoursAgo(12) },
    { id: 2003, playerId: 5, utmSlug: "test", wasExistingPlayer: true, createdAt: hoursAgo(30) },
    { id: 2004, playerId: 2, utmSlug: "summerdrop", wasExistingPlayer: false, createdAt: hoursAgo(18) },
    { id: 2005, playerId: 7, utmSlug: "summerdrop", wasExistingPlayer: true, createdAt: hoursAgo(40) },
    { id: 2006, playerId: 9, utmSlug: "story", wasExistingPlayer: false, createdAt: hoursAgo(5) },
    { id: 2007, playerId: 9, utmSlug: "story", wasExistingPlayer: true, createdAt: hoursAgo(2) },
  ],
  promoCodes: [
    createMockPromoCode({ id: 3001, code: "TEST-OZONTRAVEL-0001", assignedPlayerId: 1, hoursCreatedAgo: 60, hoursAssignedAgo: 48 }),
    createMockPromoCode({ id: 3002, code: "TEST-OZONTRAVEL-0002", assignedPlayerId: 3, hoursCreatedAgo: 58, hoursAssignedAgo: 40 }),
    createMockPromoCode({ id: 3003, code: "TEST-OZONTRAVEL-0003", assignedPlayerId: 5, hoursCreatedAgo: 52, hoursAssignedAgo: 24 }),
    createMockPromoCode({ id: 3004, code: "TEST-OZONTRAVEL-0004", assignedPlayerId: 9, hoursCreatedAgo: 46, hoursAssignedAgo: 18 }),
    createMockPromoCode({ id: 3005, code: "FRESH-OZONTRAVEL-0005", hoursCreatedAgo: 8 }),
    createMockPromoCode({ id: 3006, code: "FRESH-OZONTRAVEL-0006", hoursCreatedAgo: 2 }),
  ],
  prizes: [
    createMockPrize({
      id: 3501,
      title: "Скидка 800 ₽ на первый заказ отеля от 15 000 ₽",
      category: "Отели",
      promoCodeType: "Промокод на повторный заказ",
      type: "Приз",
      hasPrizeLimit: true,
      promoCodesFileName: "hotels-repeat.csv",
      promoCodes: ["HOTEL-800-001", "HOTEL-800-002", "HOTEL-800-003"],
      totalCount: 800,
      remainingCount: 215,
      chanceValue: "1x",
      hasUserLimit: true,
      userLimitCount: 1,
      activeFrom: "2026-05-01",
      activeTo: "2026-08-31",
      myPrizeText: "Скидка 800 ₽",
      rouletteDescription: "Скидка 800 ₽ на повторный заказ отеля от 15 000 ₽",
    }),
    createMockPrize({
      id: 3502,
      title: "Скидка 300 ₽ на заказ отеля от 5 000 ₽",
      category: "Отели",
      promoCodeType: "Промокод на первый заказ",
      type: "Приз",
      hasPrizeLimit: true,
      promoCodesFileName: "hotels-first.csv",
      promoCodes: ["HOTEL-300-001", "HOTEL-300-002", "HOTEL-300-003"],
      totalCount: 1500,
      remainingCount: 910,
      chanceValue: "1x",
      hasUserLimit: true,
      userLimitCount: 1,
      activeFrom: "2026-05-01",
      activeTo: "2026-08-31",
      myPrizeText: "Скидка 300 ₽",
      rouletteDescription: "Скидка 300 ₽ на первый заказ отеля от 5 000 ₽",
    }),
    createMockPrize({
      id: 3503,
      title: "Скидка 800 ₽ на первый заказ авиа от 15 000 ₽",
      category: "Авиа",
      promoCodeType: "Промокод на первый заказ",
      type: "Приз",
      hasPrizeLimit: true,
      promoCodesFileName: "avia-first.csv",
      promoCodes: ["AVIA-800-001", "AVIA-800-002", "AVIA-800-003"],
      totalCount: 950,
      remainingCount: 264,
      chanceValue: "1x",
      hasUserLimit: true,
      userLimitCount: 1,
      activeFrom: "2026-05-01",
      activeTo: "2026-08-31",
      myPrizeText: "Скидка 800 ₽",
      rouletteDescription: "Скидка 800 ₽ на первый заказ авиа от 15 000 ₽",
    }),
    createMockPrize({
      id: 3504,
      title: "Скидка 300 ₽ на заказ авиа от 15 000 ₽",
      category: "Авиа",
      promoCodeType: "Промокод на повторный заказ",
      type: "Приз",
      hasPrizeLimit: false,
      promoCodeValue: "AVIA-UNLIM-300",
      totalCount: 0,
      remainingCount: 0,
      chanceValue: "1x",
      hasUserLimit: false,
      userLimitCount: 0,
      activeFrom: "2026-05-01",
      activeTo: "2026-08-31",
      myPrizeText: "Скидка 300 ₽",
      rouletteDescription: "Скидка 300 ₽ на повторный заказ авиа без общего лимита призов",
    }),
    createMockPrize({
      id: 3505,
      title: "1 000 баллов Ozon",
      category: "",
      promoCodeType: "",
      type: "Не приз",
      hasPrizeLimit: true,
      totalCount: 3000,
      remainingCount: 1860,
      chanceValue: "1x",
      hasUserLimit: true,
      userLimitCount: 1,
      activeFrom: "2026-05-01",
      activeTo: "2026-06-30",
      myPrizeText: "1 000 баллов Ozon",
      rouletteDescription: "Начисление 1 000 баллов Ozon",
    }),
    createMockPrize({
      id: 3506,
      title: "300 миль",
      category: "",
      promoCodeType: "",
      type: "Не приз",
      hasPrizeLimit: true,
      totalCount: 5000,
      remainingCount: 3220,
      chanceValue: "1x",
      hasUserLimit: true,
      userLimitCount: 1,
      activeFrom: "2026-05-01",
      activeTo: "2026-06-30",
      myPrizeText: "300 миль",
      rouletteDescription: "Начисление 300 миль",
    }),
  ],
  pushes: [
    createMockPush({
      id: 4001,
      title: "Финальный день розыгрыша",
      message: "Напоминаем: сегодня последний шанс получить тревел-приз.",
      html: "<p>Напоминаем: сегодня последний шанс получить тревел-приз.</p>",
      audienceKey: "all_users",
      audienceLabel: "Все пользователи",
      status: "sent",
      recipientsCount: 14820,
      deliveredCount: 14230,
      openedCount: 5296,
      clickedCount: 1350,
      hoursCreatedAgo: 72,
      hoursScheduledAgo: 49,
      hoursSentAgo: 48,
    }),
    createMockPush({
      id: 4002,
      title: "Вернись в игру",
      message: "Ты почти у цели: до приза осталось совсем немного.",
      html: "<p>Ты почти у цели: до приза осталось совсем немного.</p>",
      audienceKey: "selected_users",
      audienceLabel: "2 пользователя",
      selectedUsers: [
        { id: 2, displayName: "Роман Петров", username: "roma.runner", telegramUserId: 900002 },
        { id: 4, displayName: "Никита Орлов", username: "nikita.arc", telegramUserId: 900004 },
      ],
      status: "sent",
      recipientsCount: 2,
      deliveredCount: 2,
      openedCount: 1,
      clickedCount: 1,
      hoursCreatedAgo: 54,
      hoursScheduledAgo: 30,
      hoursSentAgo: 28,
    }),
    createMockPush({
      id: 4003,
      title: "Тест новой коммуникации",
      message: "Проверяем формат сообщения перед основной волной.",
      html: "<p>Проверяем формат сообщения перед основной волной.</p>",
      audienceKey: "all_users",
      audienceLabel: "Все пользователи",
      status: "scheduled",
      recipientsCount: 14820,
      deliveredCount: 0,
      openedCount: 0,
      clickedCount: 0,
      hoursCreatedAgo: 12,
      hoursScheduledAgo: -6,
    }),
    createMockPush({
      id: 4004,
      title: "Вечерняя волна по призам",
      message: "Собрали для тебя напоминание о призах и доступе в игру.",
      html: "<p>Собрали для тебя напоминание о призах и доступе в игру.</p>",
      audienceKey: "selected_users",
      audienceLabel: "3 пользователя",
      selectedUsers: [
        { id: 1, displayName: "Мила Иванова", username: "mila.design", telegramUserId: 900001 },
        { id: 3, displayName: "Катя Соколова", username: "katya.style", telegramUserId: 900003 },
        { id: 9, displayName: "Соня Лебедева", username: "sonya.sun", telegramUserId: 900009 },
      ],
      status: "template",
      recipientsCount: 3,
      deliveredCount: 0,
      openedCount: 0,
      clickedCount: 0,
      hoursCreatedAgo: 3,
      hoursTestSentAgo: 1,
    }),
  ],
};

function getRangeStart(range) {
  const now = new Date();

  if (range === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  if (range === "7d") {
    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }

  if (range === "30d") {
    return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  return null;
}

function parseDateStart(value) {
  if (!value) {
    return null;
  }

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function parseDateEnd(value) {
  if (!value) {
    return null;
  }

  const date = new Date(`${value}T23:59:59.999`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function getBucketDates(range, rangeStart = null, rangeEnd = null) {
  const now = new Date();
  const buckets = [];

  if (range === "custom") {
    const startSource = rangeStart || rangeEnd || new Date();
    const endSource = rangeEnd || rangeStart || new Date();
    const start = new Date(startSource.getFullYear(), startSource.getMonth(), startSource.getDate());
    const end = new Date(endSource.getFullYear(), endSource.getMonth(), endSource.getDate());
    const cursor = new Date(start);

    while (cursor.getTime() <= end.getTime()) {
      buckets.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }

    return buckets;
  }

  if (range === "today") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    for (let hour = 0; hour < 24; hour += 1) {
      buckets.push(new Date(start.getTime() + hour * 60 * 60 * 1000));
    }
    return buckets;
  }

  if (range === "7d" || range === "30d") {
    const totalDays = range === "7d" ? 7 : 30;
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    start.setDate(start.getDate() - (totalDays - 1));
    for (let index = 0; index < totalDays; index += 1) {
      buckets.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
    }
    return buckets;
  }

  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  for (let offset = 11; offset >= 0; offset -= 1) {
    buckets.push(new Date(start.getFullYear(), start.getMonth() - offset, 1));
  }
  return buckets;
}

function bucketKey(date, range) {
  const value = new Date(date);
  if (range === "custom") {
    return `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`;
  }
  if (range === "today") {
    return `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}-${value.getHours()}`;
  }
  if (range === "all") {
    return `${value.getFullYear()}-${value.getMonth()}`;
  }
  return `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`;
}

function bucketLabel(date, range) {
  if (range === "custom") {
    return new Date(date).toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
    });
  }

  if (range === "today") {
    return new Date(date).toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  if (range === "all") {
    return new Date(date).toLocaleDateString("ru-RU", {
      month: "short",
      year: "2-digit",
    });
  }

  return new Date(date).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
  });
}

function isInRange(dateValue, rangeStart, rangeEnd = null) {
  const time = new Date(dateValue).getTime();

  if (Number.isNaN(time)) {
    return false;
  }

  if (rangeStart && time < rangeStart.getTime()) {
    return false;
  }

  if (rangeEnd && time > rangeEnd.getTime()) {
    return false;
  }

  return true;
}

function getCompletedInSeconds(session) {
  if (session.status !== "finished") {
    return 0;
  }

  return Math.max(0, 600 - Number(session.remainingSeconds || 0));
}

function getPlayerStats(playerId) {
  const sessions = mockState.sessions.filter((session) => session.playerId === playerId);
  const finished = sessions.filter((session) => session.status === "finished");
  const completedDurations = finished.map(getCompletedInSeconds).filter(Boolean);
  const totalDurationSeconds = completedDurations.reduce((sum, value) => sum + value, 0);
  const recentSession = sessions.slice().sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0] || null;

  return {
    totalSessions: sessions.length,
    finishedSessions: finished.length,
    totalDurationSeconds,
    bestDurationSeconds: completedDurations.length > 0 ? Math.min(...completedDurations) : 0,
    averageDurationSeconds: completedDurations.length > 0 ? Math.round(totalDurationSeconds / completedDurations.length) : 0,
    totalActivityLogs: mockState.logs.filter((log) => log.playerId === playerId).length,
    lastSessionAt: recentSession?.startedAt ?? null,
  };
}

function buildPlayerView(player) {
  return {
    ...player,
    displayName: buildDisplayName(player),
    isOnline: Date.now() - new Date(player.lastSeenAt).getTime() <= 15 * 1000,
    ...getPlayerStats(player.id),
  };
}

function buildUtmResponse(payload = {}) {
  const search = normalizeSearch(payload?.search);
  const grouped = new Map();

  for (const visit of mockState.utmVisits) {
    if (!grouped.has(visit.utmSlug)) {
      grouped.set(visit.utmSlug, []);
    }

    grouped.get(visit.utmSlug).push(visit);
  }

  let items = Array.from(grouped.entries()).map(([utmSlug, visits]) => ({
    utmSlug,
    newUsersCount: new Set(
      visits.filter((visit) => !visit.wasExistingPlayer).map((visit) => visit.playerId),
    ).size,
    returningUsersCount: new Set(
      visits.filter((visit) => visit.wasExistingPlayer).map((visit) => visit.playerId),
    ).size,
    totalClicksCount: visits.length,
    lastClickAt: visits
      .slice()
      .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))[0]?.createdAt ?? null,
  }));

  if (search) {
    items = items.filter((item) => item.utmSlug.toLowerCase().includes(search));
  }

  items.sort((left, right) => right.totalClicksCount - left.totalClicksCount || left.utmSlug.localeCompare(right.utmSlug));

  return {
    items,
    summary: {
      totalUtmsCount: items.length,
      totalClicksCount: items.reduce((sum, item) => sum + item.totalClicksCount, 0),
      totalNewUsersCount: items.reduce((sum, item) => sum + item.newUsersCount, 0),
    },
  };
}

function buildPromoCodesResponse(payload = {}) {
  const search = normalizeSearch(payload?.search);
  const status = payload?.status === "issued" || payload?.status === "new" ? payload.status : "all";
  let items = mockState.promoCodes.map((promoCode) => {
    const player = promoCode.assignedPlayerId
      ? buildPlayerView(mockState.players.find((item) => item.id === promoCode.assignedPlayerId))
      : null;

    return {
      ...promoCode,
      player,
    };
  });

  if (search) {
    items = items.filter((item) => {
      const haystack = [
        item.code,
        item.player?.displayName,
        item.player?.username,
        item.player?.telegramUserId,
      ].join(" ").toLowerCase();

      return haystack.includes(search);
    });
  }

  if (status === "issued") {
    items = items.filter((item) => item.assignedPlayerId);
  }

  if (status === "new") {
    items = items.filter((item) => !item.assignedPlayerId);
  }

  items.sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));

  return {
    items,
    summary: {
      totalCodesCount: items.length,
      issuedCodesCount: items.filter((item) => item.assignedPlayerId).length,
      newCodesCount: items.filter((item) => !item.assignedPlayerId).length,
    },
  };
}

function buildPrizesResponse(payload = {}) {
  const search = normalizeSearch(payload?.search);
  let items = mockState.prizes.slice();

  if (search) {
    items = items.filter((item) => {
      const haystack = [
        item.title,
        item.type,
        item.category,
        item.promoCodeType,
        item.promoCodeValue,
        item.myPrizeText,
        item.rouletteDescription,
      ].join(" ").toLowerCase();
      return haystack.includes(search);
    });
  }

  items.sort((left, right) => left.title.localeCompare(right.title, "ru"));

  return {
    items,
    summary: {
      totalPrizesCount: items.length,
      totalUnitsCount: items.reduce((sum, item) => sum + Number(item.totalCount || 0), 0),
      totalRemainingCount: items.reduce((sum, item) => sum + Number(item.remainingCount || 0), 0),
    },
  };
}

function parseChanceWeight(value) {
  const normalizedValue = String(value || "")
    .trim()
    .replace(",", ".")
    .replace(/x$/i, "");
  const parsedValue = Number(normalizedValue);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return 0;
  }

  return parsedValue;
}

function buildChancesResponse(payload = {}) {
  const search = normalizeSearch(payload?.search);
  const allItems = mockState.prizes.slice();
  const totalWeight = allItems.reduce((sum, item) => sum + parseChanceWeight(item.chanceValue), 0);
  let items = allItems;

  if (search) {
    items = items.filter((item) => {
      const haystack = [
        item.title,
        item.type,
        item.category,
        item.promoCodeType,
        item.chanceValue,
      ].join(" ").toLowerCase();
      return haystack.includes(search);
    });
  }

  items = items
    .map((item) => {
      const chanceWeight = parseChanceWeight(item.chanceValue);
      const probabilityPercent = totalWeight > 0 ? (chanceWeight / totalWeight) * 100 : 0;

      return {
        ...item,
        chanceWeight,
        probabilityPercent,
      };
    })
    .sort((left, right) => {
      const categoryCompare = String(left.category || "Без категории").localeCompare(
        String(right.category || "Без категории"),
        "ru",
      );

      if (categoryCompare !== 0) {
        return categoryCompare;
      }

      return left.title.localeCompare(right.title, "ru");
    });

  return {
    items,
    summary: {
      totalPositionsCount: allItems.length,
      totalWeight,
    },
  };
}

function createPrize(payload = {}) {
  const title = String(payload?.title || "").trim();
  const category = String(payload?.category || "").trim();
  const promoCodeType = String(payload?.promoCodeType || "").trim();
  const type = String(payload?.type || "").trim();
  const hasPrizeLimit = Boolean(payload?.hasPrizeLimit);
  const promoCodesFileName = String(payload?.promoCodesFileName || "").trim();
  const promoCodes = Array.isArray(payload?.promoCodes)
    ? payload.promoCodes.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const promoCodeValue = String(payload?.promoCodeValue || "").trim();
  const totalCount = hasPrizeLimit ? Math.max(0, Number(payload?.totalCount) || 0) : 0;
  const chanceValue = String(payload?.chanceValue || "1x").trim() || "1x";
  const hasUserLimit = Boolean(payload?.hasUserLimit);
  const userLimitCount = hasUserLimit ? Math.max(0, Number(payload?.userLimitCount) || 0) : 0;
  const activeFrom = String(payload?.activeFrom || "").trim();
  const activeTo = String(payload?.activeTo || "").trim();
  const rouletteImage = payload?.rouletteImage ?? null;
  const myPrizeText = String(payload?.myPrizeText || "").trim();
  const rouletteDescription = String(payload?.rouletteDescription || "").trim();

  if (!title) {
    throw new Error("Prize title is required");
  }

  if (type !== "Не приз" && !category) {
    throw new Error("Prize category is required");
  }

  if (!type) {
    throw new Error("Prize type is required");
  }

  if (hasPrizeLimit && !totalCount) {
    throw new Error("Prize total count is required");
  }

  if (hasUserLimit && !userLimitCount) {
    throw new Error("Prize user limit count is required");
  }

  const nextPrize = createMockPrize({
    id: Math.max(0, ...mockState.prizes.map((item) => item.id)) + 1,
    title,
    category,
    promoCodeType,
    type,
    hasPrizeLimit,
    promoCodesFileName,
    promoCodes,
    promoCodeValue,
    totalCount,
    remainingCount: hasPrizeLimit ? totalCount : 0,
    chanceValue,
    hasUserLimit,
    userLimitCount,
    activeFrom,
    activeTo,
    rouletteImage,
    myPrizeText,
    rouletteDescription,
  });

  mockState.prizes.unshift(nextPrize);

  return {
    created: true,
    prize: nextPrize,
  };
}

function updateChanceValue(payload = {}) {
  const id = Number(payload?.id);
  const chanceValue = String(payload?.chanceValue || "").trim();

  if (!id) {
    throw new Error("Prize id is required");
  }

  if (!chanceValue) {
    throw new Error("Chance value is required");
  }

  const prize = mockState.prizes.find((item) => item.id === id);

  if (!prize) {
    throw new Error("Prize not found");
  }

  prize.chanceValue = chanceValue;
  prize.updatedAt = new Date().toISOString();

  return {
    updated: true,
    prize,
  };
}

function updatePrize(payload = {}) {
  const id = Number(payload?.id);
  const title = String(payload?.title || "").trim();
  const category = String(payload?.category || "").trim();
  const promoCodeType = String(payload?.promoCodeType || "").trim();
  const type = String(payload?.type || "").trim();
  const hasPrizeLimit = Boolean(payload?.hasPrizeLimit);
  const promoCodesFileName = String(payload?.promoCodesFileName || "").trim();
  const promoCodes = Array.isArray(payload?.promoCodes)
    ? payload.promoCodes.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const promoCodeValue = String(payload?.promoCodeValue || "").trim();
  const totalCount = hasPrizeLimit ? Math.max(0, Number(payload?.totalCount) || 0) : 0;
  const chanceValue = String(payload?.chanceValue || "1x").trim() || "1x";
  const hasUserLimit = Boolean(payload?.hasUserLimit);
  const userLimitCount = hasUserLimit ? Math.max(0, Number(payload?.userLimitCount) || 0) : 0;
  const activeFrom = String(payload?.activeFrom || "").trim();
  const activeTo = String(payload?.activeTo || "").trim();
  const rouletteImage = payload?.rouletteImage ?? null;
  const myPrizeText = String(payload?.myPrizeText || "").trim();
  const rouletteDescription = String(payload?.rouletteDescription || "").trim();

  if (!id) {
    throw new Error("Prize id is required");
  }

  if (!title) {
    throw new Error("Prize title is required");
  }

  if (type !== "Не приз" && !category) {
    throw new Error("Prize category is required");
  }

  if (!type) {
    throw new Error("Prize type is required");
  }

  if (hasPrizeLimit && !totalCount) {
    throw new Error("Prize total count is required");
  }

  if (hasUserLimit && !userLimitCount) {
    throw new Error("Prize user limit count is required");
  }

  const prizeIndex = mockState.prizes.findIndex((item) => item.id === id);

  if (prizeIndex === -1) {
    throw new Error("Prize not found");
  }

  const currentPrize = mockState.prizes[prizeIndex];
  const usedCount = Math.max(0, Number(currentPrize.totalCount || 0) - Number(currentPrize.remainingCount || 0));
  const nextPrize = {
    ...currentPrize,
    title,
    category,
    promoCodeType,
    type,
    hasPrizeLimit,
    promoCodesFileName,
    promoCodes,
    promoCodeValue,
    totalCount,
    remainingCount: hasPrizeLimit ? Math.max(0, totalCount - usedCount) : 0,
    chanceValue,
    hasUserLimit,
    userLimitCount,
    activeFrom,
    activeTo,
    rouletteImage,
    myPrizeText,
    rouletteDescription,
    updatedAt: new Date().toISOString(),
  };

  mockState.prizes[prizeIndex] = nextPrize;

  return {
    updated: true,
    prize: nextPrize,
  };
}

function deletePrize(payload = {}) {
  const id = Number(payload?.id);

  if (!id) {
    throw new Error("Prize id is required");
  }

  const prizeIndex = mockState.prizes.findIndex((item) => item.id === id);

  if (prizeIndex === -1) {
    throw new Error("Prize not found");
  }

  const [deletedPrize] = mockState.prizes.splice(prizeIndex, 1);

  return {
    deleted: true,
    id,
    title: deletedPrize?.title || "",
  };
}

function deleteManyPrizes(payload = {}) {
  const ids = Array.isArray(payload?.ids)
    ? Array.from(new Set(payload.ids.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0)))
    : [];

  if (!ids.length) {
    throw new Error("Prize ids are required");
  }

  const deletedTitles = [];

  mockState.prizes = mockState.prizes.filter((item) => {
    if (!ids.includes(item.id)) {
      return true;
    }

    deletedTitles.push(item.title);
    return false;
  });

  return {
    deleted: true,
    deletedCount: deletedTitles.length,
    ids,
    titles: deletedTitles,
  };
}

function createPromoCode(body = {}) {
  const code = String(body?.code || "").trim();

  if (!code) {
    throw new Error("code is required");
  }

  const existingPromoCode = mockState.promoCodes.find((item) => item.code === code);

  if (existingPromoCode) {
    return {
      created: false,
      promoCode: existingPromoCode,
    };
  }

  const nextPromoCode = createMockPromoCode({
    id: Math.max(0, ...mockState.promoCodes.map((item) => item.id)) + 1,
    code,
    hoursCreatedAgo: 0,
  });

  mockState.promoCodes.unshift(nextPromoCode);

  return {
    created: true,
    promoCode: nextPromoCode,
  };
}

function deleteAllPromoCodes() {
  const deletedCount = mockState.promoCodes.length;
  mockState.promoCodes = [];

  return {
    deletedCount,
  };
}

function createMockCodeId() {
  return String(Math.floor(10_000_000 + Math.random() * 90_000_000));
}

function decoratePush(push) {
  const deliveredCount = Number(push.deliveredCount || 0);
  const openedCount = Number(push.openedCount || 0);
  const clickedCount = Number(push.clickedCount || 0);

  return {
    ...push,
    canSendLive: push.status === "template" && Boolean(push.testSentAt),
    openRate: deliveredCount > 0 ? (openedCount / deliveredCount) * 100 : 0,
    ctr: openedCount > 0 ? (clickedCount / openedCount) * 100 : 0,
  };
}

function buildRafflePlayersResponse(body = {}) {
  const search = normalizeSearch(body?.search);
  const outcome = ["all", "won", "lost", "pending"].includes(body?.outcome) ? body.outcome : "all";
  let items = mockState.players
    .filter((player) => player.gameCompletionState === "completed")
    .map((player) => ({
      ...player,
      displayName: buildDisplayName(player),
    }));

  if (search) {
    items = items.filter((player) => {
      const haystack = [
        player.telegramUserId,
        player.username,
      ].join(" ").toLowerCase();

      return haystack.includes(search);
    });
  }

  if (outcome === "won") {
    items = items.filter((player) => player.raffleWon === true);
  }

  if (outcome === "lost") {
    items = items.filter((player) => player.raffleWon === false);
  }

  if (outcome === "pending") {
    items = items.filter((player) => player.raffleWon == null);
  }

  items.sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));

  return {
    items,
    summary: {
      totalParticipantsCount: items.length,
      winnersCount: items.filter((player) => player.raffleWon === true).length,
      losersCount: items.filter((player) => player.raffleWon === false).length,
      pendingCount: items.filter((player) => player.raffleWon == null).length,
    },
  };
}

function markRaffleWinner(body = {}) {
  const playerId = Number(body?.playerId);
  const player = mockState.players.find((item) => item.id === playerId && item.gameCompletionState === "completed");

  if (!player) {
    throw new Error("Raffle player not found");
  }

  player.raffleWon = true;
  player.codeId = player.codeId || createMockCodeId();
  player.updatedAt = new Date().toISOString();

  return {
    player: {
      ...player,
      displayName: buildDisplayName(player),
    },
  };
}

function finishRaffle() {
  let updatedCount = 0;

  for (const player of mockState.players) {
    if (player.gameCompletionState === "completed" && player.raffleWon == null) {
      player.raffleWon = false;
      player.updatedAt = new Date().toISOString();
      updatedCount += 1;
    }
  }

  return {
    updatedCount,
  };
}

function buildLogsListResponse(payload = {}) {
  const search = normalizeSearch(payload?.search);
  const action = payload?.action && payload.action !== "all" ? String(payload.action) : "all";
  const actions = [...new Set(mockState.logs.map((log) => log.action))].sort((left, right) => left.localeCompare(right));
  let items = mockState.logs.map((log) => {
    const player = mockState.players.find((item) => item.id === log.playerId);

    return {
      ...log,
      player: player ? buildPlayerView(player) : null,
    };
  });

  if (action !== "all") {
    items = items.filter((item) => item.action === action);
  }

  if (search) {
    items = items.filter((item) => {
      const haystack = [
        item.action,
        item.source,
        item.gameSessionId,
        item.player?.displayName,
        item.player?.username,
        item.player?.telegramUserId,
        JSON.stringify(item.details || {}),
      ].join(" ").toLowerCase();

      return haystack.includes(search);
    });
  }

  items.sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));

  return {
    items,
    actions,
    summary: {
      totalLogsCount: items.length,
      uniquePlayersCount: new Set(items.map((item) => item.playerId)).size,
      finishActionsCount: items.filter((item) => item.action === "finish").length,
      prizeActionsCount: items.filter((item) => item.action === "promo-issued").length,
    },
  };
}

function buildPushesResponse(payload = {}) {
  const search = normalizeSearch(payload?.search);
  const status = ["all", "template", "scheduled", "sent"].includes(payload?.status) ? payload.status : "all";
  let items = mockState.pushes.map(decoratePush);

  if (status !== "all") {
    items = items.filter((item) => item.status === status);
  }

  if (search) {
    items = items.filter((item) => {
      const haystack = [
        item.title,
        item.message,
        item.audienceLabel,
        ...(Array.isArray(item.selectedUsers) ? item.selectedUsers.map((user) => [user.displayName, user.username, user.telegramUserId].join(" ")) : []),
      ].join(" ").toLowerCase();

      return haystack.includes(search);
    });
  }

  items.sort((left, right) => {
    const leftTimestamp = new Date(left.sentAt || left.scheduledAt || left.createdAt).getTime();
    const rightTimestamp = new Date(right.sentAt || right.scheduledAt || right.createdAt).getTime();

    return rightTimestamp - leftTimestamp;
  });

  return {
    items,
    summary: {
      totalCampaignsCount: items.length,
      sentCampaignsCount: items.filter((item) => item.status === "sent" || item.sentAt).length,
      totalRecipientsCount: items.reduce((sum, item) => sum + Number(item.recipientsCount || 0), 0),
      deliveredRecipientsCount: items.reduce((sum, item) => sum + Number(item.deliveredCount || 0), 0),
    },
  };
}

function resolvePushRecipientsCount(payload = {}) {
  if (payload?.audienceKey === "selected_users") {
    return Array.isArray(payload?.selectedUsers) ? payload.selectedUsers.length : 0;
  }

  return 14820;
}

function createPush(payload = {}) {
  const title = String(payload?.title || "").trim();
  const message = String(payload?.message || "").trim();
  const html = String(payload?.html || "").trim();
  const audienceKey = String(payload?.audienceKey || "all_users").trim() || "all_users";
  const audienceLabel = String(payload?.audienceLabel || "Все пользователи").trim() || "Все пользователи";
  const imageUrl = payload?.image?.previewUrl
    ? String(payload.image.previewUrl)
    : payload?.imageUrl
      ? String(payload.imageUrl)
      : null;
  const disableLinkPreview = Boolean(payload?.disableLinkPreview);
  const selectedUsers = Array.isArray(payload?.selectedUsers)
    ? payload.selectedUsers
      .map((user) => ({
        id: Number(user?.id) || 0,
        displayName: String(user?.displayName || "").trim(),
        username: String(user?.username || "").trim(),
        telegramUserId: Number(user?.telegramUserId) || 0,
      }))
      .filter((user) => user.id > 0)
    : [];

  if (!title) {
    throw new Error("Push title is required");
  }

  if (!message) {
    throw new Error("Push message is required");
  }

  if (audienceKey === "selected_users" && selectedUsers.length === 0) {
    throw new Error("Select at least one user");
  }

  const nextPush = createMockPush({
    id: Math.max(0, ...mockState.pushes.map((item) => item.id)) + 1,
    title,
    message,
    html,
    audienceKey,
    audienceLabel,
    selectedUsers,
    imageUrl,
    disableLinkPreview,
    status: "template",
    recipientsCount: resolvePushRecipientsCount({ audienceKey, selectedUsers }),
    hoursCreatedAgo: 0,
  });

  mockState.pushes.unshift(nextPush);

  return {
    push: decoratePush(nextPush),
  };
}

function sendPush(payload = {}) {
  const pushId = Number(payload?.pushId);
  const mode = String(payload?.mode || "live").trim().toLowerCase() === "test" ? "test" : "live";
  const push = mockState.pushes.find((item) => item.id === pushId);

  if (!push) {
    throw new Error("Push not found");
  }

  const nowIso = new Date().toISOString();

  if (mode === "test") {
    push.testSentAt = nowIso;
    push.updatedAt = nowIso;

    return {
      push: decoratePush(push),
      mode,
    };
  }

  if (push.status === "template" && !push.testSentAt) {
    throw new Error("Test send is required before live send");
  }

  const deliveredCount = Math.max(0, Math.round(Number(push.recipientsCount || 0) * 0.94));
  const openedCount = Math.round(deliveredCount * 0.37);
  const clickedCount = Math.round(openedCount * 0.18);

  if (push.status !== "template") {
    push.status = "sent";
  }

  push.scheduledAt = push.scheduledAt || nowIso;
  push.sentAt = nowIso;
  push.deliveredCount = deliveredCount;
  push.openedCount = openedCount;
  push.clickedCount = clickedCount;
  push.updatedAt = nowIso;

  return {
    push: decoratePush(push),
    mode,
  };
}

function buildSeries(items, dateKey, range, rangeStart = null, rangeEnd = null) {
  const bucketMap = new Map();

  for (const item of items) {
    const key = bucketKey(item[dateKey], range);
    bucketMap.set(key, (bucketMap.get(key) || 0) + 1);
  }

  return getBucketDates(range, rangeStart, rangeEnd).map((date) => ({
    key: bucketKey(date, range),
    label: bucketLabel(date, range),
    value: bucketMap.get(bucketKey(date, range)) || 0,
  }));
}

function buildAnalyticsOverview(payload = {}) {
  const requestedRange = ["today", "7d", "30d", "all"].includes(payload?.range) ? payload.range : "today";
  const customRangeStart = parseDateStart(payload?.dateFrom);
  const customRangeEnd = parseDateEnd(payload?.dateTo);
  const hasCustomRange = Boolean(customRangeStart || customRangeEnd);
  const range = hasCustomRange ? "custom" : requestedRange;
  const rangeStart = customRangeStart || getRangeStart(requestedRange);
  const rangeEnd = customRangeEnd;
  const chartRangeStart = range === "custom" && rangeStart
    ? new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate() - 1)
    : rangeStart;
  const chartRangeEnd = rangeEnd;
  const players = mockState.players.slice();
  const sessions = mockState.sessions.slice();
  const inRangePlayers = players.filter((player) => isInRange(player.createdAt, rangeStart, rangeEnd));
  const inRangeSessions = sessions.filter((session) => isInRange(session.startedAt, rangeStart, rangeEnd));
  const chartInRangePlayers = players.filter((player) => isInRange(player.createdAt, chartRangeStart, chartRangeEnd));
  const chartInRangeSessions = sessions.filter((session) => isInRange(session.startedAt, chartRangeStart, chartRangeEnd));
  const chartFinishedInRangeSessions = chartInRangeSessions.filter((session) => session.status === "finished");
  const finishedInRangeSessions = inRangeSessions.filter((session) => session.status === "finished");
  const inRangeSessionPlayers = new Set(inRangeSessions.map((session) => session.playerId));
  const sessionsByPlayer = new Map();
  const playersWithThreePairs = new Set(
    inRangeSessions
      .filter((session) => session.foundSneakersCount >= 3)
      .map((session) => session.playerId)
  );
  const playersWithTenPairs = new Set(
    inRangeSessions
      .filter((session) => session.foundSneakersCount >= 10)
      .map((session) => session.playerId)
  );
  const bestPairsByPlayer = new Map();

  for (const session of inRangeSessions) {
    sessionsByPlayer.set(session.playerId, (sessionsByPlayer.get(session.playerId) || 0) + 1);
    bestPairsByPlayer.set(
      session.playerId,
      Math.max(bestPairsByPlayer.get(session.playerId) || 0, session.foundSneakersCount)
    );
  }

  const referralCountByCode = new Map();

  for (const player of inRangePlayers) {
    if (player.referredByCode) {
      referralCountByCode.set(
        player.referredByCode,
        (referralCountByCode.get(player.referredByCode) || 0) + 1,
      );
    }
  }

  const referralCounts = [...referralCountByCode.values()];
  const uniquePlayersByDay = new Map();

  for (const session of inRangeSessions) {
    const sessionDate = new Date(session.startedAt);
    const dailyKey = `${sessionDate.getFullYear()}-${sessionDate.getMonth()}-${sessionDate.getDate()}`;

    if (!uniquePlayersByDay.has(dailyKey)) {
      uniquePlayersByDay.set(dailyKey, new Set());
    }

    uniquePlayersByDay.get(dailyKey).add(session.playerId);
  }

  const dailyVisitCounts = [...uniquePlayersByDay.values()].map((playerIds) => playerIds.size);
  const totalUniqueDailyVisitsCount = dailyVisitCounts.reduce((sum, count) => sum + count, 0);
  const averageDauCount = dailyVisitCounts.length > 0
    ? Math.round(totalUniqueDailyVisitsCount / dailyVisitCounts.length)
    : 0;

  const totalPlayersSeries = buildSeries(chartInRangePlayers, "createdAt", range, chartRangeStart, chartRangeEnd);
  let runningPlayers = players.filter((player) => chartRangeStart && new Date(player.createdAt) < chartRangeStart).length;

  const totalPlayers = totalPlayersSeries.map((point) => {
    runningPlayers += point.value;
    return {
      ...point,
      value: runningPlayers,
    };
  });

  return {
    meta: {
      range: requestedRange,
      cachedAt: new Date().toISOString(),
      dateFrom: payload?.dateFrom || "",
      dateTo: payload?.dateTo || "",
    },
    summary: {
      totalPlayersCount: players.length,
      newPlayersCount: inRangePlayers.length,
      appOpenedCount: inRangePlayers.length,
      subscribedPlayersCount: inRangePlayers.filter((player) => player.subscribedToChannel).length,
      totalUniqueDailyVisitsCount,
      averageDauCount,
      sessionsStartedCount: inRangeSessions.length,
      finishedSessionsCount: finishedInRangeSessions.length,
      playersWithFinishedGameCount: new Set(finishedInRangeSessions.map((session) => session.playerId)).size,
      currentlyOnlinePlayersCount: players.filter((player) => Date.now() - new Date(player.lastSeenAt).getTime() <= 15 * 60 * 1000).length,
      averageCompletionSeconds: finishedInRangeSessions.length > 0
        ? Math.round(finishedInRangeSessions.reduce((sum, session) => sum + getCompletedInSeconds(session), 0) / finishedInRangeSessions.length)
        : 0,
      averageFoundSneakersCount: inRangeSessions.length > 0
        ? Math.round(inRangeSessions.reduce((sum, session) => sum + session.foundSneakersCount, 0) / inRangeSessions.length)
        : 0,
      referralsInPeriodCount: inRangePlayers.filter((player) => player.referredByCode).length,
      totalReferredPlayersCount: players.filter((player) => player.referredByCode).length,
      passedSubscriptionStageCount: inRangeSessionPlayers.size,
      notSubscribedBeforeCount: inRangePlayers.filter((player) => !player.subscribedToChannel).length,
      subscribedAfterNotSubscribedCount: inRangePlayers.filter((player) => player.subscribedToChannel && player.referredByCode).length,
      enteredGameCount: inRangeSessionPlayers.size,
      foundThreePairsCount: playersWithThreePairs.size,
      foundAllPairsPlayersCount: playersWithTenPairs.size,
      averagePairsPerUserCount: bestPairsByPlayer.size > 0
        ? Math.round(
          [...bestPairsByPlayer.values()].reduce((sum, value) => sum + value, 0) / bestPairsByPlayer.size
        )
        : 0,
      foundTenPairsCount: inRangeSessions.filter((session) => session.foundSneakersCount >= 10).length,
      foundTenPairsInTimeCount: finishedInRangeSessions.filter((session) => session.foundSneakersCount >= 10).length,
      attemptedOneTimePlayersCount: [...sessionsByPlayer.values()].filter((count) => count >= 1).length,
      attemptedThreeTimesPlayersCount: [...sessionsByPlayer.values()].filter((count) => count >= 3).length,
      attemptedFiveTimesPlayersCount: [...sessionsByPlayer.values()].filter((count) => count >= 5).length,
      attemptedTenTimesPlayersCount: [...sessionsByPlayer.values()].filter((count) => count >= 10).length,
      referredOneFriendPlayersCount: referralCounts.filter((count) => count >= 1).length,
      referredThreeFriendsPlayersCount: referralCounts.filter((count) => count >= 3).length,
      referredFiveFriendsPlayersCount: referralCounts.filter((count) => count >= 5).length,
      referredTenFriendsPlayersCount: referralCounts.filter((count) => count >= 10).length,
      ozonTravelTransitionsCount: 0,
    },
    series: {
      newPlayers: totalPlayersSeries,
      totalPlayers,
      sessionsStarted: buildSeries(chartInRangeSessions, "startedAt", range, chartRangeStart, chartRangeEnd),
      sessionsFinished: buildSeries(chartFinishedInRangeSessions, "finishedAt", range, chartRangeStart, chartRangeEnd),
    },
    recentSessions: inRangeSessions
      .slice()
      .sort((left, right) => new Date(right.startedAt) - new Date(left.startedAt))
      .slice(0, 20)
      .map((session) => ({
        ...session,
        player: buildPlayerView(players.find((player) => player.id === session.playerId)),
      })),
  };
}

function normalizeSearch(value) {
  return String(value || "").trim().toLowerCase();
}

function compareValues(left, right, direction) {
  if (left === right) {
    return 0;
  }

  if (left == null) {
    return direction === "asc" ? -1 : 1;
  }

  if (right == null) {
    return direction === "asc" ? 1 : -1;
  }

  if (left > right) {
    return direction === "asc" ? 1 : -1;
  }

  return direction === "asc" ? -1 : 1;
}

function buildPlayersResponse(payload = {}) {
  const page = Math.max(1, Number(payload?.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(payload?.pageSize) || 25));
  const sortKey = payload?.sortKey || "createdAt";
  const sortDirection = String(payload?.sortDirection || "desc").toLowerCase() === "asc" ? "asc" : "desc";
  const search = normalizeSearch(payload?.search);

  let items = mockState.players.map(buildPlayerView);

  if (search) {
    items = items.filter((player) => {
      const haystack = [
        player.id,
        player.telegramUserId,
        player.username,
        player.firstName,
        player.lastName,
        player.referralCode,
        player.referredByCode,
        player.displayName,
      ].join(" ").toLowerCase();

      return haystack.includes(search);
    });
  }

  items.sort((left, right) => {
    if (sortKey === "lastSeenAt") {
      return compareValues(new Date(left.lastSeenAt).getTime(), new Date(right.lastSeenAt).getTime(), sortDirection);
    }

    if (sortKey === "displayName") {
      return compareValues(left.displayName, right.displayName, sortDirection);
    }

    if (sortKey === "bestDurationSeconds") {
      return compareValues(left.bestDurationSeconds, right.bestDurationSeconds, sortDirection);
    }

    if (sortKey === "totalSessions") {
      return compareValues(left.totalSessions, right.totalSessions, sortDirection);
    }

    return compareValues(new Date(left.createdAt).getTime(), new Date(right.createdAt).getTime(), sortDirection);
  });

  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const offset = (page - 1) * pageSize;

  return {
    items: items.slice(offset, offset + pageSize),
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages,
    },
  };
}

function buildPlayerDetails(payload = {}) {
  const playerId = Number(payload?.playerId);
  const player = mockState.players.find((item) => item.id === playerId);

  if (!player) {
    throw new Error("Player not found");
  }

  return {
    player: buildPlayerView(player),
    stats: getPlayerStats(playerId),
    recentSessions: mockState.sessions
      .filter((session) => session.playerId === playerId)
      .slice()
      .sort((left, right) => new Date(right.startedAt) - new Date(left.startedAt)),
  };
}

function buildPlayerLogs(payload = {}) {
  const playerId = Number(payload?.playerId);
  const limit = Math.min(200, Math.max(1, Number(payload?.limit) || 50));

  return {
    logs: mockState.logs
      .filter((log) => log.playerId === playerId)
      .slice()
      .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
      .slice(0, limit),
  };
}

function deletePlayer(payload = {}) {
  const playerId = Number(payload?.playerId);
  const playerIndex = mockState.players.findIndex((item) => item.id === playerId);

  if (playerIndex === -1) {
    throw new Error("Player not found");
  }

  mockState.players.splice(playerIndex, 1);
  mockState.sessions = mockState.sessions.filter((session) => session.playerId !== playerId);
  mockState.logs = mockState.logs.filter((log) => log.playerId !== playerId);

  return {
    deleted: true,
    playerId,
  };
}

export function resolveMockAdminResponse(path, body = {}) {
  if (path === "/api/auth/me") {
    return {
      admin: {
        id: "local-mock-admin",
        username: "mock_admin",
      },
    };
  }

  if (path === "/api/analytics/overview") {
    return buildAnalyticsOverview(body);
  }

  if (path === "/api/analytics/players") {
    return buildPlayersResponse(body);
  }

  if (path === "/api/analytics/player") {
    return buildPlayerDetails(body);
  }

  if (path === "/api/analytics/utm") {
    return buildUtmResponse(body);
  }

  if (path === "/api/promo-codes/list") {
    return buildPromoCodesResponse(body);
  }

  if (path === "/api/promo-codes/create") {
    return createPromoCode(body);
  }

  if (path === "/api/promo-codes/delete-all") {
    return deleteAllPromoCodes();
  }

  if (path === "/api/prizes/list") {
    return buildPrizesResponse(body);
  }

  if (path === "/api/prizes/create") {
    return createPrize(body);
  }

  if (path === "/api/prizes/update") {
    return updatePrize(body);
  }

  if (path === "/api/prizes/delete") {
    return deletePrize(body);
  }

  if (path === "/api/prizes/delete-many") {
    return deleteManyPrizes(body);
  }

  if (path === "/api/chances/list") {
    return buildChancesResponse(body);
  }

  if (path === "/api/chances/update") {
    return updateChanceValue(body);
  }

  if (path === "/api/raffle/players") {
    return buildRafflePlayersResponse(body);
  }

  if (path === "/api/raffle/winner") {
    return markRaffleWinner(body);
  }

  if (path === "/api/raffle/finish") {
    return finishRaffle();
  }

  if (path === "/api/logs/list") {
    return buildLogsListResponse(body);
  }

  if (path === "/api/logs/user") {
    return buildPlayerLogs(body);
  }

  if (path === "/api/pushes/list") {
    return buildPushesResponse(body);
  }

  if (path === "/api/pushes/create") {
    return createPush(body);
  }

  if (path === "/api/pushes/send") {
    return sendPush(body);
  }

  if (path === "/api/users/delete") {
    return deletePlayer(body);
  }

  throw new Error(`Mock handler not found for ${path}`);
}
