import {
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  FormControl,
  FormLabel,
  Icon,
  Image,
  Input,
  InputGroup,
  InputLeftElement,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  Select,
  Skeleton,
  SimpleGrid,
  Stack,
  Table,
  Tbody,
  Td,
  Text,
  Textarea,
  Th,
  Thead,
  Tooltip,
  Tr,
  useColorModeValue,
  useDisclosure,
} from "@chakra-ui/react";
import { SearchIcon } from "@chakra-ui/icons";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { MdAdd, MdCardGiftcard, MdDelete, MdDoNotDisturbAlt, MdEdit } from "react-icons/md";
import * as XLSX from "xlsx";
import Card from "components/card/Card";
import ImageUploader from "components/editor/ImageUploader";
import { postJson } from "api";

const PRIZE_TYPE_OPTIONS = [
  { value: "Приз", label: "Приз" },
  { value: "Не приз", label: "Не приз" },
];

const PRIZE_CATEGORY_OPTIONS = [
  "Отели",
  "Авиа",
  "Баллы Ozon",
  "Мили",
];

const PROMO_CODE_TYPE_OPTIONS = [
  { value: "", label: "Нет типа" },
  { value: "Промокод на первый заказ", label: "Промокод на первый заказ" },
  { value: "Промокод на повторный заказ", label: "Промокод на повторный заказ" },
];

function formatNumber(value) {
  return new Intl.NumberFormat("ru-RU").format(Number(value) || 0);
}

function splitPromoCodes(rawValue) {
  return String(rawValue || "")
    .split(/\r?\n|,|;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseWorkbookPromoCodes(fileName, rows = []) {
  const normalizedFileName = String(fileName || "").toLowerCase();
  const preferredKeys = ["promo_code", "promocode", "code", "promo code", "промокод"];
  const codes = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }

    const entries = Object.entries(row);

    if (!entries.length) {
      continue;
    }

    let value = "";

    for (const preferredKey of preferredKeys) {
      const matchedEntry = entries.find(([key]) => String(key || "").trim().toLowerCase() === preferredKey);

      if (matchedEntry) {
        value = String(matchedEntry[1] || "").trim();
        break;
      }
    }

    if (!value) {
      const nonNumericEntry = entries.find(([key, entryValue]) => {
        const normalizedKey = String(key || "").trim().toLowerCase();

        if (normalizedKey === "id" || normalizedKey === "__empty") {
          return false;
        }

        return String(entryValue || "").trim();
      });

      value = String(nonNumericEntry?.[1] || "").trim();
    }

    if (!value) {
      continue;
    }

    const looksLikeHeader =
      normalizedFileName.includes(value.toLowerCase())
      || preferredKeys.includes(value.toLowerCase())
      || value.toLowerCase() === "id";

    if (!looksLikeHeader) {
      codes.push(value);
    }
  }

  return Array.from(new Set(codes));
}

function ToggleButtonGroup({
  value,
  onChange,
  leftLabel = "Есть",
  rightLabel = "Нет",
}) {
  return (
    <Flex gap="10px" wrap="wrap">
      <Button
        type="button"
        variant={value ? "brand" : "light"}
        minW="92px"
        h="44px"
        fontSize="sm"
        fontWeight="700"
        onClick={() => onChange(true)}
      >
        {leftLabel}
      </Button>
      <Button
        type="button"
        variant={!value ? "brand" : "light"}
        minW="92px"
        h="44px"
        fontSize="sm"
        fontWeight="700"
        onClick={() => onChange(false)}
      >
        {rightLabel}
      </Button>
    </Flex>
  );
}

function FormSection({
  title,
  description,
  children,
}) {
  const bg = useColorModeValue("white", "navy.900");
  const borderColor = useColorModeValue("rgba(224, 229, 242, 0.95)", "rgba(255, 255, 255, 0.08)");
  const titleColor = useColorModeValue("navy.700", "white");
  const descriptionColor = useColorModeValue("secondaryGray.600", "secondaryGray.500");

  return (
    <Box bg={bg} border="1px solid" borderColor={borderColor} borderRadius="24px" p={{ base: "18px", md: "22px" }}>
      <Stack spacing="16px">
        <Box>
          <Text color={titleColor} fontSize="md" fontWeight="700">
            {title}
          </Text>
          {description ? (
            <Text color={descriptionColor} fontSize="sm" mt="4px">
              {description}
            </Text>
          ) : null}
        </Box>
        {children}
      </Stack>
    </Box>
  );
}

const EMPTY_RESPONSE = {
  items: [],
  summary: {
    totalPrizesCount: 0,
    totalUnitsCount: 0,
    totalRemainingCount: 0,
  },
};

