const puppeteer = require('puppeteer');
const readline = require('readline');

const JOB_PORTALS = {
    'naukri': {
        url: 'https://www.naukri.com/',
        selectors: {
            jobInput: '.keywordSugg input.suggestor-input',
            locationInput: '.locationSugg input.suggestor-input',
            searchButton: '.qsbSubmit'
        }
    },
    'linkedin': {
        url: 'https://www.linkedin.com/jobs/',
        selectors: {
            jobInput: '.jobs-search-box__text-input[aria-label*="Search job titles"]',
            locationInput: '.jobs-search-box__text-input[aria-label*="City"]',
            searchButton: '.jobs-search-box__submit-button'
        }
    },
    'indeed': {
        url: 'https://www.indeed.com/',
        selectors: {
            jobInput: '#text-input-what',
            locationInput: '#text-input-where',
            searchButton: '[type="submit"]'
        }
    }
};

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function getUserInput() {
    console.log('\nAvailable Job Portals:');
    Object.keys(JOB_PORTALS).forEach(portal => console.log(`- ${portal}`));
    
    const portal = await askQuestion('\nWhich job portal would you like to search? ');
    const jobTitle = await askQuestion('Enter job title to search for: ');
    const location = await askQuestion('Enter location (or "Remote"): ');
    const keywords = await askQuestion('Enter keywords (comma-separated): ');
    
    rl.close();
    return { portal: portal.toLowerCase(), jobTitle, location, keywords };
}

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

async function searchJobs(portalName, portalConfig, jobTitle, location, keywords) {
    let browser;
    try {
        console.log(`\nLaunching browser for ${portalName}...`);
        browser = await puppeteer.launch({ 
            headless: true, 
            args: ['--no-sandbox', '--disable-setuid-sandbox'] 
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        
        console.log(`Navigating to ${portalName}...`);
        await page.goto(portalConfig.url, { waitUntil: 'networkidle2', timeout: 45000 });
        
        // Handle cookie consent if present
        try {
            await page.waitForSelector('[aria-label*="Accept cookies"]', { timeout: 5000 });
            await page.click('[aria-label*="Accept cookies"]');
        } catch (e) {
            // Cookie banner might not exist
        }

        // Fill in search form
        await page.waitForSelector(portalConfig.selectors.jobInput);
        await page.type(portalConfig.selectors.jobInput, jobTitle, { delay: 100 });
        await page.type(portalConfig.selectors.locationInput, location, { delay: 100 });
        await page.click(portalConfig.selectors.searchButton);

        console.log('Waiting for search results...');
        await page.waitForNavigation({ waitUntil: 'networkidle2' });
        
        // Take screenshot of results
        await page.screenshot({ path: `${portalName}-results.png` });
        console.log(`\nSearch results screenshot saved as ${portalName}-results.png`);

        await browser.close();
    } catch (e) {
        console.error(`Error searching on ${portalName}:`, e.message);
        if (browser) await browser.close();
    }
}

(async () => {
    try {
        const { portal, jobTitle, location, keywords } = await getUserInput();
        
        if (!JOB_PORTALS[portal]) {
            console.error('Invalid job portal selected.');
            process.exit(1);
        }

        await searchJobs(portal, JOB_PORTALS[portal], jobTitle, location, keywords);
        
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
