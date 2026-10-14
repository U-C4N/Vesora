"""Validate serializable presentation options; formatting stays in the shared engine."""
from __future__ import annotations

import copy
import math
import re
from typing import Any

from ._timezones import TIME_ZONES


PRESENTATION_PROTOCOL_VERSION = 5
QUALITY_PROTOCOL_VERSION = 6
FONT_SIZE_TOKENS = {"titleFontSize", "labelFontSize", "tickFontSize", "legendFontSize"}
LIGHT_THEME = {
    "background": "#ffffff", "foreground": "#334155", "muted": "#475569",
    "grid": "#e2e8f0", "axis": "#cbd5e1", "tooltipBackground": "#0f172a",
    "tooltipForeground": "#ffffff", "selection": "#ea580c", "error": "#b91c1c",
    "fontFamily": "system-ui, sans-serif", "fontSize": 12,
    "palette": ["#38bdf8", "#6366f1", "#10b981", "#f59e0b", "#ec4899"],
}
DARK_THEME = {
    **LIGHT_THEME, "background": "#0f172a", "foreground": "#e2e8f0",
    "muted": "#94a3b8", "grid": "#334155", "axis": "#475569",
    "tooltipBackground": "#e2e8f0", "tooltipForeground": "#0f172a",
    "selection": "#fb923c", "error": "#f87171",
}
_COLORS = {
    "blue": "#3b82f6", "red": "#ef4444", "green": "#22c55e",
    "orange": "#f97316", "purple": "#a855f7", "black": "#000000",
    "white": "#ffffff", "cyan": "#06b6d4", "yellow": "#eab308",
}
_COLOR_KEYS = set(LIGHT_THEME) - {"fontFamily", "fontSize", "palette"}


def _color(value: Any) -> str:
    if not isinstance(value, str):
        raise TypeError("Theme colors must be strings")
    color = _COLORS.get(value.lower(), value.lower())
    if re.fullmatch(r"#[0-9a-f]{3}", color):
        color = "#" + "".join(char * 2 for char in color[1:])
    if not re.fullmatch(r"#[0-9a-f]{6}", color):
        raise ValueError("Colors must be #RGB, #RRGGBB or a supported named color")
    return color


def resolve_theme(value: Any) -> dict[str, Any]:
    """Resolve a preset or partial token dictionary without retaining caller storage."""
    if isinstance(value, str):
        if value not in ("light", "dark"):
            raise ValueError("Theme must be 'light', 'dark' or theme tokens")
        return copy.deepcopy(DARK_THEME if value == "dark" else LIGHT_THEME)
    if not isinstance(value, dict):
        raise TypeError("Theme tokens must be an object")
    unknown = value.keys() - LIGHT_THEME.keys() - FONT_SIZE_TOKENS
    if unknown:
        raise TypeError(f"Unknown theme token(s): {', '.join(sorted(unknown))}")
    theme = {**copy.deepcopy(LIGHT_THEME), **copy.deepcopy(value)}
    for key in _COLOR_KEYS:
        theme[key] = _color(theme[key])
    family = theme["fontFamily"]
    if not isinstance(family, str) or not family.strip() or len(family) > 200 or re.search(r"[\x00-\x1f\x7f]", family):
        raise ValueError("Theme fontFamily must be nonempty text of at most 200 characters")
    for name in {"fontSize"} | (FONT_SIZE_TOKENS & theme.keys()):
        size = theme[name]
        if isinstance(size, bool) or not isinstance(size, (int, float)) or not math.isfinite(size) or not 8 <= size <= 32:
            raise ValueError(f"Theme {name} must be between 8 and 32")
    palette = theme["palette"]
    if not isinstance(palette, list) or not 1 <= len(palette) <= 32:
        raise ValueError("Theme palette must contain 1 to 32 colors")
    theme["palette"] = [_color(color) for color in palette]
    return theme


_NUMERIC_ENUMS = {
    "localeMatcher": {"lookup", "best fit"},
    "notation": {"standard", "scientific", "engineering", "compact"},
    "compactDisplay": {"short", "long"},
    "signDisplay": {"auto", "never", "always", "exceptZero", "negative"},
    "currencyDisplay": {"symbol", "narrowSymbol", "code", "name"},
    "currencySign": {"standard", "accounting"},
}
_DATE_ENUMS = {
    "weekday": {"long", "short", "narrow"}, "era": {"long", "short", "narrow"},
    "year": {"numeric", "2-digit"}, "month": {"numeric", "2-digit", "long", "short", "narrow"},
    **{name: {"numeric", "2-digit"} for name in ("day", "hour", "minute", "second")},
    "hourCycle": {"h11", "h12", "h23", "h24"},
    "dateStyle": {"full", "long", "medium", "short"},
    "timeStyle": {"full", "long", "medium", "short"},
    "formatMatcher": {"basic", "best fit"}, "localeMatcher": {"lookup", "best fit"},
    "timeZoneName": {"long", "short", "longOffset", "shortOffset", "longGeneric", "shortGeneric"},
}
_DIGITS = {
    "minimumIntegerDigits": (1, 21), "minimumFractionDigits": (0, 20),
    "maximumFractionDigits": (0, 20), "minimumSignificantDigits": (1, 21),
    "maximumSignificantDigits": (1, 21),
}
_LOCALE = re.compile(
    r"^(?:[A-Za-z]{2,3}|[A-Za-z]{5,8})(?:-[A-Za-z]{4})?"
    r"(?:-(?:[A-Za-z]{2}|[0-9]{3}))?"
    r"(?P<variants>(?:-(?:[A-Za-z0-9]{5,8}|[0-9][A-Za-z0-9]{3}))*)"
    r"(?P<extensions>(?:-[0-9A-WY-Za-wy-z](?:-[A-Za-z0-9]{2,8})+)*)"
    r"(?:-[Xx](?:-[A-Za-z0-9]{1,8})+)?$"
)


