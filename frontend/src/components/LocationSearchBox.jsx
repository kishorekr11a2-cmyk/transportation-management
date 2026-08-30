import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    searchPlaces,
    normalizeLocation,
    isValidCoordinate,
    getCategoryIcon
} from "../services/locationSearchService";
import "../css/LocationSearchBox.css";

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 450;
const MAX_SUGGESTIONS = 8;

export default function LocationSearchBox({
    placeholder = "Search any location (e.g. Madurai, IIT Madras, Chennai Central, Taj Mahal, Times Square)...",
    selectedLocation = null,
    onSelectLocation,
    onClear,
    disabled = false,
    className = ""
}) {
    const [query, setQuery] = useState(
        selectedLocation?.name || selectedLocation?.displayName || ""
    );

    const [suggestions, setSuggestions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);
    const [highlightIndex, setHighlightIndex] = useState(-1);
    const [providerInfo, setProviderInfo] = useState("GLOBAL SEARCH");
    const [errorMessage, setErrorMessage] = useState("");
    const [emptyMessage, setEmptyMessage] = useState("");

    const inputRef = useRef(null);
    const dropdownRef = useRef(null);
    const debounceTimerRef = useRef(null);
    const abortControllerRef = useRef(null);
    const requestIdRef = useRef(0);

    /* Keep input text synchronized with external changes */
    useEffect(() => {
        if (selectedLocation) {
            const formatted = selectedLocation.name
                ? `${selectedLocation.name}${selectedLocation.address && selectedLocation.address !== selectedLocation.name ? ` (${selectedLocation.address.split(",")[0]})` : ""}`
                : selectedLocation.displayName || "";
            setQuery(formatted);
        } else {
            setQuery("");
            setSuggestions([]);
            setShowDropdown(false);
            setErrorMessage("");
            setEmptyMessage("");
        }
    }, [selectedLocation]);

    /* Cleanup on unmount */
    useEffect(() => {
        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        };
    }, []);

    /* Search execution */
    const performSearch = useCallback(async (searchText, requestId, signal) => {
        const cleanQuery = searchText.trim();

        if (
            cleanQuery.length < MIN_QUERY_LENGTH ||
            requestId !== requestIdRef.current ||
            signal.aborted
        ) {
            return;
        }

        try {
            setLoading(true);
            setErrorMessage("");
            setEmptyMessage("");

            const response = await searchPlaces(cleanQuery, signal);

            if (signal.aborted || requestId !== requestIdRef.current) {
                return;
            }

            const results = Array.isArray(response?.results)
                ? response.results
                : Array.isArray(response)
                ? response
                : [];

            setProviderInfo(response?.provider || "GLOBAL SEARCH");
            setSuggestions(results.slice(0, MAX_SUGGESTIONS));
            
            if (results.length === 0) {
                if (response?.hasError) {
                    setErrorMessage("Location search is temporarily unavailable. Please try again.");
                } else {
                    setEmptyMessage(response?.message || `No locations found for "${cleanQuery}". Try adding a city, district, or country.`);
                }
            }

            setShowDropdown(true);
            setHighlightIndex(-1);
        } catch (error) {
            if (error?.name === "AbortError" || error?.code === "ERR_CANCELED" || signal.aborted) {
                return;
            }
            console.error("[LocationSearchBox] Search error:", error);
            if (requestId === requestIdRef.current) {
                setSuggestions([]);
                setErrorMessage("Location search is temporarily unavailable. Please try again.");
                setShowDropdown(true);
            }
        } finally {
            if (requestId === requestIdRef.current && !signal.aborted) {
                setLoading(false);
            }
        }
    }, []);

    /* Handle typing */
    const handleChange = useCallback((event) => {
        const value = event.target.value;
        setQuery(value);

        requestIdRef.current += 1;
        const currentRequestId = requestIdRef.current;

        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }

        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
        }

        setHighlightIndex(-1);
        const cleanQuery = value.trim();

        if (cleanQuery.length < MIN_QUERY_LENGTH) {
            setSuggestions([]);
            setLoading(false);
            setShowDropdown(false);
            setErrorMessage("");
            setEmptyMessage("");
            return;
        }

        setLoading(true);
        setShowDropdown(true);

        debounceTimerRef.current = setTimeout(() => {
            if (currentRequestId !== requestIdRef.current) return;

            const controller = new AbortController();
            abortControllerRef.current = controller;
            performSearch(cleanQuery, currentRequestId, controller.signal);
        }, DEBOUNCE_MS);
    }, [performSearch]);

    /* Handle suggestion selection */
    const handleSelect = useCallback((place) => {
        if (!place) return;

        requestIdRef.current += 1;

        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
        }
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }

        setShowDropdown(false);
        setHighlightIndex(-1);

        try {
            const finalLocation = normalizeLocation(place);

            if (!finalLocation || !isValidCoordinate(finalLocation)) {
                setErrorMessage("This location does not have valid coordinates.");
                return;
            }

            setQuery(finalLocation.name || finalLocation.address || "");

            if (typeof onSelectLocation === "function") {
                onSelectLocation(finalLocation);
            }
        } catch (err) {
            console.error("Error finalizing selected location:", err);
            setErrorMessage("Failed to obtain location coordinates.");
        } finally {
            setLoading(false);
        }
    }, [onSelectLocation]);

    /* Handle clear button */
    const handleClear = useCallback(() => {
        requestIdRef.current += 1;

        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
        }
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }

        setQuery("");
        setSuggestions([]);
        setLoading(false);
        setShowDropdown(false);
        setHighlightIndex(-1);
        setErrorMessage("");
        setEmptyMessage("");

        if (typeof onClear === "function") {
            onClear();
        }

        if (inputRef.current) {
            inputRef.current.focus();
        }
    }, [onClear]);

    /* Keyboard navigation */
    const handleKeyDown = useCallback((event) => {
        if (!showDropdown || suggestions.length === 0) {
            if (event.key === "Escape") {
                setShowDropdown(false);
            }
            return;
        }

        if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlightIndex((curr) => (curr >= suggestions.length - 1 ? 0 : curr + 1));
            return;
        }

        if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlightIndex((curr) => (curr <= 0 ? suggestions.length - 1 : curr - 1));
            return;
        }

        if (event.key === "Enter") {
            event.preventDefault();
            const index = highlightIndex >= 0 ? highlightIndex : 0;
            const selected = suggestions[index];
            if (selected) {
                handleSelect(selected);
            }
            return;
        }

        if (event.key === "Escape") {
            event.preventDefault();
            setShowDropdown(false);
            setHighlightIndex(-1);
        }
    }, [showDropdown, suggestions, highlightIndex, handleSelect]);

    /* Close dropdown on click outside */
    useEffect(() => {
        const handleOutsideClick = (event) => {
            if (
                inputRef.current &&
                !inputRef.current.closest(".location-search-box")?.contains(event.target)
            ) {
                setShowDropdown(false);
            }
        };

        document.addEventListener("mousedown", handleOutsideClick);
        return () => {
            document.removeEventListener("mousedown", handleOutsideClick);
        };
    }, []);

    return (
        <div className={`location-search-box ${className}`}>
            <div className="location-search-input-wrapper">
                <span className="location-search-icon" aria-hidden="true">
                    🔍
                </span>

                <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    placeholder={placeholder}
                    disabled={disabled}
                    autoComplete="off"
                    spellCheck="false"
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    onFocus={() => {
                        if (suggestions.length > 0) {
                            setShowDropdown(true);
                        }
                    }}
                    className="location-search-input"
                />

                {loading && (
                    <span className="location-search-loading" title="Searching global locations...">
                        <span className="location-search-spinner" />
                    </span>
                )}

                {!loading && query.length > 0 && (
                    <button
                        type="button"
                        className="location-search-clear"
                        onClick={handleClear}
                        aria-label="Clear location search"
                    >
                        ×
                    </button>
                )}
            </div>

            {showDropdown && (
                <div className="location-search-dropdown" ref={dropdownRef}>
                    {/* Active Provider Tag */}
                    <div className="location-search-provider-bar">
                        <span className="provider-active">
                            🌐 {providerInfo.toUpperCase()}
                        </span>
                    </div>

                    {suggestions.length > 0 &&
                        suggestions.map((place, index) => {
                            const isHighlighted = index === highlightIndex;
                            const mainTitle = place.name || place.address?.split(",")[0] || "Location";
                            let secondary = place.address || place.displayName || "";
                            
                            // Strip leading title from address if present for neat display
                            if (secondary.toLowerCase().startsWith(mainTitle.toLowerCase())) {
                                secondary = secondary.substring(mainTitle.length).replace(/^[\s,]+/, "").trim();
                            }

                            return (
                                <button
                                    key={`${place.placeId || place.latitude || index}-${index}`}
                                    type="button"
                                    className={`location-search-result ${isHighlighted ? "highlighted" : ""}`}
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                    }}
                                    onClick={() => handleSelect(place)}
                                    onMouseEnter={() => setHighlightIndex(index)}
                                >
                                    <span className="location-result-icon">
                                        {getCategoryIcon(place)}
                                    </span>

                                    <span className="location-result-content">
                                        <span className="location-result-name">
                                            {mainTitle}
                                        </span>

                                        {secondary && (
                                            <span className="location-result-address">
                                                {secondary}
                                            </span>
                                        )}

                                        <div className="location-result-meta" style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "3px" }}>
                                            <span className="location-result-type">
                                                {place.type || "Place"}
                                            </span>
                                            {place.latitude !== undefined && place.longitude !== undefined && (
                                                <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                                                    📍 {Number(place.latitude).toFixed(5)}, {Number(place.longitude).toFixed(5)}
                                                </span>
                                            )}
                                        </div>
                                    </span>
                                </button>
                            );
                        })}

                    {!loading &&
                        query.trim().length >= MIN_QUERY_LENGTH &&
                        suggestions.length === 0 &&
                        emptyMessage && (
                            <div className="location-search-no-results">
                                <span className="no-results-icon">📍</span>
                                <p>
                                    No locations found for "<strong>{query.trim()}</strong>"
                                </p>
                                <small>Try adding a city, district, or country.</small>
                            </div>
                        )}

                    {errorMessage && (
                        <div className="location-search-error-banner">
                            {errorMessage}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}