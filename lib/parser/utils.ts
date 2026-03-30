import { execSync } from "child_process"
import { getRandomHeaders, getRandomUserAgent, rateLimitedDelay, withRetry, calculateDiscountPercent } from "./anti-blocking"
import { createPage, isBrowserRunning } from "./browser-manager"
import type { ProductData } from "./types"

/**
 * Normalize URL for caching (remove tracking params, sort query string)
 */
function normalizeUrlForCache(url: string): string {
    const urlObj = new URL(url)
    
    // Remove common tracking parameters
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'msclkid', '_ga', 'ref']
    trackingParams.forEach(param => urlObj.searchParams.delete(param))
    
    // Sort query parameters for consistency
    const params = new URLSearchParams([...urlObj.searchParams.entries()].sort())
    urlObj.search = params.toString()
    
    return urlObj.toString()
}

/**
 * In-memory cache for parsed products (URL -> ProductData)
 * Cache expires after 1 hour to avoid stale data
 */
const PARSE_CACHE = new Map<string, { data: ProductData; timestamp: number }>()
const CACHE_TTL_MS = 3600000 // 1 hour

export function getCachedParse(url: string): ProductData | null {
    const normalizedUrl = normalizeUrlForCache(url)
    const cached = PARSE_CACHE.get(normalizedUrl)
    if (!cached) return null
    
    const age = Date.now() - cached.timestamp
    if (age > CACHE_TTL_MS) {
        PARSE_CACHE.delete(url)
        return null
    }
    
    console.log(`[cache] 🎯 Cache HIT for ${url} (age: ${Math.round(age / 1000)}s)`)
    return cached.data
}

export function setCachedParse(url: string, data: ProductData): void {
    const normalizedUrl = normalizeUrlForCache(url)
    PARSE_CACHE.set(normalizedUrl, { data, timestamp: Date.now() })
    console.log(`[cache] 💾 Cached ${normalizedUrl}`)
}

export function clearParseCache(): void {
    PARSE_CACHE.clear()
    console.log(`[cache] 🗑️ Cache cleared`)
}

/**
 * Clean a price string and return a float.
 * Removes non-numeric characters, handles commas/dots as decimal separators.
 */
export function cleanPrice(priceStr: string): number {
    if (!priceStr) return 0

    // Remove non-breaking spaces and regular spaces
    let cleaned = priceStr.replace(/\u00a0/g, "").replace(/\s/g, "")

    // If comma is used as decimal separator (no dot present)
    if (cleaned.includes(",") && !cleaned.includes(".")) {
        cleaned = cleaned.replace(",", ".")
    }

    // Extract numeric part
    const match = cleaned.match(/(\d+(\.\d+)?)/)
    return match ? parseFloat(match[1]) : 0
}

// Re-export anti-blocking utilities
export { getRandomHeaders, getRandomUserAgent, calculateDiscountPercent }

/**
 * Clean whitespace from text.
 */
export function cleanText(text: string): string {
    if (!text) return ""
    return text.split(/\s+/).join(" ").trim()
}

/**
 * Fetch HTML content using Puppeteer (singleton browser instance)
 * Uses the singleton browser manager to avoid launching new browsers per request.
 * 
 * Current approach: Launches new browser per request (3-5s overhead)
 * Singleton approach: Reuses browser instance, new page per request (~100ms)
 */