def _locale(value: Any) -> None:
    if not isinstance(value, str):
        raise TypeError("Format locale must be a string")
    match = _LOCALE.fullmatch(value)
    if not match:
        raise ValueError("Format locale must be a well-formed BCP 47 language tag")
    variants = match["variants"].lower().split("-")[1:]
    singletons = re.findall(r"-([0-9a-wy-z])(?:-[a-z0-9]{2,8})+", match["extensions"].lower())
    if len(variants) != len(set(variants)) or len(singletons) != len(set(singletons)):
        raise ValueError("Format locale must not repeat variants or extension singletons")


def axis_format(value: Any) -> dict[str, Any]:
    """Copy a JSON-safe Intl subset and reject invalid options before committing a scene."""
    if not isinstance(value, dict) or value.get("kind") not in ("number", "currency", "percent", "date"):
        raise ValueError("Invalid axis format kind")
    kind = value["kind"]
    allowed = {"kind", "locale", "options"} | ({"currency"} if kind == "currency" else {"timeZone"} if kind == "date" else set())
    unknown = value.keys() - allowed
    if unknown:
        raise TypeError(f"Unknown axis format field(s): {', '.join(sorted(unknown))}")
    result = copy.deepcopy(value)
    if "locale" in result:
        _locale(result["locale"])
    if kind == "currency":
        currency = result.get("currency")
        if not isinstance(currency, str) or not re.fullmatch(r"[A-Za-z]{3}", currency):
            raise ValueError("Currency must be a three-letter code")
        result["currency"] = currency.upper()
    if "timeZone" in result:
        zone = result["timeZone"]
        if not isinstance(zone, str) or zone.casefold() not in TIME_ZONES:
            raise ValueError("Time zone must be UTC or a recognized IANA name")
    if "options" not in result:
        return result
    options = result["options"]
    if not isinstance(options, dict):
        raise TypeError("Format options must be an object")
    enums = _DATE_ENUMS if kind == "date" else _NUMERIC_ENUMS
    digits = {"fractionalSecondDigits": (1, 3)} if kind == "date" else _DIGITS
    extra = {"hour12", "calendar", "numberingSystem"} if kind == "date" else {"useGrouping"}
    if options.keys() - enums.keys() - digits.keys() - extra:
        raise TypeError("Invalid format option")
    for name, option in options.items():
        if name in enums:
            if not isinstance(option, str) or option not in enums[name]:
                raise ValueError(f"Invalid format option: {name}")
        elif name in digits:
            low, high = digits[name]
            if isinstance(option, bool) or not isinstance(option, (int, float)) or not math.isfinite(option) or int(option) != option or not low <= option <= high:
                raise ValueError(f"Invalid format option: {name}")
        elif name == "hour12":
            if not isinstance(option, bool):
                raise TypeError("hour12 must be a boolean")
        elif name == "useGrouping":
            if not isinstance(option, bool) and (not isinstance(option, str) or option not in {"auto", "always", "min2"}):
                raise ValueError("Invalid format option: useGrouping")
        elif not isinstance(option, str) or len(option) > 32 or not re.fullmatch(r"[A-Za-z0-9]{3,8}(?:-[A-Za-z0-9]{3,8})*", option):
            raise ValueError(f"Invalid format option: {name}")
    if kind == "date":
        components = {"weekday", "era", "year", "month", "day", "hour", "minute", "second", "fractionalSecondDigits", "timeZoneName"}
        if {"dateStyle", "timeStyle"}.intersection(options) and components.intersection(options):
            raise ValueError("Date/time styles cannot be combined with individual date components")
    else:
        for unit in ("Fraction", "Significant"):
            minimum, maximum = f"minimum{unit}Digits", f"maximum{unit}Digits"
            if minimum in options and maximum in options and options[minimum] > options[maximum]:
                raise ValueError(f"{minimum} must not exceed {maximum}")
    return result
