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
  Select,
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
import { MdSend } from "react-icons/md";
import Card from "components/card/Card";
import MiniStatistics from "components/card/MiniStatistics";
import ImageUploader from "components/editor/ImageUploader";
import RichTextEditor from "components/editor/RichTextEditor";
import { postJson } from "api";

const STATUS_OPTIONS = [
  { value: "all", label: "Все статусы" },
  { value: "draft", label: "Черновики" },
  { value: "scheduled", label: "Запланированные" },
  { value: "sent", label: "Отправленные" },
];

const AUDIENCE_OPTIONS = [
  { value: "all", label: "Все игроки" },
  { value: "unfinished", label: "Не завершили игру" },
  { value: "unsubscribed", label: "Не подписаны" },
  { value: "winners", label: "Победители" },
];

const EMPTY_RESPONSE = {
  items: [],
  summary: {
    totalCampaignsCount: 0,
    sentCampaignsCount: 0,
    totalRecipientsCount: 0,
    deliveredRecipientsCount: 0,
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

function formatPercent(value, digits = 1) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return "0%";
  }

  return `${numericValue.toFixed(digits)}%`;
}

function getStatusBadgeProps(status) {
  if (status === "sent") {
    return {
      colorScheme: "green",
      label: "Отправлен",
    };
  }

  if (status === "scheduled") {
    return {
      colorScheme: "orange",
      label: "Запланирован",
    };
  }

  return {
    colorScheme: "gray",
    label: "Черновик",
  };
}

function htmlToPlainText(value) {
  if (!value) {
    return "";
  }

  const tempContainer = document.createElement("div");
  tempContainer.innerHTML = value;

  return (tempContainer.textContent || tempContainer.innerText || "")
    .replace(/\s+/g, " ")
    .trim();
}

