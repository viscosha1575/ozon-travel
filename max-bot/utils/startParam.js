function normalizeReferralCode(value) {
  const normalized = String(value || "").trim().toUpperCase();

  if (!normalized) {
    return "";
  }

  if (!/^OZONTRAVEL-[A-Z0-9_-]+$/.test(normalized)) {
    return "";
  }

  return normalized;
}

function normalizeUtmSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function parseFlatSegments(value) {
  const segments = String(value || "")
    .trim()
    .split(/__+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  let referralCode = "";
  let utmSlug = "";

  for (const segment of segments) {
    if (!referralCode && /^ref_/i.test(segment)) {
      referralCode = normalizeReferralCode(segment.slice(4));
      continue;
    }

    if (!utmSlug && /^utm_/i.test(segment)) {
      utmSlug = normalizeUtmSlug(segment.slice(4));
    }
  }

  return {
    referralCode,
    utmSlug,
  };
}

function parsePairs(candidate) {
  const normalized = String(candidate || "")
    .trim()
    .replace(/^[?#]/, "")
    .replace(/[|;,]+/g, "&");

  if (!normalized) {
    return {
      referralCode: "",
      utmSlug: "",
    };
  }

  const params = new URLSearchParams(normalized);
  const referralCode = normalizeReferralCode(
    params.get("ref")
    || params.get("referral")
    || params.get("referralCode")
    || params.get("code")
    || "",
  );
  const utmSlug = normalizeUtmSlug(
    params.get("utm")
    || params.get("utmSlug")
    || params.get("source")
    || "",
  );

  return {
    referralCode,
    utmSlug,
  };
}

export function parseStartParam(value) {
  const raw = String(value || "").trim();

  if (!raw) {
    return {
      raw: "",
      referralCode: "",
      utmSlug: "",
    };
  }

  const directReferralCode = normalizeReferralCode(raw);

  if (directReferralCode) {
    return {
      raw,
      referralCode: directReferralCode,
      utmSlug: "",
    };
  }

  const flatSegments = parseFlatSegments(raw);

  if (flatSegments.referralCode || flatSegments.utmSlug) {
    return {
      raw,
      referralCode: flatSegments.referralCode,
      utmSlug: flatSegments.utmSlug,
    };
  }

  const queryLike = parsePairs(raw);

  if (queryLike.referralCode || queryLike.utmSlug) {
    return {
      raw,
      referralCode: queryLike.referralCode,
      utmSlug: queryLike.utmSlug,
    };
  }

  return {
    raw,
    referralCode: "",
    utmSlug: normalizeUtmSlug(raw),
  };
}
