import {
  Badge,
  Box,
  Button,
  Flex,
  HStack,
  Input,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  useColorModeValue,
} from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";
import Card from "components/card/Card";
import BarChart from "components/charts/BarChart";
import LineChart from "components/charts/LineChart";
import { postJson } from "api";

const RANGE_OPTIONS = [
  { value: "today", label: "Сегодня" },
  { value: "7d", label: "7 дней" },
  { value: "30d", label: "30 дней" },
  { value: "all", label: "Все время" },
];

function formatDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getPresetDateRange(rangeValue) {
  const today = new Date();
  const endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  if (rangeValue === "all") {
    return {
      dateFrom: "",
      dateTo: "",
    };
  }

  const startDate = new Date(endDate);

  if (rangeValue === "7d") {
    startDate.setDate(startDate.getDate() - 6);
  } else if (rangeValue === "30d") {
    startDate.setDate(startDate.getDate() - 29);
  }

  return {
    dateFrom: formatDateInputValue(startDate),
    dateTo: formatDateInputValue(endDate),
  };
}

const EMPTY_ANALYTICS = {
  meta: {
    range: "today",
    cachedAt: "",
    dateFrom: "",
    dateTo: "",
  },
  series: {
    newPlayers: [],
    totalPlayers: [],
    sessionsStarted: [],
    sessionsFinished: [],
  },
  summary: {
    totalPlayersCount: 0,
    newPlayersCount: 0,
    appOpenedCount: 0,
    subscribedPlayersCount: 0,
    totalUniqueDailyVisitsCount: 0,
    averageDauCount: 0,
    sessionsStartedCount: 0,
    finishedSessionsCount: 0,
    playersWithFinishedGameCount: 0,
    currentlyOnlinePlayersCount: 0,
    averageCompletionSeconds: 0,
    averageFoundSneakersCount: 0,
    referralsInPeriodCount: 0,
    totalReferredPlayersCount: 0,
    passedSubscriptionStageCount: 0,
    notSubscribedBeforeCount: 0,
    subscribedAfterNotSubscribedCount: 0,
    enteredGameCount: 0,
    foundThreePairsCount: 0,
    foundAllPairsPlayersCount: 0,
    averagePairsPerUserCount: 0,
    foundTenPairsCount: 0,
    foundTenPairsInTimeCount: 0,
    attemptedOneTimePlayersCount: 0,
    attemptedThreeTimesPlayersCount: 0,
    attemptedFiveTimesPlayersCount: 0,
    attemptedTenTimesPlayersCount: 0,
    referredOneFriendPlayersCount: 0,
    referredThreeFriendsPlayersCount: 0,
    referredFiveFriendsPlayersCount: 0,
    referredTenFriendsPlayersCount: 0,
    promoCodeApplyClicksCount: 0,
    promoCodeApplyUsersCount: 0,
    ozonTravelTransitionsCount: 0,
  },
};

function formatNumber(value) {
  return new Intl.NumberFormat("ru-RU").format(Number(value) || 0);
}

function formatDateTime(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleString("ru-RU");
}

function buildLineChartOptions(categories, color, gridColor, labelColor) {
  return {
    chart: {
      toolbar: {
        show: false,
      },
      zoom: {
        enabled: false,
      },
      foreColor: labelColor,
    },
    colors: [color],
    stroke: {
      curve: "smooth",
      width: 4,
      colors: [color],
    },
    dataLabels: {
      enabled: false,
    },
    markers: {
      size: 0,
      hover: {
        size: 5,
      },
    },
    xaxis: {
      categories,
      axisBorder: {
        show: false,
      },
      axisTicks: {
        show: false,
      },
      labels: {
        style: {
          colors: categories.map(() => labelColor),
          fontSize: "12px",
          fontWeight: 500,
        },
      },
    },
    yaxis: {
      labels: {
        style: {
          colors: Array.from({ length: 8 }, () => labelColor),
          fontSize: "12px",
          fontWeight: 500,
        },
      },
    },
    grid: {
      borderColor: gridColor,
      strokeDashArray: 5,
      yaxis: {
        lines: {
          show: true,
        },
      },
      xaxis: {
        lines: {
          show: false,
        },
      },
    },
    tooltip: {
      theme: "dark",
    },
    fill: {
      type: "solid",
      opacity: 0,
    },
    legend: {
      show: false,
    },
    responsive: [
      {
        breakpoint: 480,
        options: {
          xaxis: {
            labels: {
              style: {
                fontSize: "9px",
              },
            },
          },
          yaxis: {
            labels: {
              style: {
                fontSize: "10px",
              },
            },
          },
        },
      },
    ],
  };
}

