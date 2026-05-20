import {
  Box,
  Button,
  Flex,
  Text,
  useColorModeValue,
} from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeUrl(rawValue) {
  if (!rawValue) {
    return null;
  }

  try {
    const url = new URL(String(rawValue).trim(), window.location.origin);

    if (!/^https?:$/.test(url.protocol)) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

const EMPTY_TOOLBAR_STATE = {
  bold: false,
  italic: false,
  underline: false,
  unorderedList: false,
  orderedList: false,
  block: "p",
};

function ToolbarButton({
  active = false,
  children,
  onClick,
  title,
}) {
  const activeBg = useColorModeValue("rgba(66, 42, 251, 0.12)", "rgba(255, 255, 255, 0.12)");
  const activeColor = useColorModeValue("brand.500", "white");
  const idleBg = useColorModeValue("secondaryGray.300", "rgba(255, 255, 255, 0.04)");
  const idleColor = useColorModeValue("secondaryGray.700", "secondaryGray.400");
  const hoverBg = useColorModeValue("secondaryGray.400", "rgba(255, 255, 255, 0.08)");

  return (
    <Button
      type="button"
      size="sm"
      minW="40px"
      h="36px"
      px="10px"
      borderRadius="12px"
      bg={active ? activeBg : idleBg}
      color={active ? activeColor : idleColor}
      fontWeight="700"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      title={title}
      _hover={{ bg: active ? activeBg : hoverBg }}
    >
      {children}
    </Button>
  );
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder = "Начните вводить текст…",
}) {
  const editorRef = useRef(null);
  const [toolbarState, setToolbarState] = useState(EMPTY_TOOLBAR_STATE);

  const borderColor = useColorModeValue("gray.200", "whiteAlpha.100");
  const areaBg = useColorModeValue("white", "navy.800");
  const toolbarBg = useColorModeValue("secondaryGray.300", "rgba(255, 255, 255, 0.03)");
  const toolbarBorder = useColorModeValue("rgba(224, 229, 242, 0.9)", "rgba(255, 255, 255, 0.08)");
  const placeholderColor = useColorModeValue("secondaryGray.500", "secondaryGray.400");
  const textColor = useColorModeValue("navy.700", "white");

  useEffect(() => {
    if (!editorRef.current) {
      return;
    }

    const nextHtml = String(value || "");

    if (editorRef.current.innerHTML !== nextHtml) {
      editorRef.current.innerHTML = nextHtml;
    }
  }, [value]);

  useEffect(() => {
    function refreshToolbar() {
      try {
        const selection = window.getSelection();
        const node = selection?.anchorNode || null;
        const element = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        const block = element?.closest?.("h1,h2,h3,p,div,li");

        setToolbarState({
          bold: document.queryCommandState("bold"),
          italic: document.queryCommandState("italic"),
          underline: document.queryCommandState("underline"),
          unorderedList: document.queryCommandState("insertUnorderedList"),
          orderedList: document.queryCommandState("insertOrderedList"),
          block: block?.tagName?.toLowerCase?.() || "p",
        });
      } catch {
        setToolbarState(EMPTY_TOOLBAR_STATE);
      }
    }

    document.addEventListener("selectionchange", refreshToolbar);

    return () => {
      document.removeEventListener("selectionchange", refreshToolbar);
    };
  }, []);

  function emitValue() {
    onChange?.((editorRef.current?.innerHTML || "").trim());
  }

  function exec(command, commandValue) {
    document.execCommand(command, false, commandValue);
    emitValue();
  }

  function handlePaste(event) {
    const text = event.clipboardData?.getData("text/plain") || "";
    document.execCommand("insertText", false, text);
    emitValue();
  }

  function handleBlur() {
    if (!editorRef.current) {
      return;
    }

    const normalizedHtml = editorRef.current.innerHTML
      .replace(/<div><br><\/div>/g, "<p><br></p>")
      .replace(/<div>/g, "<p>")
      .replace(/<\/div>/g, "</p>")
      .trim();

    if (normalizedHtml !== editorRef.current.innerHTML) {
      editorRef.current.innerHTML = normalizedHtml;
    }

    onChange?.(normalizedHtml);
  }

  function applyParagraph() {
    document.execCommand("formatBlock", false, "p");
    emitValue();
  }

  function addLink() {
    const selection = window.getSelection();
    const isCollapsed = !selection || selection.isCollapsed;
    const rawUrl = window.prompt("Вставьте ссылку (https://…)", "https://");
    const href = normalizeUrl(rawUrl);

    if (!href) {
      return;
    }

    if (isCollapsed) {
      const linkText = window.prompt("Текст ссылки", href) || href;
      document.execCommand(
        "insertHTML",
        false,
        `<a href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(linkText)}</a>`,
      );
    } else {
      document.execCommand("createLink", false, href);

      setTimeout(() => {
        editorRef.current?.querySelectorAll("a[href]").forEach((node) => {
          node.setAttribute("target", "_blank");
          node.setAttribute("rel", "noopener noreferrer");
        });
      }, 0);
    }

    emitValue();
  }

  function clearFormatting() {
    document.execCommand("removeFormat");
    emitValue();
  }

  return (
    <Box>
      <Flex
        wrap="wrap"
        gap="8px"
        p="12px"
        border="1px solid"
        borderColor={toolbarBorder}
        borderRadius="18px 18px 0 0"
        bg={toolbarBg}
      >
        <ToolbarButton
          active={toolbarState.bold}
          onClick={() => exec("bold")}
          title="Жирный"
        >
          B
        </ToolbarButton>
        <ToolbarButton
          active={toolbarState.italic}
          onClick={() => exec("italic")}
          title="Курсив"
        >
          I
        </ToolbarButton>
        <ToolbarButton
          active={toolbarState.underline}
          onClick={() => exec("underline")}
          title="Подчёркнутый"
        >
          U
        </ToolbarButton>
        <ToolbarButton
          active={toolbarState.unorderedList}
          onClick={() => exec("insertUnorderedList")}
          title="Маркированный список"
        >
          •
        </ToolbarButton>
        <ToolbarButton
          active={toolbarState.orderedList}
          onClick={() => exec("insertOrderedList")}
          title="Нумерованный список"
        >
          1.
        </ToolbarButton>
        <ToolbarButton
          active={toolbarState.block === "p" || toolbarState.block === "div"}
          onClick={applyParagraph}
          title="Обычный текст"
        >
          Текст
        </ToolbarButton>
        <ToolbarButton
          onClick={addLink}
          title="Добавить ссылку"
        >
          Link
        </ToolbarButton>
        <ToolbarButton
          onClick={() => exec("unlink")}
          title="Удалить ссылку"
        >
          Unlink
        </ToolbarButton>
        <ToolbarButton
          onClick={clearFormatting}
          title="Очистить форматирование"
        >
          Clear
        </ToolbarButton>
      </Flex>

      <Box
        position="relative"
        border="1px solid"
        borderTop="0"
        borderColor={borderColor}
        borderRadius="0 0 18px 18px"
        bg={areaBg}
        minH="220px"
      >
        {!String(value || "").trim() ? (
          <Text
            position="absolute"
            top="18px"
            left="20px"
            color={placeholderColor}
            fontSize="sm"
            pointerEvents="none"
          >
            {placeholder}
          </Text>
        ) : null}

        <Box
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          minH="220px"
          p="18px 20px"
          color={textColor}
          fontSize="sm"
          lineHeight="1.7"
          whiteSpace="pre-wrap"
          outline="none"
          onInput={emitValue}
          onBlur={handleBlur}
          onPaste={handlePaste}
          sx={{
            "& p": {
              margin: 0,
              minHeight: "1.5em",
            },
            "& ul, & ol": {
              paddingLeft: "20px",
              margin: 0,
            },
            "& a": {
              color: "var(--chakra-colors-brand-500)",
              textDecoration: "underline",
            },
          }}
        />
      </Box>
    </Box>
  );
}
