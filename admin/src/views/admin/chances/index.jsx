import {
  Badge,
  Box,
  Button,
  Flex,
  Icon,
  Image,
  Input,
  InputGroup,
  InputLeftElement,
  Skeleton,
  Stack,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tooltip,
  Tr,
  useColorModeValue,
} from "@chakra-ui/react";
import { SearchIcon } from "@chakra-ui/icons";
import { useDeferredValue, useEffect, useState } from "react";
import { MdCardGiftcard, MdDoNotDisturbAlt, MdSave } from "react-icons/md";
import Card from "components/card/Card";
import { postJson } from "api";

function formatProbability(value) {
  return `${new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0)}%`;
}

const EMPTY_RESPONSE = {
  items: [],
  summary: {
    totalPositionsCount: 0,
    totalWeight: 0,
  },
};

export default function ChancesPage() {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [response, setResponse] = useState(EMPTY_RESPONSE);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const textColor = useColorModeValue("navy.700", "white");
  const textColorSecondary = useColorModeValue("secondaryGray.600", "secondaryGray.500");
  const borderColor = useColorModeValue("gray.200", "whiteAlpha.100");
  const filterBg = useColorModeValue("white", "navy.800");
  const filterShadow = useColorModeValue(
    "0px 16px 36px rgba(112, 144, 176, 0.12)",
    "0px 16px 36px rgba(17, 28, 68, 0.32)",
  );
  const categoryBadgeBg = useColorModeValue("secondaryGray.300", "rgba(255, 255, 255, 0.06)");
  const categoryBadgeColor = useColorModeValue("navy.700", "white");
  const probabilityColor = useColorModeValue("brand.500", "white");
  const tableCardBorder = useColorModeValue("rgba(224, 229, 242, 0.95)", "rgba(255, 255, 255, 0.08)");

  useEffect(() => {
    let cancelled = false;

    async function loadChances() {
      setLoading(true);
      setError("");

      try {
        const nextResponse = await postJson("/api/chances/list", {
          search: deferredSearch,
        });

        if (!cancelled) {
          const nextItems = Array.isArray(nextResponse?.items) ? nextResponse.items : [];
          setResponse({
            items: nextItems,
            summary: nextResponse?.summary ?? EMPTY_RESPONSE.summary,
          });
          setDrafts(Object.fromEntries(nextItems.map((item) => [item.id, item.chanceValue || ""])));
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError.message || "Не удалось загрузить шансы");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadChances();

    return () => {
      cancelled = true;
    };
  }, [deferredSearch]);

  async function reloadChances() {
    const nextResponse = await postJson("/api/chances/list", {
      search: deferredSearch,
    });
    const nextItems = Array.isArray(nextResponse?.items) ? nextResponse.items : [];

    setResponse({
      items: nextItems,
      summary: nextResponse?.summary ?? EMPTY_RESPONSE.summary,
    });
    setDrafts(Object.fromEntries(nextItems.map((item) => [item.id, item.chanceValue || ""])));
  }

  async function handleSaveChance(itemId) {
    setSavingId(itemId);
    setError("");
    setSuccessMessage("");

    try {
      await postJson("/api/chances/update", {
        id: itemId,
        chanceValue: drafts[itemId],
      });
      await reloadChances();
      setSuccessMessage("Шансы обновлены.");
    } catch (requestError) {
      setError(requestError.message || "Не удалось обновить шанс");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <Box pt={{ base: "0px", md: "80px", xl: "80px" }}>
      <Stack spacing="20px">
        <Card p="24px">
          <InputGroup maxW={{ base: "100%", lg: "420px" }}>
            <InputLeftElement pointerEvents="none" h="56px" ps="8px">
              <Icon as={SearchIcon} color="secondaryGray.500" boxSize="16px" />
            </InputLeftElement>
            <Input
              h="56px"
              bg={filterBg}
              borderColor="transparent"
              borderRadius="20px"
              boxShadow={filterShadow}
              fontSize="sm"
              fontWeight="500"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск по позиции, типу или категории"
              ps="44px"
              value={search}
              _hover={{ borderColor: "transparent" }}
              _focusVisible={{
                borderColor: "brand.200",
                boxShadow: `0 0 0 1px var(--chakra-colors-brand-200), ${filterShadow}`,
              }}
            />
          </InputGroup>
        </Card>

        {error ? (
          <Card p="18px">
            <Text color="red.500" fontWeight="700">
              {error}
            </Text>
          </Card>
        ) : null}

        {successMessage ? (
          <Card p="18px">
            <Text color="green.500" fontWeight="700">
              {successMessage}
            </Text>
          </Card>
        ) : null}

        <Card p={{ base: "18px", md: "24px" }} border="1px solid" borderColor={tableCardBorder}>
          <Skeleton isLoaded={!loading}>
            <Box overflowX="auto">
              <Table variant="simple">
                <Thead>
                  <Tr>
                    <Th color={textColorSecondary}>Название</Th>
                    <Th color={textColorSecondary}>Тип</Th>
                    <Th color={textColorSecondary}>Категория</Th>
                    <Th color={textColorSecondary}>Тип промокода</Th>
                    <Th color={textColorSecondary}>Шанс</Th>
                    <Th color={textColorSecondary}>Вероятность</Th>
                    <Th color={textColorSecondary}>Действие</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {response.items.length > 0 ? response.items.map((item) => (
                    <Tr key={item.id}>
                      <Td borderColor={borderColor} py="18px">
                        <Flex align="center" gap="12px" minH="44px">
                          <Flex
                            w="44px"
                            h="44px"
                            align="center"
                            justify="center"
                            borderRadius="14px"
                            bg={categoryBadgeBg}
                            overflow="hidden"
                            flexShrink={0}
                          >
                            {item.rouletteImage?.previewUrl ? (
                              <Image
                                src={item.rouletteImage.previewUrl}
                                alt={item.title || "Превью позиции"}
                                w="100%"
                                h="100%"
                                objectFit="contain"
                              />
                            ) : (
                              <Icon
                                as={item.type === "Приз" ? MdCardGiftcard : MdDoNotDisturbAlt}
                                boxSize="18px"
                                color={textColorSecondary}
                              />
                            )}
                          </Flex>
                          <Stack spacing="4px">
                            <Text color={textColor} fontSize="sm" fontWeight="700">
                              {item.myPrizeText || item.title}
                            </Text>
                            <Text color={textColorSecondary} fontSize="xs">
                              ID: {item.id}
                            </Text>
                          </Stack>
                        </Flex>
                      </Td>
                      <Td borderColor={borderColor} py="18px">
                        <Tooltip label={item.type} hasArrow placement="top">
                          <Flex
                            w="36px"
                            h="36px"
                            align="center"
                            justify="center"
                            borderRadius="12px"
                            bg={item.type === "Приз" ? "brand.50" : categoryBadgeBg}
                            color={item.type === "Приз" ? "brand.500" : textColorSecondary}
                          >
                            <Icon
                              as={item.type === "Приз" ? MdCardGiftcard : MdDoNotDisturbAlt}
                              boxSize="18px"
                            />
                          </Flex>
                        </Tooltip>
                      </Td>
                      <Td borderColor={borderColor} py="18px">
                        {item.category ? (
                          <Badge
                            bg={categoryBadgeBg}
                            color={categoryBadgeColor}
                            borderRadius="999px"
                            px="10px"
                            py="6px"
                            fontSize="xs"
                            fontWeight="700"
                            whiteSpace="normal"
                          >
                            {item.category}
                          </Badge>
                        ) : (
                          <Text color={textColorSecondary} fontSize="sm" fontWeight="600">
                            —
                          </Text>
                        )}
                      </Td>
                      <Td borderColor={borderColor} py="18px">
                        <Text color={textColor} fontSize="sm" fontWeight="600">
                          {item.promoCodeType || "—"}
                        </Text>
                      </Td>
                      <Td borderColor={borderColor} py="18px">
                        <Input
                          h="44px"
                          minW="110px"
                          borderRadius="16px"
                          value={drafts[item.id] ?? ""}
                          onChange={(event) => setDrafts((current) => ({
                            ...current,
                            [item.id]: event.target.value,
                          }))}
                          placeholder="1x"
                        />
                      </Td>
                      <Td borderColor={borderColor} py="18px">
                        <Text color={probabilityColor} fontSize="sm" fontWeight="700">
                          {formatProbability(item.probabilityPercent)}
                        </Text>
                      </Td>
                      <Td borderColor={borderColor} py="18px">
                        <Button
                          variant="lightBrand"
                          size="sm"
                          minW="118px"
                          h="38px"
                          leftIcon={<Icon as={MdSave} boxSize="16px" />}
                          fontSize="sm"
                          fontWeight="700"
                          isLoading={savingId === item.id}
                          loadingText="Сохраняем"
                          onClick={() => handleSaveChance(item.id)}
                        >
                          Сохранить
                        </Button>
                      </Td>
                    </Tr>
                  )) : (
                    <Tr>
                      <Td borderColor={borderColor} colSpan={7}>
                        <Text color={textColorSecondary} fontSize="sm" py="12px" textAlign="center">
                          Позиции не найдены.
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