function buildBarChartOptions(categories, colors, gridColor, labelColor) {
  return {
    chart: {
      stacked: false,
      toolbar: {
        show: false,
      },
      foreColor: labelColor,
    },
    colors,
    dataLabels: {
      enabled: false,
    },
    plotOptions: {
      bar: {
        borderRadius: 10,
        columnWidth: "44%",
      },
    },
    xaxis: {
      categories,
      axisBorder: {
        show: false,
      },
      axisTicks: {
        show: false,
      },
      labels: {
        style: {
          colors: categories.map(() => labelColor),
          fontSize: "12px",
          fontWeight: 500,
        },
      },
    },
    yaxis: {
      labels: {
        style: {
          colors: Array.from({ length: 8 }, () => labelColor),
          fontSize: "12px",
          fontWeight: 500,
        },
      },
    },
    grid: {
      borderColor: gridColor,
      strokeDashArray: 5,
      yaxis: {
        lines: {
          show: true,
        },
      },
      xaxis: {
        lines: {
          show: false,
        },
      },
    },
    tooltip: {
      theme: "dark",
    },
    legend: {
      show: false,
    },
    responsive: [
      {
        breakpoint: 480,
        options: {
          xaxis: {
            labels: {
              style: {
                fontSize: "9px",
              },
            },
          },
          yaxis: {
            labels: {
              style: {
                fontSize: "10px",
              },
            },
          },
        },
      },
    ],
  };
}

function AnalyticsFunnelCard({ title, rows }) {
  const titleColor = useColorModeValue("navy.700", "white");
  const labelColor = useColorModeValue("secondaryGray.700", "secondaryGray.300");
  const valueColor = useColorModeValue("brand.500", "white");
  const itemBorder = useColorModeValue("rgba(224, 229, 242, 0.95)", "rgba(255, 255, 255, 0.08)");
  const cardBg = useColorModeValue("white", "navy.800");
  const cardShadow = useColorModeValue(
    "0px 18px 40px rgba(112, 144, 176, 0.12)",
    "unset",
  );

  return (
    <Card
      p={{ base: "22px", md: "28px" }}
      bg={cardBg}
      boxShadow={cardShadow}
    >
      <Box mb="22px">
        <Text color={titleColor} fontSize={{ base: "lg", md: "xl" }} fontWeight="700">
          {title}
        </Text>
      </Box>

      <Stack spacing="0">
        {rows.map((row, index) => (
          <Flex
            key={row.key}
            align="center"
            borderTop={index === 0 ? "none" : "1px solid"}
            borderColor={itemBorder}
            gap="18px"
            justify="space-between"
            minH="60px"
            py={index === 0 ? "0px" : "10px"}
          >
            <Box flex="1">
              <Text color={labelColor} fontSize="sm" fontWeight="500">
                {row.label}
              </Text>
            </Box>
            <Text color={valueColor} fontSize={{ base: "lg", md: "xl" }} fontWeight="700" textAlign="right">
              {row.value}
            </Text>
          </Flex>
        ))}
      </Stack>
    </Card>
  );
}

function AnalyticsHighlightCard({ label, value }) {
  const cardBg = useColorModeValue("white", "navy.800");
  const labelColor = useColorModeValue("secondaryGray.700", "secondaryGray.300");
  const valueColor = useColorModeValue("brand.500", "white");
  const shadowColor = useColorModeValue(
    "0px 18px 40px rgba(112, 144, 176, 0.12)",
    "unset",
  );

  return (
    <Card
      bg={cardBg}
      boxShadow={shadowColor}
      p={{ base: "22px", md: "28px" }}
    >
      <Flex
        align="center"
        justify="space-between"
        direction={{ base: "column", md: "row" }}
        gap="16px"
      >
        <Text
          color={labelColor}
          fontSize={{ base: "md", md: "lg" }}
          fontWeight="500"
          textAlign={{ base: "center", md: "left" }}
        >
          {label}
        </Text>
        <Text
          color={valueColor}
          fontSize={{ base: "2xl", md: "3xl" }}
          fontWeight="700"
          lineHeight="1"
        >
          {value}
        </Text>
      </Flex>
    </Card>
  );
}