export async function renderHtmlWithPuppeteer(url: string): Promise<string> {
    const domain = new URL(url).hostname
    let page
    
    try {
        // Get a new page from singleton browser (no browser launch needed)
        page = await createPage()
        
        // Set more realistic headers
        const randomHeaders = getRandomHeaders(url)
        await page.setUserAgent(randomHeaders["User-Agent"])
        await page.setExtraHTTPHeaders({
            "Accept-Language": randomHeaders["Accept-Language"],
            "Accept": randomHeaders["Accept"],
            "Accept-Encoding": randomHeaders["Accept-Encoding"],
            "DNT": "1",
        })

        // Small human-like delay before loading (not too long)
        await new Promise(r => setTimeout(r, Math.random() * 500 + 300))
        
        console.log(`[Puppeteer] Opening ${domain}...`)
        const startTime = Date.now()
        
        // Use networkidle2 for sites known to have async content loading
        // Otherwise use domcontentloaded for faster response
        const isAsyncHeavy = ["rozetka", "comfy", "megasport"].some(site => domain.includes(site))
        const waitUntil = isAsyncHeavy ? "networkidle2" : "domcontentloaded"
        
        await page.goto(url, { waitUntil, timeout: 25000 })
        
        let html = await page.content()
        const loadTime = Date.now() - startTime
        console.log(`[Puppeteer] ✅ Loaded ${domain} in ${loadTime}ms (${html.length} bytes)`)
        
        // Check for actual WAF blocks only (not just small size)
        const isBlocked = html.includes("Incapsula_Resource") || 
                         html.includes("Pardon Our Interruption") || 
                         html.includes("Just a moment") ||
                         html.includes("403") ||
                         html.includes("challenge") ||
                         (html.length < 500 && (html.includes("error") || html.includes("blocked")))
        
        if (isBlocked && !isAsyncHeavy) {
            console.log(`[Puppeteer] WAF Block detected for ${domain}. Retrying with networkidle2...`)
            // Reload with stronger wait
            await page.reload({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => {})
            html = await page.content()
            const retryTime = Date.now() - startTime
            console.log(`[Puppeteer] ✅ Retry succeeded in ${retryTime}ms`)
        }

        return html
    } catch (error: any) {
        console.error(`[Puppeteer] Error rendering ${domain}: ${error?.message || error}`)
        return `<!-- PUPPETEER_ERROR: ${error?.message} -->`
    } finally {
        // Page will auto-close after 5 minutes (managed by browser-manager)
        if (page) {
            try {
                await page.close()
            } catch (e) {
                // Page already closed, ignore
            }
        }
    }
}

export async function fetchHtml(url: string, usePuppeteer: boolean = false, attempt: number = 0): Promise<string> {
    if (usePuppeteer) {
        return await renderHtmlWithPuppeteer(url)
    }

    const randomHeaders = getRandomHeaders(url)
    const domain = new URL(url).hostname

    try {
        // Add dynamic delay based on attempt number
        await rateLimitedDelay(url, attempt)

        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 30000)  // 30 sec timeout

        try {
            const res = await fetch(url, {
                headers: randomHeaders,
                signal: controller.signal,
                next: { revalidate: 0 } // no-cache
            })
            clearTimeout(timeoutId)
            
            if (res.status === 429 || res.status === 403) {
                console.log(`[fetchHtml] HTTP ${res.status} for ${domain} - switching to Puppeteer...`)
                return await fetchHtml(url, true, attempt)  // Fallback to Puppeteer
            }

            if (!res.ok) {
                console.error(`[fetchHtml] HTTP error! status: ${res.status} for ${domain}`)
                throw new Error(`HTTP ${res.status}`)
            }
            
            const html = await res.text()

            // Fallback to Puppeteer if we hit a WAF/Captcha block in HTML
            if (html.includes("Pardon Our Interruption") || html.includes("Cloudflare") || html.includes("Incapsula") || html.includes("Just a moment")) {
                console.log(`[fetchHtml] WAF HTML block detected for ${domain}. Trying Puppeteer...`)
                return await fetchHtml(url, true, attempt)  // Fallback to Puppeteer
            }

            return html
        } catch (fetchError: any) {
            clearTimeout(timeoutId)
            
            // Timeout errors - try Puppeteer
            if (fetchError.name === "AbortError" || fetchError.message.includes("timeout")) {
                console.log(`[fetchHtml] Timeout for ${domain}. Trying Puppeteer...`)
                return await fetchHtml(url, true, attempt)  // Fallback to Puppeteer
            }
            
            throw fetchError
        }
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error)
        const isDomainError = errMsg.includes("ENOTFOUND") || errMsg.includes("getaddrinfo") || errMsg.includes("fetch failed")
        
        // For domain errors - still try Puppeteer once
        if (isDomainError && attempt === 0) {
            console.log(`[fetchHtml] Network error for ${domain}. Trying Puppeteer...`)
            try {
                return await fetchHtml(url, true, attempt)  // Fallback to Puppeteer
            } catch {
                // If Puppeteer also fails, throw original error
                throw error
            }
        }

        console.error(`[fetchHtml] Attempt ${attempt + 1} failed for ${domain}: ${errMsg}`)
        throw error
    }
}

/**
 * Determine store name from URL domain.
 */
export function getStoreName(url: string): string {
    try {
        const domain = new URL(url).hostname.toLowerCase()
        const storeMap: Record<string, string> = {
            rozetka: "Rozetka",
            "brain.com.ua": "Brain",
            "comfy.ua": "Comfy",
            pullandbear: "Pull & Bear",
            zakolot: "Zakolot",
        }

        for (const [key, name] of Object.entries(storeMap)) {
            if (domain.includes(key)) return name
        }

        // Return cleaned domain as fallback
        return domain.replace("www.", "")
    } catch {
        return ""
    }
}

/**
 * Convert USD to UAH using current approximate exchange rate.
 * For production, use real exchange rate API.
 */
export function convertUsdToUah(usdPrice: number): number {
    const exchangeRate = 40 // Approximate rate (update as needed)
    return Math.round(usdPrice * exchangeRate)
}