function createInitialPrizeForm() {
  return {
    title: "",
    category: "",
    promoCodeType: "",
    type: PRIZE_TYPE_OPTIONS[0].value,
    hasPrizeLimit: true,
    promoCodesFile: null,
    promoCodes: [],
    promoCodeValue: "",
    totalCount: "",
    chanceValue: "1x",
    hasUserLimit: true,
    userLimitCount: "",
    activeFrom: "",
    activeTo: "",
    rouletteImage: null,
    myPrizeText: "",
    rouletteDescription: "",
  };
}

export default function PromoCodesPage() {
  const choosePrizeTypeModal = useDisclosure();
  const createPrizeModal = useDisclosure();
  const nonPrizeModal = useDisclosure();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [promoCodeTypeFilter, setPromoCodeTypeFilter] = useState("");
  const [response, setResponse] = useState(EMPTY_RESPONSE);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingPrizeId, setDeletingPrizeId] = useState(null);
  const [deletingMany, setDeletingMany] = useState(false);
  const [selectedPrizeIds, setSelectedPrizeIds] = useState([]);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [editingPrizeId, setEditingPrizeId] = useState(null);
  const [form, setForm] = useState(createInitialPrizeForm);
  const [promoCodesUploadError, setPromoCodesUploadError] = useState("");
  const promoCodesInputRef = useRef(null);

  const textColor = useColorModeValue("navy.700", "white");
  const textColorSecondary = useColorModeValue("secondaryGray.600", "secondaryGray.500");
  const borderColor = useColorModeValue("gray.200", "whiteAlpha.100");
  const filterBg = useColorModeValue("white", "navy.800");
  const filterShadow = useColorModeValue(
    "0px 16px 36px rgba(112, 144, 176, 0.12)",
    "0px 16px 36px rgba(17, 28, 68, 0.32)",
  );
  const modalBg = useColorModeValue("white", "navy.800");
  const categoryBadgeBg = useColorModeValue("secondaryGray.300", "rgba(255, 255, 255, 0.06)");
  const categoryBadgeColor = useColorModeValue("navy.700", "white");
  const totalValueColor = useColorModeValue("navy.700", "white");
  const remainingValueColor = useColorModeValue("green.500", "green.300");
  const tableCardBorder = useColorModeValue("rgba(224, 229, 242, 0.95)", "rgba(255, 255, 255, 0.08)");

  function formatPrizeCount(item, value) {
    if (!item?.hasPrizeLimit) {
      return "Без лимита";
    }

    return formatNumber(value);
  }

  useEffect(() => {
    let cancelled = false;

    async function loadPrizes() {
      setLoading(true);
      setError("");

      try {
        const nextResponse = await postJson("/api/prizes/list", {
          search: deferredSearch,
          category: categoryFilter,
          promoCodeType: promoCodeTypeFilter,
        });

        if (!cancelled) {
          setResponse({
            items: Array.isArray(nextResponse?.items) ? nextResponse.items : [],
            summary: nextResponse?.summary ?? EMPTY_RESPONSE.summary,
          });
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError.message || "Не удалось загрузить призы");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadPrizes();

    return () => {
      cancelled = true;
    };
  }, [deferredSearch, categoryFilter, promoCodeTypeFilter]);

  useEffect(() => {
    const visibleIds = new Set(response.items.map((item) => item.id));
    setSelectedPrizeIds((current) => current.filter((id) => visibleIds.has(id)));
  }, [response.items]);

  async function reloadPrizes() {
    const nextResponse = await postJson("/api/prizes/list", {
      search: deferredSearch,
      category: categoryFilter,
      promoCodeType: promoCodeTypeFilter,
    });

    setResponse({
      items: Array.isArray(nextResponse?.items) ? nextResponse.items : [],
      summary: nextResponse?.summary ?? EMPTY_RESPONSE.summary,
    });
  }

  async function handleCreatePrize() {
    setCreating(true);
    setError("");
    setSuccessMessage("");

    try {
      const isNonPrize = form.type === "Не приз";
      const requestPath = editingPrizeId ? "/api/prizes/update" : "/api/prizes/create";
      const result = await postJson(requestPath, {
        id: editingPrizeId,
        title: form.title,
        category: isNonPrize ? "" : form.category,
        promoCodeType: isNonPrize ? "" : form.promoCodeType,
        type: form.type,
        hasPrizeLimit: isNonPrize ? false : form.hasPrizeLimit,
        promoCodesFileName: isNonPrize ? "" : form.promoCodesFile?.name || "",
        promoCodes: isNonPrize ? [] : form.promoCodes,
        promoCodeValue: isNonPrize ? "" : form.promoCodeValue,
        totalCount: isNonPrize ? 0 : form.totalCount,
        chanceValue: form.chanceValue,
        hasUserLimit: isNonPrize ? false : form.hasUserLimit,
        userLimitCount: isNonPrize ? "" : form.userLimitCount,
        activeFrom: form.activeFrom,
        activeTo: form.activeTo,
        rouletteImage: form.rouletteImage,
        myPrizeText: isNonPrize ? form.title : form.myPrizeText,
        rouletteDescription: form.rouletteDescription,
      });

      await reloadPrizes();
      setSuccessMessage(
        editingPrizeId
          ? `Позиция «${result?.prize?.title || form.title}» обновлена.`
          : `Позиция «${result?.prize?.title || form.title}» добавлена.`,
      );
      setEditingPrizeId(null);
      setForm(createInitialPrizeForm());
      setPromoCodesUploadError("");
      createPrizeModal.onClose();
      nonPrizeModal.onClose();
      choosePrizeTypeModal.onClose();
    } catch (requestError) {
      setError(requestError.message || (editingPrizeId ? "Не удалось обновить приз" : "Не удалось добавить приз"));
    } finally {
      setCreating(false);
    }
  }

  function handleOpenCreateModal() {
    setEditingPrizeId(null);
    setForm(createInitialPrizeForm());
    setPromoCodesUploadError("");
    choosePrizeTypeModal.onOpen();
  }

  function handleSelectPrizeType(nextType) {
    setEditingPrizeId(null);
    setPromoCodesUploadError("");
    setForm({
      ...createInitialPrizeForm(),
      type: nextType,
      category: nextType === "Приз" ? PRIZE_CATEGORY_OPTIONS[0] : "",
      hasPrizeLimit: nextType === "Приз",
      hasUserLimit: nextType === "Приз",
    });
    choosePrizeTypeModal.onClose();

    if (nextType === "Приз") {
      createPrizeModal.onOpen();
      return;
    }

    nonPrizeModal.onOpen();
  }

  function handleOpenEditModal(item) {
    setEditingPrizeId(item.id);
    setForm({
      title: item.title || "",
      category: item.category || "",
      promoCodeType: item.promoCodeType || "",
      type: item.type || PRIZE_TYPE_OPTIONS[0].value,
      hasPrizeLimit: item.hasPrizeLimit ?? true,
      promoCodesFile: item.promoCodesFileName ? { name: item.promoCodesFileName } : null,
      promoCodes: Array.isArray(item.promoCodes) ? item.promoCodes : [],
      promoCodeValue: item.promoCodeValue || "",
      totalCount: String(item.totalCount || ""),
      chanceValue: item.chanceValue || "1x",
      hasUserLimit: item.hasUserLimit ?? true,
      userLimitCount: item.userLimitCount ? String(item.userLimitCount) : "",
      activeFrom: item.activeFrom || "",
      activeTo: item.activeTo || "",
      rouletteImage: item.rouletteImage || null,
      myPrizeText: item.myPrizeText || "",
      rouletteDescription: item.rouletteDescription || "",
    });
    setPromoCodesUploadError("");

    if (item.type === "Не приз") {
      nonPrizeModal.onOpen();
      return;
    }

    createPrizeModal.onOpen();
  }

  async function handlePromoCodesFileChange(filesList) {
    const nextFile = Array.from(filesList || [])[0];

    if (!nextFile) {
      return;
    }

    try {
      let parsedCodes = [];
      const isPlainTextFile = nextFile.type.startsWith("text/") || /\.(txt|csv)$/i.test(nextFile.name);
      const isExcelFile = /\.(xls|xlsx)$/i.test(nextFile.name);

      if (isPlainTextFile) {
        const rawValue = await nextFile.text();
        parsedCodes = splitPromoCodes(rawValue);
      }

      if (isExcelFile) {
        const fileBuffer = await nextFile.arrayBuffer();
        const workbook = XLSX.read(fileBuffer, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const firstSheet = firstSheetName ? workbook.Sheets[firstSheetName] : null;

        if (!firstSheet) {
          throw new Error("Не удалось прочитать лист с промокодами");
        }

        const rows = XLSX.utils.sheet_to_json(firstSheet, {
          defval: "",
        });

        parsedCodes = parseWorkbookPromoCodes(nextFile.name, rows);
      }

      setPromoCodesUploadError("");
      setForm((current) => ({
        ...current,
        promoCodesFile: {
          name: nextFile.name,
          size: nextFile.size,
          type: nextFile.type,
        },
        promoCodes: parsedCodes,
      }));
    } catch (uploadError) {
      setPromoCodesUploadError(uploadError.message || "Не удалось загрузить список промокодов");
    }
  }

  async function handleDeletePrize(item) {
    if (!item?.id) {
      return;
    }

    const confirmed = window.confirm(`Удалить позицию «${item.title || `#${item.id}`}»?`);

    if (!confirmed) {
      return;
    }

    setDeletingPrizeId(item.id);
    setError("");
    setSuccessMessage("");

    try {
      const result = await postJson("/api/prizes/delete", {
        id: item.id,
      });

      await reloadPrizes();
      setSuccessMessage(`Позиция «${result?.title || item.title}» удалена.`);
      setSelectedPrizeIds((current) => current.filter((id) => id !== item.id));

      if (editingPrizeId === item.id) {
        setEditingPrizeId(null);
        setForm(createInitialPrizeForm());
        setPromoCodesUploadError("");
        createPrizeModal.onClose();
        nonPrizeModal.onClose();
      }
    } catch (requestError) {
      setError(requestError.message || "Не удалось удалить приз");
    } finally {
      setDeletingPrizeId(null);
    }
  }

  function handleTogglePrizeSelection(prizeId, checked) {
    setSelectedPrizeIds((current) => {
      if (checked) {
        return current.includes(prizeId) ? current : [...current, prizeId];
      }

      return current.filter((id) => id !== prizeId);
    });
  }

  function handleToggleSelectAll(checked) {
    if (!checked) {
      setSelectedPrizeIds([]);
      return;
    }

    setSelectedPrizeIds(response.items.map((item) => item.id));
  }

  async function handleDeleteSelectedPrizes() {
    if (!selectedPrizeIds.length) {
      return;
    }

    const confirmed = window.confirm(`Удалить выбранные позиции: ${selectedPrizeIds.length} шт.?`);

    if (!confirmed) {
      return;
    }

    setDeletingMany(true);
    setError("");
    setSuccessMessage("");

    try {
      const result = await postJson("/api/prizes/delete-many", {
        ids: selectedPrizeIds,
      });

      await reloadPrizes();
      setSelectedPrizeIds([]);
      setSuccessMessage(`Удалено позиций: ${result?.deletedCount || selectedPrizeIds.length}.`);

      if (editingPrizeId && selectedPrizeIds.includes(editingPrizeId)) {
        setEditingPrizeId(null);
        setForm(createInitialPrizeForm());
        setPromoCodesUploadError("");
        createPrizeModal.onClose();
        nonPrizeModal.onClose();
      }
    } catch (requestError) {
      setError(requestError.message || "Не удалось удалить выбранные призы");
    } finally {
      setDeletingMany(false);
    }
  }

  const allVisibleSelected = response.items.length > 0 && selectedPrizeIds.length === response.items.length;
  const partiallySelected = selectedPrizeIds.length > 0 && selectedPrizeIds.length < response.items.length;

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
                  placeholder="Поиск по названию, типу или категории"
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
                flex={{ base: "1 1 100%", lg: "0 0 220px" }}
                bg={filterBg}
                borderColor="transparent"
                borderRadius="20px"
                boxShadow={filterShadow}
                fontSize="sm"
                fontWeight="500"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                _hover={{ borderColor: "transparent" }}
                _focusVisible={{
                  borderColor: "brand.200",
                  boxShadow: `0 0 0 1px var(--chakra-colors-brand-200), ${filterShadow}`,
                }}
              >
                <option value="">Все категории</option>
                {PRIZE_CATEGORY_OPTIONS.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </Select>
              <Select
                h="56px"
                flex={{ base: "1 1 100%", lg: "0 0 280px" }}
                bg={filterBg}
                borderColor="transparent"
                borderRadius="20px"
                boxShadow={filterShadow}
                fontSize="sm"
                fontWeight="500"
                value={promoCodeTypeFilter}
                onChange={(event) => setPromoCodeTypeFilter(event.target.value)}
                _hover={{ borderColor: "transparent" }}
                _focusVisible={{
                  borderColor: "brand.200",
                  boxShadow: `0 0 0 1px var(--chakra-colors-brand-200), ${filterShadow}`,
                }}
              >
                <option value="">Все типы промокода</option>
                {PROMO_CODE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value || "__empty"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>

              <Button
                h="56px"
                flex={{ base: "1 1 100%", lg: "0 0 220px" }}
                bg="brand.500"
                color="white"
                borderRadius="20px"
                fontSize="sm"
                fontWeight="700"
                leftIcon={<Icon as={MdAdd} boxSize="20px" />}
                onClick={handleOpenCreateModal}
                _hover={{ bg: "brand.600" }}
              >
                Добавить
              </Button>
              <Button
                h="56px"
                flex={{ base: "1 1 100%", lg: "0 0 220px" }}
                variant="outline"
                colorScheme="red"
                borderRadius="20px"
                fontSize="sm"
                fontWeight="700"
                leftIcon={<Icon as={MdDelete} boxSize="20px" />}
                isDisabled={!selectedPrizeIds.length}
                isLoading={deletingMany}
                loadingText="Удаляем"
                onClick={() => void handleDeleteSelectedPrizes()}
              >
                Удалить выбранные
              </Button>
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

        <Card p={{ base: "18px", md: "24px" }} border="1px solid" borderColor={tableCardBorder}>
          <Skeleton isLoaded={!loading}>
            <Box overflowX="auto">
              <Table variant="simple">
                <Thead>
                  <Tr>
                    <Th color={textColorSecondary} ps="6px">
                      <Checkbox
                        colorScheme="brandScheme"
                        isChecked={allVisibleSelected}
                        isIndeterminate={partiallySelected}
                        onChange={(event) => handleToggleSelectAll(event.target.checked)}
                      />
                    </Th>
                    <Th color={textColorSecondary}>Название</Th>
                    <Th color={textColorSecondary}>Тип</Th>
                    <Th color={textColorSecondary}>Категория</Th>
                    <Th color={textColorSecondary}>Тип промокода</Th>
                    <Th color={textColorSecondary}>Всего призов</Th>
                    <Th color={textColorSecondary}>Остаток</Th>
                    <Th color={textColorSecondary}>Действие</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {response.items.length > 0 ? response.items.map((item) => (
                    <Tr key={item.id}>
                      <Td borderColor={borderColor} ps="6px">
                        <Checkbox
                          colorScheme="brandScheme"
                          isChecked={selectedPrizeIds.includes(item.id)}
                          onChange={(event) => handleTogglePrizeSelection(item.id, event.target.checked)}
                        />
                      </Td>
                      <Td borderColor={borderColor}>
                        <Flex align="center" gap="12px">
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
                      <Td borderColor={borderColor}>
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
                      <Td borderColor={borderColor}>
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
                      <Td borderColor={borderColor}>
                        <Text color={textColor} fontSize="sm" fontWeight="600">
                          {item.promoCodeType || "Нет типа"}
                        </Text>
                      </Td>
                      <Td borderColor={borderColor}>
                        <Text color={totalValueColor} fontSize="sm" fontWeight="700">
                          {formatPrizeCount(item, item.totalCount)}
                        </Text>
                      </Td>
                      <Td borderColor={borderColor}>
                        <Text color={remainingValueColor} fontSize="sm" fontWeight="700">
                          {formatPrizeCount(item, item.remainingCount)}
                        </Text>
                      </Td>
                      <Td borderColor={borderColor}>
                        <Flex gap="10px" wrap="wrap">
                          <Button
                            variant="lightBrand"
                            size="sm"
                            minW="108px"
                            h="38px"
                            leftIcon={<Icon as={MdEdit} boxSize="16px" />}
                            fontSize="sm"
                            fontWeight="700"
                            onClick={() => handleOpenEditModal(item)}
                          >
                            Изменить
                          </Button>
                          <Button
                            variant="outline"
                            colorScheme="red"
                            size="sm"
                            minW="108px"
                            h="38px"
                            leftIcon={<Icon as={MdDelete} boxSize="16px" />}
                            fontSize="sm"
                            fontWeight="700"
                            isLoading={deletingPrizeId === item.id}
                            loadingText="Удаляем"
                            onClick={() => void handleDeletePrize(item)}
                          >
                            Удалить
                          </Button>
                        </Flex>
                      </Td>
                    </Tr>
                  )) : (
                    <Tr>
                      <Td borderColor={borderColor} colSpan={8}>
                        <Text color={textColorSecondary} fontSize="sm" py="12px" textAlign="center">
                          Призов пока нет.
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

      <Modal isOpen={choosePrizeTypeModal.isOpen} onClose={choosePrizeTypeModal.onClose} isCentered>
        <ModalOverlay bg="rgba(15, 23, 42, 0.45)" />
        <ModalContent bg={modalBg} borderRadius="28px" p="8px" maxW={{ base: "92vw", md: "720px" }} border="1px solid" borderColor={tableCardBorder}>
          <ModalHeader color={textColor} fontSize="2xl" fontWeight="700" textAlign="center" pt="20px">
            Что добавляем?
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody pb="28px">
            <SimpleGrid columns={{ base: 1, md: 2 }} spacing="16px">
              <Button
                variant="brand"
                h="96px"
                borderRadius="28px"
                fontSize={{ base: "2xl", md: "3xl" }}
                fontWeight="700"
                onClick={() => handleSelectPrizeType("Не приз")}
              >
                не приз
              </Button>
              <Button
                variant="brand"
                h="96px"
                borderRadius="28px"
                fontSize={{ base: "2xl", md: "3xl" }}
                fontWeight="700"
                onClick={() => handleSelectPrizeType("Приз")}
              >
                приз
              </Button>
            </SimpleGrid>
          </ModalBody>
        </ModalContent>
      </Modal>

      <Modal isOpen={createPrizeModal.isOpen} onClose={createPrizeModal.onClose} isCentered size="4xl" scrollBehavior="inside">
        <ModalOverlay bg="rgba(15, 23, 42, 0.45)" />
        <ModalContent bg={modalBg} borderRadius="24px" p="4px" maxW={{ base: "94vw", xl: "960px" }} border="1px solid" borderColor={tableCardBorder}>
          <ModalHeader color={textColor} fontSize="xl" fontWeight="700">
            {editingPrizeId ? "Изменить приз" : "Добавить приз"}
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody pb="24px">
            <Stack spacing="18px">
              <FormSection title="Основное" description="Базовые параметры позиции для призовой механики.">
                <Stack spacing="16px">
                  <FormControl>
                    <FormLabel color={textColor} fontSize="sm" fontWeight="700">
                      Имя позиции
                    </FormLabel>
                    <Input
                      h="52px"
                      borderRadius="16px"
                      value={form.title}
                      onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                      placeholder="Например: Скидка 300 ₽ на авиа"
                    />
                  </FormControl>

                  <SimpleGrid columns={{ base: 1, md: 2 }} spacing="16px">
                    <FormControl>
                      <FormLabel color={textColor} fontSize="sm" fontWeight="700">
                        Категория
                      </FormLabel>
                      <Select
                        h="52px"
                        borderRadius="16px"
                        value={form.category}
                        onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
                      >
                        <option value="">Без категории</option>
                        {PRIZE_CATEGORY_OPTIONS.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </Select>
                    </FormControl>

                    <FormControl>
                      <FormLabel color={textColor} fontSize="sm" fontWeight="700">
                        Тип промокода
                      </FormLabel>
                      <Select
                        h="52px"
                        borderRadius="16px"
                        value={form.promoCodeType}
                        onChange={(event) => setForm((current) => ({ ...current, promoCodeType: event.target.value }))}
                      >
                        {PROMO_CODE_TYPE_OPTIONS.map((option) => (
                          <option key={option.value || "empty"} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </FormControl>
                  </SimpleGrid>
                </Stack>
              </FormSection>

              <FormSection title="Приз И Лимиты" description="Здесь выбирается сценарий с ограниченным количеством или безлимитная выдача.">
                <Stack spacing="16px">
                  <FormControl>
                    <FormLabel color={textColor} fontSize="sm" fontWeight="700">
                      Есть ли ограничение призов
                    </FormLabel>
                    <ToggleButtonGroup
                      value={form.hasPrizeLimit}
                      onChange={(nextValue) => setForm((current) => ({
                        ...current,
                        hasPrizeLimit: nextValue,
                        totalCount: nextValue ? current.totalCount : "",
                      }))}
                    />
                  </FormControl>

                  {form.hasPrizeLimit ? (
                    <>
                      <FormControl>
                        <FormLabel color={textColor} fontSize="sm" fontWeight="700">
                          Промокоды
                        </FormLabel>
                        <Input
                          ref={promoCodesInputRef}
                          type="file"
                          accept=".txt,.csv,.xls,.xlsx"
                          display="none"
                          onChange={(event) => void handlePromoCodesFileChange(event.target.files)}
                        />
                        <Flex direction={{ base: "column", md: "row" }} gap="12px" align={{ base: "stretch", md: "center" }}>
                          <Button type="button" variant="brand" h="48px" onClick={() => promoCodesInputRef.current?.click()}>
                            Загрузить
                          </Button>
                          {form.promoCodesFile?.name ? (
                            <Text color={textColorSecondary} fontSize="sm">
                              {form.promoCodesFile.name}
                              {form.promoCodes.length > 0 ? `, кодов: ${form.promoCodes.length}` : ""}
                            </Text>
                          ) : (
                            <Text color={textColorSecondary} fontSize="sm">
                              Можно загрузить список кодов файлом.
                            </Text>
                          )}
                        </Flex>
                        {promoCodesUploadError ? (
                          <Text color="red.400" fontSize="xs" mt="8px">
                            {promoCodesUploadError}
                          </Text>
                        ) : null}
                      </FormControl>

                      <FormControl>
                        <FormLabel color={textColor} fontSize="sm" fontWeight="700">
                          Всего призов
                        </FormLabel>
                        <Input
                          h="52px"
                          borderRadius="16px"
                          type="number"
                          min="1"
                          value={form.totalCount}
                          onChange={(event) => setForm((current) => ({ ...current, totalCount: event.target.value }))}
                          placeholder="Например: 1000"
                        />
                      </FormControl>
                    </>
                  ) : (
                    <FormControl>
                      <FormLabel color={textColor} fontSize="sm" fontWeight="700">
                        Промокод
                      </FormLabel>
                      <Input
                        h="52px"
                        borderRadius="16px"
                        value={form.promoCodeValue}
                        onChange={(event) => setForm((current) => ({ ...current, promoCodeValue: event.target.value }))}
                        placeholder="Введите текст промокода"
                      />
                    </FormControl>
                  )}

                  <FormControl>
                    <FormLabel color={textColor} fontSize="sm" fontWeight="700">
                      Шанс
                    </FormLabel>
                    <Input
                      h="52px"
                      borderRadius="16px"
                      value={form.chanceValue}
                      onChange={(event) => setForm((current) => ({ ...current, chanceValue: event.target.value }))}
                      placeholder="Например: 1x"
                    />
                  </FormControl>
                </Stack>
              </FormSection>

              <FormSection title="Ограничения И Период" description="Лимит на одного пользователя и временное окно действия позиции.">
                <Stack spacing="16px">
                  <FormControl>
                    <FormLabel color={textColor} fontSize="sm" fontWeight="700">
                      Есть ли ограничение призов на 1 пользователя
                    </FormLabel>
                    <ToggleButtonGroup
                      value={form.hasUserLimit}
                      onChange={(nextValue) => setForm((current) => ({
                        ...current,
                        hasUserLimit: nextValue,
                        userLimitCount: nextValue ? current.userLimitCount : "",
                      }))}
                    />
                  </FormControl>

                  {form.hasUserLimit ? (
                    <FormControl>
                      <FormLabel color={textColor} fontSize="sm" fontWeight="700">
                        Кол-во в период
                      </FormLabel>
                      <Input
                        h="52px"
                        borderRadius="16px"
                        type="number"
                        min="1"
                        value={form.userLimitCount}
                        onChange={(event) => setForm((current) => ({ ...current, userLimitCount: event.target.value }))}
                        placeholder="Например: 1"
                      />
                    </FormControl>
                  ) : null}

                  <SimpleGrid columns={{ base: 1, md: 2 }} spacing="16px">
                    <FormControl>
                      <FormLabel color={textColor} fontSize="sm" fontWeight="700">
                        Период розыгрыша: от
                      </FormLabel>
                      <Input
                        h="52px"
                        borderRadius="16px"
                        type="date"
                        value={form.activeFrom}
                        onChange={(event) => setForm((current) => ({ ...current, activeFrom: event.target.value }))}
                      />
                    </FormControl>

                    <FormControl>
                      <FormLabel color={textColor} fontSize="sm" fontWeight="700">
                        Период розыгрыша: до
                      </FormLabel>
                      <Input
                        h="52px"
                        borderRadius="16px"
                        type="date"
                        value={form.activeTo}
                        onChange={(event) => setForm((current) => ({ ...current, activeTo: event.target.value }))}
                      />
                    </FormControl>
                  </SimpleGrid>
                </Stack>
              </FormSection>

              <FormSection title="Контент Для Интерфейса" description="Картинка и тексты, которые будут использоваться на клиенте.">
                <Stack spacing="16px">
                  <FormControl>
                    <FormLabel color={textColor} fontSize="sm" fontWeight="700">
                      Изображение чемодана для рулетки
                    </FormLabel>
                    <ImageUploader
                      value={form.rouletteImage}
                      onChange={(nextValue) => setForm((current) => ({ ...current, rouletteImage: nextValue }))}
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel color={textColor} fontSize="sm" fontWeight="700">
                      Текст для Мои призы
                    </FormLabel>
                    <Input
                      h="52px"
                      borderRadius="16px"
                      value={form.myPrizeText}
                      onChange={(event) => setForm((current) => ({ ...current, myPrizeText: event.target.value }))}
                      placeholder="Например: Скидка 800 ₽"
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel color={textColor} fontSize="sm" fontWeight="700">
                      Текстовое описание для рулетки
                    </FormLabel>
                    <Textarea
                      minH="180px"
                      borderRadius="20px"
                      resize="vertical"
                      value={form.rouletteDescription}
                      onChange={(event) => setForm((current) => ({ ...current, rouletteDescription: event.target.value }))}
                      placeholder="Описание приза для интерфейса рулетки"
                    />
                  </FormControl>
                </Stack>
              </FormSection>

              <Flex justify="flex-end" gap="12px" wrap="wrap">
                <Button variant="light" h="52px" px="24px" onClick={createPrizeModal.onClose}>
                  Отмена
                </Button>
                <Button
                  variant="brand"
                  h="52px"
                  px="24px"
                  fontWeight="700"
                  isLoading={creating}
                  loadingText="Сохраняем"
                  onClick={handleCreatePrize}
                >
                  {editingPrizeId ? "Сохранить изменения" : "Добавить приз"}
                </Button>
              </Flex>
            </Stack>
          </ModalBody>
        </ModalContent>
      </Modal>

      <Modal isOpen={nonPrizeModal.isOpen} onClose={nonPrizeModal.onClose} isCentered size="2xl" scrollBehavior="inside">
        <ModalOverlay bg="rgba(15, 23, 42, 0.45)" />
        <ModalContent bg={modalBg} borderRadius="24px" p="4px" maxW={{ base: "94vw", xl: "760px" }} border="1px solid" borderColor={tableCardBorder}>
          <ModalHeader color={textColor} fontSize="xl" fontWeight="700">
            {editingPrizeId ? "Изменить не приз" : "Добавить не приз"}
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody pb="24px">
            <FormSection title="Не Приз" description="Упрощённая форма для технической или пустой позиции без категории и промокода.">
              <Stack spacing="16px">
                <FormControl>
                  <FormLabel color={textColor} fontSize="sm" fontWeight="700">
                    Имя позиции
                  </FormLabel>
                  <Input
                    h="52px"
                    borderRadius="16px"
                    value={form.title}
                    onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                    placeholder="Например: Пустой слот"
                  />
                </FormControl>

                <FormControl>
                  <FormLabel color={textColor} fontSize="sm" fontWeight="700">
                    Шанс
                  </FormLabel>
                  <Input
                    h="52px"
                    borderRadius="16px"
                    value={form.chanceValue}
                    onChange={(event) => setForm((current) => ({ ...current, chanceValue: event.target.value }))}
                    placeholder="Например: 1x"
                  />
                </FormControl>

                <SimpleGrid columns={{ base: 1, md: 2 }} spacing="16px">
                  <FormControl>
                    <FormLabel color={textColor} fontSize="sm" fontWeight="700">
                      Период розыгрыша: от
                    </FormLabel>
                    <Input
                      h="52px"
                      borderRadius="16px"
                      type="date"
                      value={form.activeFrom}
                      onChange={(event) => setForm((current) => ({ ...current, activeFrom: event.target.value }))}
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel color={textColor} fontSize="sm" fontWeight="700">
                      Период розыгрыша: до
                    </FormLabel>
                    <Input
                      h="52px"
                      borderRadius="16px"
                      type="date"
                      value={form.activeTo}
                      onChange={(event) => setForm((current) => ({ ...current, activeTo: event.target.value }))}
                    />
                  </FormControl>
                </SimpleGrid>

                <FormControl>
                  <FormLabel color={textColor} fontSize="sm" fontWeight="700">
                    Изображение чемодана для рулетки
                  </FormLabel>
                  <ImageUploader
                    value={form.rouletteImage}
                    onChange={(nextValue) => setForm((current) => ({ ...current, rouletteImage: nextValue }))}
                  />
                </FormControl>

                <FormControl>
                  <FormLabel color={textColor} fontSize="sm" fontWeight="700">
                    Текстовое описание
                  </FormLabel>
                  <Textarea
                    minH="220px"
                    borderRadius="20px"
                    resize="vertical"
                    value={form.rouletteDescription}
                    onChange={(event) => setForm((current) => ({ ...current, rouletteDescription: event.target.value }))}
                    placeholder="Описание позиции"
                  />
                </FormControl>

                <Flex justify="flex-end" gap="12px" wrap="wrap">
                  <Button variant="light" h="52px" px="24px" onClick={nonPrizeModal.onClose}>
                    Отмена
                  </Button>
                  <Button
                    variant="brand"
                    h="52px"
                    px="24px"
                    fontWeight="700"
                    isLoading={creating}
                    loadingText="Сохраняем"
                    onClick={handleCreatePrize}
                  >
                    {editingPrizeId ? "Сохранить изменения" : "Добавить"}
                  </Button>
                </Flex>
              </Stack>
            </FormSection>
          </ModalBody>
        </ModalContent>
      </Modal>
    </Box>
  );
}
