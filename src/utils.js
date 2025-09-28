/**
 * Extract QB app base URL from current page or provided URL
 * @param {string} [targetUrl] - Optional URL to parse, defaults to window.location.href
 * @returns {string} - The QB app base URL
 */
export function getQbAppBaseUrl(targetUrl = null) {
    // If no URL provided, try to use current page URL (browser only)
    if (!targetUrl) {
        if (typeof window !== 'undefined') {
            targetUrl = window.location.href;
        } else {
            throw new Error('No URL provided, function cannot be used outside browser context');
        }
    }

    const urlObj = new URL(targetUrl);
    const realm = urlObj.hostname.split('.')[0];

    // Extract app ID from path - handles both legacy and new URL formats
    let appId = null;

    // Legacy format: /db/__XX__
    const legacyMatch = urlObj.pathname.match(/\/db\/([a-z0-9]+)/);
    if (legacyMatch) {
        appId = legacyMatch[1];
    } else {
        const newMatch = urlObj.pathname.match(/\/nav\/app\/([a-z0-9]+)/);
        if (newMatch) {
            appId = newMatch[1];
        }
    }
    
    if (!appId) {
        throw new Error('App ID not found in URL');
    }

    return `https://${realm}.quickbase.com/nav/app/${appId}/`;
}

/**
 * Convert object to URL query parameters
 * @param {Object} paramObject - Object with key-value pairs
 * @returns {string} - URL query string starting with ?
 */
export function parameterize(paramObject) {
    return "?" + Object.keys(paramObject).map(key => key + '=' + paramObject[key]).join('&');
}

/**
 * Normalize field values to QB API format
 * @param {Object} fields - Fields object with values
 * @returns {Object} - Normalized fields with {value: ...} format
 */
export function normalizeQbFields(fields) {
    const normalized = {};
    Object.keys(fields).forEach(fieldId => {
        const value = fields[fieldId];
        // If already in QB format {value: ...}, keep as-is
        if (value && typeof value === 'object' && 'value' in value) {
            normalized[fieldId] = value;
        } else {
            // Convert simple value to QB format
            normalized[fieldId] = { value: value };
        }
    });
    return normalized;
}