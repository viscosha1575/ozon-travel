import {
  Badge,
  Box,
  Flex,
  Input,
  InputGroup,
  InputLeftElement,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  useColorModeValue,
} from "@chakra-ui/react";
import { SearchIcon } from "@chakra-ui/icons";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import Card from "components/card/Card";
import MiniStatistics from "components/card/MiniStatistics";
import { postJson } from "api";

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

export default function UtmPage() {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [response, setResponse] = useState({
    items: [],
    summary: {
      totalUtmsCount: 0,
      totalClicksCount: 0,
      totalNewUsersCount: 0,
    },
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const textColor = useColorModeValue("navy.700", "white");
  const textColorSecondary = useColorModeValue("secondaryGray.600", "secondaryGray.500");
  const borderColor = useColorModeValue("gray.200", "whiteAlpha.100");
  const filterBg = useColorModeValue("white", "navy.800");
  const filterShadow = useColorModeValue(
    "0px 16px 36px rgba(112, 144, 176, 0.12)",
    "0px 16px 36px rgba(17, 28, 68, 0.32)",
  );

  useEffect(() => {
    let cancelled = false;

    async function loadUtm() {
      setLoading(true);
      setError("");

      try {
        const nextResponse = await postJson("/api/analytics/utm", {
          search: deferredSearch,
        });

        if (!cancelled) {
          setResponse({
            items: Array.isArray(nextResponse?.items) ? nextResponse.items : [],
            summary: nextResponse?.summary ?? {
              totalUtmsCount: 0,
              totalClicksCount: 0,
              totalNewUsersCount: 0,
            },
          });
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError.message || "Не удалось загрузить UTM-аналитику");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadUtm();

    return () => {
      cancelled = true;
    };
  }, [deferredSearch]);

  const statCards = useMemo(() => ([
    {
      key: "totalUtmsCount",
      label: "UTM-меток",
      value: formatNumber(response.summary?.totalUtmsCount ?? 0),
    },
    {
      key: "totalNewUsersCount",
      label: "Новые юзеры",
      value: formatNumber(response.summary?.totalNewUsersCount ?? 0),
    },
    {
      key: "totalClicksCount",
      label: "Всего кликов",
      value: formatNumber(response.summary?.totalClicksCount ?? 0),
    },
  ]), [response.summary]);

  return (
    <Box pt={{ base: "0px", md: "80px", xl: "80px" }}>
      <Stack spacing="20px">
        <Card p="24px">
          <Flex
            w="100%"
            align={{ base: "stretch", lg: "center" }}
            justify="center"
            direction={{ base: "column", lg: "row" }}
            gap="12px"
          >
            <InputGroup flex="1" minW="0">
              <InputLeftElement pointerEvents="none" h="56px" ps="8px">
                <SearchIcon color="secondaryGray.500" />
              </InputLeftElement>
              <Input
                h="56px"
                minW="0"
                bg={filterBg}
                borderColor="transparent"
                borderRadius="20px"
                boxShadow={filterShadow}
                fontSize="sm"
                fontWeight="500"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Поиск по utm"
                ps="44px"
                value={search}
                _hover={{ borderColor: "transparent" }}
                _focusVisible={{
                  borderColor: "brand.200",
                  boxShadow: `0 0 0 1px var(--chakra-colors-brand-200), ${filterShadow}`,
                }}
              />
            </InputGroup>
          </Flex>
        </Card>

        <SimpleGrid columns={{ base: 1, md: 3 }} gap="20px">
          {statCards.map((card) => (
            <MiniStatistics
              key={card.key}
              name={card.label}
              value={card.value}
            />
          ))}
        </SimpleGrid>

        <Card p={{ base: "18px", md: "24px" }}>
          {error ? (
            <Text color="red.400" fontSize="sm" mb="16px">
              {error}
            </Text>
          ) : null}

          <Skeleton isLoaded={!loading}>
            <Box overflowX="auto">
              <Table variant="simple">
                <Thead>
                  <Tr>
                    <Th color={textColorSecondary}>UTM</Th>
                    <Th color={textColorSecondary}>Новые юзеры</Th>
                    <Th color={textColorSecondary}>Зашли, уже играя раньше</Th>
                    <Th color={textColorSecondary}>Всего кликов</Th>
                    <Th color={textColorSecondary}>Последний клик</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {response.items.length > 0 ? response.items.map((item) => (
                    <Tr key={item.utmSlug}>
                      <Td borderColor={borderColor}>
                        <Badge borderRadius="999px" colorScheme="purple" px="10px" py="6px">
                          {item.utmSlug}
                        </Badge>
                      </Td>
                      <Td borderColor={borderColor}>
                        <Text color={textColor} fontSize="sm" fontWeight="700">
                          {formatNumber(item.newUsersCount)}
                        </Text>
                      </Td>
                      <Td borderColor={borderColor}>
                        <Text color={textColorSecondary} fontSize="sm">
                          {formatNumber(item.returningUsersCount)}
                        </Text>
                      </Td>
                      <Td borderColor={borderColor}>
                        <Text color={textColorSecondary} fontSize="sm">
                          {formatNumber(item.totalClicksCount)}
                        </Text>
                      </Td>
                      <Td borderColor={borderColor}>
                        <Text color={textColorSecondary} fontSize="sm">
                          {formatDateTime(item.lastClickAt)}
                        </Text>
                      </Td>
                    </Tr>
                  )) : (
                    <Tr>
                      <Td borderColor={borderColor} colSpan={5}>
                        <Text color={textColorSecondary} fontSize="sm" py="12px" textAlign="center">
                          UTM-данных пока нет.
                        </Text>
                      </Td>
                    </Tr>
                  )}
                </Tbody>
              </Table>
            </Box>
          </Skeleton>
        </Card>
      </Stack>
    </Box>
  );
}