function AnalyticsChartCard({
  title,
  subtitle,
  value,
  chartType,
  points,
  primaryColor,
  secondaryColor,
}) {
  const titleColor = useColorModeValue("navy.700", "white");
  const labelColor = useColorModeValue("secondaryGray.600", "rgba(255, 255, 255, 0.86)");
  const gridColor = useColorModeValue("rgba(224, 229, 242, 0.9)", "rgba(255, 255, 255, 0.16)");
  const lineColor = useColorModeValue("rgba(15, 23, 42, 0.92)", "rgba(255, 255, 255, 0.96)");
  const barColors = useColorModeValue(
    [primaryColor, secondaryColor].filter(Boolean),
    ["rgba(255, 255, 255, 0.96)"],
  );
  const valueBadgeBg = useColorModeValue("secondaryGray.300", "rgba(255, 255, 255, 0.94)");
  const valueBadgeColor = useColorModeValue("navy.700", "navy.700");
  const categories = points.map((point) => point.label);

  const chartData = useMemo(() => [
    {
      name: title,
      data: points.map((point) => Number(point.value || 0)),
    },
  ], [points, title]);

  const chartOptions = useMemo(() => {
    if (chartType === "bar") {
      return buildBarChartOptions(categories, barColors, gridColor, labelColor);
    }

    return buildLineChartOptions(categories, lineColor, gridColor, labelColor);
  }, [barColors, categories, chartType, gridColor, labelColor, lineColor]);

  return (
    <Card p={{ base: "18px", md: "24px" }}>
      <Flex align="start" direction={{ base: "column", sm: "row" }} gap="16px" justify="space-between" mb="18px">
        <Box>
          <Text color={titleColor} fontSize={{ base: "lg", md: "xl" }} fontWeight="700">
            {title}
          </Text>
          <Text color={labelColor} fontSize="sm" mt="4px">
            {subtitle}
          </Text>
        </Box>
        <Badge
          bg={valueBadgeBg}
          borderRadius="999px"
          color={valueBadgeColor}
          fontSize="sm"
          px="12px"
          py="8px"
        >
          {value}
        </Badge>
      </Flex>

      <Box h={{ base: "220px", md: "260px" }}>
        {chartType === "bar" ? (
          <BarChart chartData={chartData} chartOptions={chartOptions} />
        ) : (
          <LineChart chartData={chartData} chartOptions={chartOptions} />
        )}
      </Box>
    </Card>
  );
}

