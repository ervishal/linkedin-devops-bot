const puppeteer = require('puppeteer');

const JOB_TITLE = process.env.JOB_TITLE || 'DevOps';
const JOB_LOCATION = process.env.JOB_LOCATION || 'Remote';
const JOB_KEYWORDS = process.env.JOB_KEYWORDS || 'SRE, Cloud, Kubernetes';

function getMatchLevel(jobTitle, jobDesc, keywords) {
    const keywordArr = keywords.split(',').map(k => k.trim().toLowerCase());
    let score = 0;
    keywordArr.forEach(kw => {
        if (jobTitle.toLowerCase().includes(kw)) score += 2;
        if (jobDesc.toLowerCase().includes(kw)) score += 1;
    });
    if (score >= keywordArr.length * 2) return 'high';
    if (score >= keywordArr.length) return 'medium';
    return 'low';
}

(async () => {
    let browser;
    try {
        console.log('Launching browser in headless mode...');
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setJavaScriptEnabled(true);
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
        });
        console.log('Navigating to Naukri.com jobs page...');
        await page.goto('https://www.naukri.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
        await new Promise(res => setTimeout(res, 10000));
        // Scroll to bottom to trigger dynamic content
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await new Promise(res => setTimeout(res, 5000));
        let html = await page.content();
        await publishScreenshot(await page.screenshot({ encoding: 'base64' }));
        // Defensive: Check if page is access denied or bot detected
        if (html.toLowerCase().includes('access denied') || html.toLowerCase().includes('bot detected') || html.toLowerCase().includes('captcha')) {
            console.error('Access Denied or Bot Detected on Naukri.com. Please try running from a different region or use a proxy/VPN.');
            await browser.close();
            process.exit(1);
        }
        // Log raw HTML for debugging
        console.log('Raw HTML:', html);
        // Step 1: Try to find and click the cookie consent / "Got it" button if present
        let cookieButtonSelector = null;
        try {
            // Try to find the "Got it" button using a direct selector first
            cookieButtonSelector = await page.$('.acceptance-btn-text');
            if (cookieButtonSelector) {
                await page.click('.acceptance-btn-text');
                await new Promise(res => setTimeout(res, 3000));
                await publishScreenshot(await page.screenshot({ encoding: 'base64' }));
            } else {
                // Fallback to AI selector
                cookieButtonSelector = await findSelectorsUsingAI(html, 'Find the selector for the cookie consent or Got it button');
                if (cookieButtonSelector) {
                    await page.click(cookieButtonSelector);
                    await new Promise(res => setTimeout(res, 3000));
                    await publishScreenshot(await page.screenshot({ encoding: 'base64' }));
                }
            }
        } catch (e) {
            console.log('Error handling cookie consent:', e.message);
        }
        // Step 2: Get fresh HTML after popup
        html = await page.content();
        // Log fresh HTML for debugging
        console.log('Fresh HTML after cookie:', html);
        // Step 3: Try direct selectors for job search input, location input, and search button
        let jobInputSelector = null;
        let locationInputSelector = null;
        let searchButtonSelector = null;
        try {
            jobInputSelector = await page.$('.keywordSugg input.suggestor-input');
            locationInputSelector = await page.$('.locationSugg input.suggestor-input');
            searchButtonSelector = await page.$('.qsbSubmit');
        } catch (e) {
            console.log('Error finding direct selectors:', e.message);
        }
        // If direct selectors not found, fallback to AI selector
        if (!jobInputSelector) {
            try {
                jobInputSelector = await findSelectorsUsingAI(html, 'Find the selector for the job title/skills/designations input box');
            } catch (e) {
                console.log('Error finding job input selector:', e.message);
            }
        }
        if (!locationInputSelector) {
            try {
                locationInputSelector = await findSelectorsUsingAI(html, 'Find the selector for the location input box');
            } catch (e) {
                console.log('Error finding location input selector:', e.message);
            }
        }
        if (!searchButtonSelector) {
            try {
                searchButtonSelector = await findSelectorsUsingAI(html, 'Find the selector for the Search button');
            } catch (e) {
                console.log('Error finding search button selector:', e.message);
            }
        }
        // Log selectors for debugging
        console.log('Job Input Selector:', jobInputSelector);
        console.log('Location Input Selector:', locationInputSelector);
        console.log('Search Button Selector:', searchButtonSelector);
        // If selectors are Puppeteer element handles, use them directly
        if (jobInputSelector && locationInputSelector && searchButtonSelector) {
            await jobInputSelector.type(JOB_TITLE, { delay: 100 });
            await locationInputSelector.type(JOB_LOCATION, { delay: 100 });
            await searchButtonSelector.click();
            console.log('Submitted job search form. Waiting for results...');
            await new Promise(res => setTimeout(res, 10000));
            await publishScreenshot(await page.screenshot({ encoding: 'base64' }));
            const resultsHtml = await page.content();
            const simplifiedResultsHtml = await simplifyHtml(resultsHtml);
            console.log('Simplified Results HTML:', simplifiedResultsHtml);
            await browser.close();
            process.exit(2);
        } else {
            console.error('Failed to find one or more selectors. Logging HTML for debugging.');
            await browser.close();
            process.exit(2);
        }
    } catch (e) {
        if (browser) await browser.close();
        console.error(e);
        process.exit(1);
    }
})();