export default function PushesPage() {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [statusFilter, setStatusFilter] = useState("all");
  const [response, setResponse] = useState(EMPTY_RESPONSE);
  const [loading, setLoading] = useState(true);
  const [sendingPushId, setSendingPushId] = useState(null);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [draftForm, setDraftForm] = useState({
    title: "",
    audienceKey: AUDIENCE_OPTIONS[0].value,
    html: "",
    image: null,
  });

  const textColor = useColorModeValue("navy.700", "white");
  const textColorSecondary = useColorModeValue("secondaryGray.600", "secondaryGray.500");
  const borderColor = useColorModeValue("gray.200", "whiteAlpha.100");
  const filterBg = useColorModeValue("white", "navy.800");
  const filterShadow = useColorModeValue(
    "0px 16px 36px rgba(112, 144, 176, 0.12)",
    "0px 16px 36px rgba(17, 28, 68, 0.32)",
  );
  const previewBg = useColorModeValue("secondaryGray.300", "rgba(255, 255, 255, 0.03)");
  const previewBorder = useColorModeValue("rgba(224, 229, 242, 0.95)", "rgba(255, 255, 255, 0.08)");

  async function loadPushes(nextSearch = deferredSearch, nextStatus = statusFilter) {
    const nextResponse = await postJson("/api/pushes/list", {
      search: nextSearch,
      status: nextStatus,
    });

    setResponse({
      items: Array.isArray(nextResponse?.items) ? nextResponse.items : [],
      summary: nextResponse?.summary ?? EMPTY_RESPONSE.summary,
    });
  }

  useEffect(() => {
    let cancelled = false;

    async function hydratePushes() {
      setLoading(true);
      setError("");

      try {
        const nextResponse = await postJson("/api/pushes/list", {
          search: deferredSearch,
          status: statusFilter,
        });

        if (!cancelled) {
          setResponse({
            items: Array.isArray(nextResponse?.items) ? nextResponse.items : [],
            summary: nextResponse?.summary ?? EMPTY_RESPONSE.summary,
          });
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError.message || "Не удалось загрузить пуши");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void hydratePushes();

    return () => {
      cancelled = true;
    };
  }, [deferredSearch, statusFilter]);

  const statCards = useMemo(() => ([
    {
      key: "totalCampaignsCount",
      label: "Кампаний",
      value: formatNumber(response.summary?.totalCampaignsCount ?? 0),
    },
    {
      key: "sentCampaignsCount",
      label: "Отправлено",
      value: formatNumber(response.summary?.sentCampaignsCount ?? 0),
    },
    {
      key: "totalRecipientsCount",
      label: "Пользователей в сегментах",
      value: formatNumber(response.summary?.totalRecipientsCount ?? 0),
    },
    {
      key: "deliveredRecipientsCount",
      label: "Доставлено",
      value: formatNumber(response.summary?.deliveredRecipientsCount ?? 0),
    },
  ]), [response.summary]);

  const selectedAudience = AUDIENCE_OPTIONS.find((option) => option.value === draftForm.audienceKey) || AUDIENCE_OPTIONS[0];
  const draftPreviewText = htmlToPlainText(draftForm.html);
  const canCreateDraft = draftForm.title.trim() && draftPreviewText;

  async function handleSendPush(pushId) {
    setSendingPushId(pushId);
    setError("");
    setSuccessMessage("");

    try {
      const result = await postJson("/api/pushes/send", { pushId });
      await loadPushes();
      setSuccessMessage(`Пуш «${result?.push?.title || "Без названия"}» отправлен.`);
    } catch (requestError) {
      setError(requestError.message || "Не удалось отправить пуш");
    } finally {
      setSendingPushId(null);
    }
  }

  async function handleCreateDraft() {
    if (!canCreateDraft) {
      return;
    }

    setCreatingDraft(true);
    setError("");
    setSuccessMessage("");

    try {
      const result = await postJson("/api/pushes/create", {
        title: draftForm.title.trim(),
        html: draftForm.html,
        message: draftPreviewText,
        audienceKey: selectedAudience.value,
        audienceLabel: selectedAudience.label,
        imageUrl: draftForm.image?.previewUrl || null,
      });

      await loadPushes();
      setDraftForm({
        title: "",
        audienceKey: AUDIENCE_OPTIONS[0].value,
        html: "",
        image: null,
      });
      setSuccessMessage(`Черновик «${result?.push?.title || "Без названия"}» создан.`);
    } catch (requestError) {
      setError(requestError.message || "Не удалось создать черновик");
    } finally {
      setCreatingDraft(false);
    }
  }

  return (
    <Box pt={{ base: "0px", md: "80px", xl: "80px" }}>
      <Stack spacing="20px">
        <Card p={{ base: "18px", md: "24px" }}>
          <Stack spacing="20px">
            <Flex
              direction={{ base: "column", lg: "row" }}
              align={{ base: "start", lg: "center" }}
              justify="space-between"
              gap="10px"
            >
              <Box>
                <Text color={textColor} fontSize={{ base: "xl", md: "2xl" }} fontWeight="700">
                  Новая рассылка
                </Text>
              </Box>
              <Button
                bg="brand.500"
                color="white"
                borderRadius="16px"
                fontWeight="700"
                isLoading={creatingDraft}
                loadingText="Создаём"
                onClick={handleCreateDraft}
                _hover={{ bg: "brand.600" }}
                isDisabled={!canCreateDraft}
              >
                Сохранить черновик
              </Button>
            </Flex>

            <SimpleGrid columns={{ base: 1, xl: 2 }} gap="20px">
              <Stack spacing="16px">
                <Box>
                  <Text color={textColor} fontSize="sm" fontWeight="700" mb="8px">
                    Заголовок
                  </Text>
                  <Input
                    h="56px"
                    bg={filterBg}
                    borderColor={borderColor}
                    borderRadius="18px"
                    fontSize="sm"
                    fontWeight="500"
                    placeholder="Например: Финальный день розыгрыша"
                    value={draftForm.title}
                    onChange={(event) => {
                      setDraftForm((current) => ({ ...current, title: event.target.value }));
                    }}
                  />
                </Box>

                <Box>
                  <Text color={textColor} fontSize="sm" fontWeight="700" mb="8px">
                    Сегмент
                  </Text>
                  <Select
                    h="56px"
                    bg={filterBg}
                    borderColor={borderColor}
                    borderRadius="18px"
                    fontSize="sm"
                    fontWeight="600"
                    value={draftForm.audienceKey}
                    onChange={(event) => {
                      setDraftForm((current) => ({ ...current, audienceKey: event.target.value }));
                    }}
                  >
                    {AUDIENCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Box>

                <Box>
                  <Text color={textColor} fontSize="sm" fontWeight="700" mb="8px">
                    Текст сообщения
                  </Text>
                  <RichTextEditor
                    value={draftForm.html}
                    onChange={(nextValue) => {
                      setDraftForm((current) => ({ ...current, html: nextValue }));
                    }}
                    placeholder="Наберите текст, добавьте ссылку, список или акцентный фрагмент…"
                  />
                </Box>

                <Box>
                  <Text color={textColor} fontSize="sm" fontWeight="700" mb="8px">
                    Фото
                  </Text>
                  <ImageUploader
                    value={draftForm.image}
                    onChange={(nextImage) => {
                      setDraftForm((current) => ({ ...current, image: nextImage }));
                    }}
                  />
                </Box>
              </Stack>

              <Box
                border="1px solid"
                borderColor={previewBorder}
                borderRadius="24px"
                bg={previewBg}
                p={{ base: "18px", md: "22px" }}
              >
                <Text color={textColor} fontSize="lg" fontWeight="700" mb="6px">
                  Превью рассылки
                </Text>
                <Text color={textColorSecondary} fontSize="sm" mb="16px">
                  Так будет выглядеть заготовка перед отправкой.
                </Text>

                <Stack spacing="14px">
                  <Badge
                    alignSelf="start"
                    borderRadius="999px"
                    colorScheme="purple"
                    px="10px"
                    py="6px"
                  >
                    {selectedAudience.label}
                  </Badge>

                  <Text color={textColor} fontSize="xl" fontWeight="700">
                    {draftForm.title.trim() || "Без заголовка"}
                  </Text>

                  {draftForm.image?.previewUrl ? (
                    <Image
                      src={draftForm.image.previewUrl}
                      alt={draftForm.image.name || "Превью фото"}
                      borderRadius="20px"
                      maxH="240px"
                      objectFit="cover"
                      w="100%"
                    />
                  ) : null}

                  <Box
                    color={textColorSecondary}
                    fontSize="sm"
                    lineHeight="1.8"
                    sx={{
                      "& p": {
                        marginBottom: "10px",
                      },
                      "& ul, & ol": {
                        paddingLeft: "20px",
                        marginBottom: "10px",
                      },
                      "& a": {
                        color: "var(--chakra-colors-brand-500)",
                        textDecoration: "underline",
                      },
                    }}
                    dangerouslySetInnerHTML={{
                      __html: draftForm.html || "<p>Текст сообщения появится здесь.</p>",
                    }}
                  />
                </Stack>
              </Box>
            </SimpleGrid>
          </Stack>
        </Card>

        <Card p="24px">
          <Flex
            w="100%"
            align={{ base: "stretch", lg: "center" }}
            justify="center"
            direction={{ base: "column", lg: "row" }}
            gap="12px"
          >
            <Flex
              w="100%"
              align="stretch"
              justify={{ base: "stretch", lg: "space-between" }}
              gap={{ base: "12px", lg: "20px", xl: "28px" }}
              flexWrap={{ base: "wrap", lg: "nowrap" }}
            >
              <InputGroup flex={{ base: "1 1 100%", lg: "1.4 1 0" }} minW="0">
                <InputLeftElement pointerEvents="none" h="56px" ps="8px">
                  <Icon as={SearchIcon} color="secondaryGray.500" boxSize="16px" />
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
                  placeholder="Поиск по названию пуша или сегменту"
                  ps="44px"
                  value={search}
                  _hover={{ borderColor: "transparent" }}
                  _focusVisible={{
                    borderColor: "brand.200",
                    boxShadow: `0 0 0 1px var(--chakra-colors-brand-200), ${filterShadow}`,
                  }}
                />
              </InputGroup>

              <Select
                h="56px"
                flex={{ base: "1 1 100%", lg: "0 0 240px" }}
                bg={filterBg}
                borderColor="transparent"
                borderRadius="20px"
                boxShadow={filterShadow}
                fontSize="sm"
                fontWeight="600"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                _hover={{ borderColor: "transparent" }}
                _focusVisible={{
                  borderColor: "brand.200",
                  boxShadow: `0 0 0 1px var(--chakra-colors-brand-200), ${filterShadow}`,
                }}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Flex>
          </Flex>
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

        <SimpleGrid columns={{ base: 1, md: 2, xl: 4 }} gap="20px">
          {statCards.map((card) => (
            <MiniStatistics
              key={card.key}
              name={card.label}
              value={card.value}
            />
          ))}
        </SimpleGrid>

        <Card p={{ base: "18px", md: "24px" }}>
          <Skeleton isLoaded={!loading}>
            <Box overflowX="auto">
              <Table variant="simple">
                <Thead>
                  <Tr>
                    <Th color={textColorSecondary}>Кампания</Th>
                    <Th color={textColorSecondary}>Сегмент</Th>
                    <Th color={textColorSecondary}>Статус</Th>
                    <Th color={textColorSecondary}>Охват</Th>
                    <Th color={textColorSecondary}>Open rate</Th>
                    <Th color={textColorSecondary}>CTR</Th>
                    <Th color={textColorSecondary}>Запланирован</Th>
                    <Th color={textColorSecondary}>Действие</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {response.items.length > 0 ? response.items.map((item) => {
                    const badge = getStatusBadgeProps(item.status);

                    return (
                      <Tr key={item.id}>
                        <Td borderColor={borderColor}>
                          <Stack spacing="8px">
                            {item.imageUrl ? (
                              <Image
                                src={item.imageUrl}
                                alt={item.title}
                                borderRadius="16px"
                                boxSize="56px"
                                objectFit="cover"
                              />
                            ) : null}
                            <Text color={textColor} fontSize="sm" fontWeight="700">
                              {item.title}
                            </Text>
                            <Text color={textColorSecondary} fontSize="xs">
                              {item.message}
                            </Text>
                          </Stack>
                        </Td>
                        <Td borderColor={borderColor}>
                          <Badge borderRadius="999px" colorScheme="purple" px="10px" py="6px">
                            {item.audienceLabel}
                          </Badge>
                        </Td>
                        <Td borderColor={borderColor}>
                          <Badge borderRadius="999px" colorScheme={badge.colorScheme} px="10px" py="6px">
                            {badge.label}
                          </Badge>
                        </Td>
                        <Td borderColor={borderColor}>
                          <Text color={textColorSecondary} fontSize="sm">
                            {formatNumber(item.deliveredCount)} / {formatNumber(item.recipientsCount)}
                          </Text>
                        </Td>
                        <Td borderColor={borderColor}>
                          <Text color={textColorSecondary} fontSize="sm">
                            {formatPercent(item.openRate)}
                          </Text>
                        </Td>
                        <Td borderColor={borderColor}>
                          <Text color={textColorSecondary} fontSize="sm">
                            {formatPercent(item.ctr)}
                          </Text>
                        </Td>
                        <Td borderColor={borderColor}>
                          <Stack spacing="4px">
                            <Text color={textColorSecondary} fontSize="sm">
                              {formatDateTime(item.scheduledAt)}
                            </Text>
                            <Text color={textColorSecondary} fontSize="xs">
                              Отправлен: {formatDateTime(item.sentAt)}
                            </Text>
                          </Stack>
                        </Td>
                        <Td borderColor={borderColor}>
                          {item.status === "draft" ? (
                            <Button
                              size="sm"
                              bg="brand.500"
                              color="white"
                              borderRadius="14px"
                              fontWeight="700"
                              isLoading={sendingPushId === item.id}
                              leftIcon={<Icon as={MdSend} boxSize="16px" />}
                              loadingText="Шлём"
                              onClick={() => handleSendPush(item.id)}
                              _hover={{ bg: "brand.600" }}
                            >
                              Отправить
                            </Button>
                          ) : (
                            <Text color={textColorSecondary} fontSize="sm">
                              {item.status === "sent" ? "Завершено" : "Ждёт отправки"}
                            </Text>
                          )}
                        </Td>
                      </Tr>
                    );
                  }) : (
                    <Tr>
                      <Td borderColor={borderColor} colSpan={8}>
                        <Text color={textColorSecondary} fontSize="sm" py="12px" textAlign="center">
                          Пушей по текущему фильтру пока нет.
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