export default function AnalyticsPage() {
  const [selectedRange, setSelectedRange] = useState("today");
  const [selectedDateRange, setSelectedDateRange] = useState(() => getPresetDateRange("today"));
  const [analytics, setAnalytics] = useState(EMPTY_ANALYTICS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const toolbarControlBg = useColorModeValue("white", "rgba(255, 255, 255, 0.94)");
  const toolbarControlText = useColorModeValue("navy.700", "navy.700");
  const toolbarControlHoverBg = useColorModeValue("secondaryGray.300", "rgba(255, 255, 255, 0.88)");
  const toolbarControlShadow = useColorModeValue(
    "0px 16px 36px rgba(112, 144, 176, 0.12)",
    "0px 16px 36px rgba(17, 28, 68, 0.32)",
  );
  const brandColor = useColorModeValue("brand.500", "white");
  const chartOrange = useColorModeValue("orange.500", "orange.500");
  const chartGreen = useColorModeValue("green.500", "green.500");
  const chartBlue = useColorModeValue("blue.500", "blue.500");

  useEffect(() => {
    let cancelled = false;

    async function loadAnalytics() {
      setLoading(true);
      setError("");

      try {
        const response = await postJson("/api/analytics/overview", {
          range: selectedRange,
          dateFrom: selectedDateRange.dateFrom || null,
          dateTo: selectedDateRange.dateTo || null,
        });

        if (cancelled) {
          return;
        }

        setAnalytics({
          meta: response?.meta || EMPTY_ANALYTICS.meta,
          series: {
            ...EMPTY_ANALYTICS.series,
            ...(response?.series || {}),
          },
          summary: {
            ...EMPTY_ANALYTICS.summary,
            ...(response?.summary || {}),
          },
        });
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError.message || "Не удалось загрузить аналитику");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadAnalytics();

    return () => {
      cancelled = true;
    };
  }, [selectedDateRange.dateFrom, selectedDateRange.dateTo, selectedRange]);

  async function handleRefresh() {
    setRefreshing(true);
    setError("");

    try {
      const response = await postJson("/api/analytics/overview", {
        range: selectedRange,
        dateFrom: selectedDateRange.dateFrom || null,
        dateTo: selectedDateRange.dateTo || null,
        refresh: true,
      });

      setAnalytics({
        meta: response?.meta || EMPTY_ANALYTICS.meta,
        series: {
          ...EMPTY_ANALYTICS.series,
          ...(response?.series || {}),
        },
        summary: {
          ...EMPTY_ANALYTICS.summary,
          ...(response?.summary || {}),
        },
      });
    } catch (requestError) {
      setError(requestError.message || "Не удалось обновить аналитику");
    } finally {
      setRefreshing(false);
    }
  }

  const summary = analytics.summary;

  const usersFunnelRows = useMemo(() => ([
    {
      key: "totalPlayersCount",
      label: "Всего пользователей",
      value: formatNumber(summary.totalPlayersCount),
    },
    {
      key: "subscribedPlayersCount",
      label: "Прошли подписку",
      value: formatNumber(summary.subscribedPlayersCount),
    },
    {
      key: "appOpenedCount",
      label: "Открыли мини апп",
      value: formatNumber(summary.appOpenedCount),
    },
  ]), [summary]);

  const attemptsFunnelRows = useMemo(() => ([
    {
      key: "attemptedOneTimePlayersCount",
      label: "Сделали 1 попытку",
      value: formatNumber(summary.attemptedOneTimePlayersCount),
    },
    {
      key: "attemptedThreeTimesPlayersCount",
      label: "Сделали 3 попытки",
      value: formatNumber(summary.attemptedThreeTimesPlayersCount),
    },
    {
      key: "attemptedFiveTimesPlayersCount",
      label: "Сделали 5 попыток",
      value: formatNumber(summary.attemptedFiveTimesPlayersCount),
    },
    {
      key: "attemptedTenTimesPlayersCount",
      label: "Сделали 10 попыток",
      value: formatNumber(summary.attemptedTenTimesPlayersCount),
    },
  ]), [summary]);

  const referralsFunnelRows = useMemo(() => ([
    {
      key: "referredOneFriendPlayersCount",
      label: "Пригласили 1 друга",
      value: formatNumber(summary.referredOneFriendPlayersCount),
    },
    {
      key: "referredThreeFriendsPlayersCount",
      label: "Пригласили 3 друзей",
      value: formatNumber(summary.referredThreeFriendsPlayersCount),
    },
    {
      key: "referredFiveFriendsPlayersCount",
      label: "Пригласили 5 друзей",
      value: formatNumber(summary.referredFiveFriendsPlayersCount),
    },
    {
      key: "referredTenFriendsPlayersCount",
      label: "Пригласили 10 друзей",
      value: formatNumber(summary.referredTenFriendsPlayersCount),
    },
  ]), [summary]);

  const highlightRows = useMemo(() => ([
    {
      key: "totalUniqueDailyVisitsCount",
      label: "Всего уникальных дневных заходов",
      value: formatNumber(summary.totalUniqueDailyVisitsCount),
    },
    {
      key: "averageDauCount",
      label: "Средний DAU",
      value: formatNumber(summary.averageDauCount),
    },
    {
      key: "promoCodeApplyClicksCount",
      label: "Нажатия на «Применить промокод»",
      value: formatNumber(summary.promoCodeApplyClicksCount),
    },
    {
      key: "promoCodeApplyUsersCount",
      label: "Уникальные пользователи по кнопке промокода",
      value: formatNumber(summary.promoCodeApplyUsersCount),
    },
  ]), [summary]);

  const updatedAtLabel = analytics.meta?.cachedAt
    ? formatDateTime(analytics.meta.cachedAt)
    : "—";

  function handlePresetRangeChange(nextRange) {
    setSelectedRange(nextRange);
    setSelectedDateRange(getPresetDateRange(nextRange));
  }

  function handleDateFieldChange(field, nextValue) {
    setSelectedDateRange((current) => ({
      ...current,
      [field]: nextValue,
    }));
  }

  return (
    <Box pt={{ base: "0px", md: "80px", xl: "80px" }}>
      <Flex align={{ base: "start", lg: "center" }} direction={{ base: "column", lg: "row" }} gap="16px" justify="space-between" mb="20px">
        <Box display={{ base: "block", md: "none" }} w="100%">
          <Select
            h="56px"
            bg={toolbarControlBg}
            borderColor="transparent"
            borderRadius="20px"
            boxShadow={toolbarControlShadow}
            color={toolbarControlText}
            fontSize="sm"
            fontWeight="700"
            value={selectedRange}
            onChange={(event) => setSelectedRange(event.target.value)}
            _focusVisible={{
              borderColor: "brand.200",
              boxShadow: `0 0 0 1px var(--chakra-colors-brand-200), ${toolbarControlShadow}`,
            }}
            _hover={{ borderColor: "transparent" }}
          >
            {RANGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Box>

        <HStack display={{ base: "none", md: "flex" }} flexWrap="wrap" spacing="12px" w={{ base: "100%", lg: "auto" }}>
          {RANGE_OPTIONS.map((option) => (
            <Button
              key={option.value}
              bg={selectedRange === option.value ? "brand.500" : toolbarControlBg}
              borderRadius="14px"
              boxShadow={selectedRange === option.value ? "0px 12px 24px rgba(66, 42, 251, 0.18)" : "none"}
              color={selectedRange === option.value ? "white" : toolbarControlText}
              flex={{ base: "1 1 calc(50% - 12px)", md: "0 0 auto" }}
              fontSize="sm"
              fontWeight="700"
              minW={{ base: "calc(50% - 12px)", md: "unset" }}
              px="18px"
              onClick={() => handlePresetRangeChange(option.value)}
              _hover={{
                bg: selectedRange === option.value ? "brand.600" : toolbarControlHoverBg,
              }}
            >
              {option.label}
            </Button>
          ))}
        </HStack>

        <Stack direction={{ base: "column", sm: "row" }} spacing="12px" w={{ base: "100%", lg: "auto" }}>
          <HStack spacing="10px" flexWrap="wrap" w={{ base: "100%", sm: "auto" }}>
            <Input
              type="date"
              h="42px"
              w={{ base: "100%", sm: "170px" }}
              bg={toolbarControlBg}
              borderColor="transparent"
              borderRadius="14px"
              boxShadow={toolbarControlShadow}
              color={toolbarControlText}
              fontSize="sm"
              fontWeight="600"
              value={selectedDateRange.dateFrom}
              onChange={(event) => handleDateFieldChange("dateFrom", event.target.value)}
              _focusVisible={{
                borderColor: "brand.200",
                boxShadow: `0 0 0 1px var(--chakra-colors-brand-200), ${toolbarControlShadow}`,
              }}
              _hover={{ borderColor: "transparent" }}
              sx={{
                colorScheme: "light",
                "::-webkit-calendar-picker-indicator": {
                  opacity: 0.9,
                  cursor: "pointer",
                  filter: "invert(18%) sepia(23%) saturate(1090%) hue-rotate(196deg) brightness(93%) contrast(92%)",
                },
              }}
            />
            <Input
              type="date"
              h="42px"
              w={{ base: "100%", sm: "170px" }}
              bg={toolbarControlBg}
              borderColor="transparent"
              borderRadius="14px"
              boxShadow={toolbarControlShadow}
              color={toolbarControlText}
              fontSize="sm"
              fontWeight="600"
              value={selectedDateRange.dateTo}
              onChange={(event) => handleDateFieldChange("dateTo", event.target.value)}
              _focusVisible={{
                borderColor: "brand.200",
                boxShadow: `0 0 0 1px var(--chakra-colors-brand-200), ${toolbarControlShadow}`,
              }}
              _hover={{ borderColor: "transparent" }}
              sx={{
                colorScheme: "light",
                "::-webkit-calendar-picker-indicator": {
                  opacity: 0.9,
                  cursor: "pointer",
                  filter: "invert(18%) sepia(23%) saturate(1090%) hue-rotate(196deg) brightness(93%) contrast(92%)",
                },
              }}
            />
          </HStack>
          <Badge
            bg={toolbarControlBg}
            borderRadius="999px"
            color={toolbarControlText}
            display="flex"
            flex="0 1 auto"
            justifyContent="center"
            alignItems="center"
            lineHeight="1.2"
            minH="42px"
            maxW={{ base: "100%", sm: "360px" }}
            px="12px"
            py="8px"
            textAlign="center"
            whiteSpace="nowrap"
          >
            Обновлено: {updatedAtLabel}
          </Badge>
          <Button
            bg={toolbarControlBg}
            borderRadius="14px"
            color={toolbarControlText}
            fontSize="sm"
            fontWeight="700"
            isLoading={refreshing}
            loadingText="Обновляем"
            w={{ base: "100%", sm: "auto" }}
            onClick={handleRefresh}
            _hover={{ bg: toolbarControlHoverBg }}
          >
            Обновить
          </Button>
        </Stack>
      </Flex>

      {error ? (
        <Card mb="20px" p="18px">
          <Text color="red.500" fontWeight="700">
            {error}
          </Text>
        </Card>
      ) : null}

      {loading ? (
        <Stack spacing="20px">
          <SimpleGrid columns={{ base: 1, xl: 2 }} gap="20px">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} h="360px" borderRadius="20px" />
            ))}
          </SimpleGrid>
          <SimpleGrid columns={{ base: 1, xl: 3 }} gap="20px">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} h="420px" borderRadius="20px" />
            ))}
          </SimpleGrid>
          <SimpleGrid columns={{ base: 1, xl: 2 }} gap="20px">
            {Array.from({ length: 2 }).map((_, index) => (
              <Skeleton key={index} h="96px" borderRadius="20px" />
            ))}
          </SimpleGrid>
        </Stack>
      ) : (
        <Stack spacing="20px">
          <SimpleGrid columns={{ base: 1, xl: 2 }} gap="20px">
            <AnalyticsChartCard
              title="Новые игроки"
              subtitle="Динамика регистраций за выбранный период"
              value={formatNumber(summary.newPlayersCount)}
              chartType="line"
              points={analytics.series.newPlayers}
              primaryColor={brandColor}
            />
            <AnalyticsChartCard
              title="Все игроки"
              subtitle="Накопительный рост базы игроков"
              value={formatNumber(summary.totalPlayersCount)}
              chartType="line"
              points={analytics.series.totalPlayers}
              primaryColor={chartBlue}
            />
            <AnalyticsChartCard
              title="Старты сессий"
              subtitle="Сколько раз запускали игру"
              value={formatNumber(summary.sessionsStartedCount)}
              chartType="bar"
              points={analytics.series.sessionsStarted}
              primaryColor={chartOrange}
              secondaryColor={brandColor}
            />
            <AnalyticsChartCard
              title="Финиши"
              subtitle="Успешные и завершенные игровые сессии"
              value={formatNumber(summary.finishedSessionsCount)}
              chartType="bar"
              points={analytics.series.sessionsFinished}
              primaryColor={chartGreen}
              secondaryColor={brandColor}
            />
          </SimpleGrid>

          <SimpleGrid columns={{ base: 1, xl: 2 }} gap="20px">
            {highlightRows.map((item) => (
              <AnalyticsHighlightCard
                key={item.key}
                label={item.label}
                value={item.value}
              />
            ))}
          </SimpleGrid>

          <SimpleGrid columns={{ base: 1, xl: 3 }} gap="20px">
            <AnalyticsFunnelCard
              title="Пользователи"
              rows={usersFunnelRows}
            />
            <AnalyticsFunnelCard
              title="Попытки"
              rows={attemptsFunnelRows}
            />
            <AnalyticsFunnelCard
              title="Рефералы"
              rows={referralsFunnelRows}
            />
          </SimpleGrid>
        </Stack>
      )}
    </Box>
  );
}
