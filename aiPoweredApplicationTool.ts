const puppeteer = require('puppeteer');
const OpenAI = require('openai');
const { Octokit } = require('@octokit/rest');
const fs = require('fs');

const LINKEDIN_EMAIL = process.env.LINKEDIN_EMAIL;
const LINKEDIN_PASSWORD = process.env.LINKEDIN_PASSWORD;
const JOB_TITLE = process.env.JOB_TITLE || 'DevOps';
const JOB_LOCATION = process.env.JOB_LOCATION || 'Remote';
const JOB_KEYWORDS = process.env.JOB_KEYWORDS || 'SRE, Cloud, Kubernetes';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

async function main() {
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const octokit = new Octokit({ auth: GITHUB_TOKEN });
    let browser;
    try {
        console.log('Launching browser...');
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setJavaScriptEnabled(true);
        console.log('Navigating to LinkedIn login...');
        await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 45000 });
        await publishScreenshot(await page.screenshot({ encoding: 'base64' }));
        await page.type('#username', LINKEDIN_EMAIL);
        await page.type('#password', LINKEDIN_PASSWORD);
        await page.click('button[type="submit"]');
        await new Promise(res => setTimeout(res, 15000));
        await publishScreenshot(await page.screenshot({ encoding: 'base64' }));
        // Log HTML for debugging
        const htmlAfterLogin = await page.content();
        const simplifiedHtml = await simplifyHtml(htmlAfterLogin);
        console.log('Simplified HTML after login:', simplifiedHtml);
        // The following code is now enabled
        console.log('Logged in. Navigating to jobs page...');
        await page.goto('https://www.linkedin.com/jobs', { waitUntil: 'domcontentloaded', timeout: 45000 });
        await publishScreenshot(await page.screenshot({ encoding: 'base64' }));
        let html = await page.content();
        let searchBoxSelector = await findSelectorsUsingAI(html, 'Find the selector for the job search input field');
        let locationBoxSelector = await findSelectorsUsingAI(html, 'Find the selector for the location input field');
        let searchButtonSelector = await findSelectorsUsingAI(html, 'Find the selector for the search button');
        await page.type(searchBoxSelector, JOB_TITLE);
        await page.type(locationBoxSelector, JOB_LOCATION);
        await page.click(searchButtonSelector);
        await new Promise(res => setTimeout(res, 15000));
        await publishScreenshot(await page.screenshot({ encoding: 'base64' }));
        html = await page.content();
        let jobCardSelector = await findSelectorsUsingAI(html, 'Find the selector for job cards in the search results');
        let jobCards = await page.$$(jobCardSelector);
        let appliedJobs = [];
        for (let i = 0; i < jobCards.length; i++) {
            console.log(`Processing job ${i + 1} of ${jobCards.length}`);
            await jobCards[i].click();
            await new Promise(res => setTimeout(res, 5000));
            html = await page.content();
            let jobTitleSelector = await findSelectorsUsingAI(html, 'Find the selector for the job title');
            let jobDescSelector = await findSelectorsUsingAI(html, 'Find the selector for the job description');
            let easyApplySelector = await findSelectorsUsingAI(html, 'Find the selector for the Easy Apply button');
            let jobTitle = await page.$eval(jobTitleSelector, el => el.innerText);
            let jobDesc = await page.$eval(jobDescSelector, el => el.innerText);
            // Use OpenAI to match job description to resume
            let resumeText = fs.readFileSync('resume.txt', 'utf8');
            let prompt = `Does the following job description match this resume?\nJob Description: ${jobDesc}\nResume: ${resumeText}\nRespond with Yes or No and a short reason.`;
            let matchResp = await openai.chat.completions.create({
                messages: [{ role: 'user', content: prompt }],
                model: 'gpt-3.5-turbo',
            });
            let matchResult = matchResp.choices[0].message.content;
            if (matchResult.includes('Yes')) {
                // Optionally generate cover letter
                let coverPrompt = `Write a short cover letter for the following job based on this resume.\nJob Title: ${jobTitle}\nJob Description: ${jobDesc}\nResume: ${resumeText}`;
                let coverResp = await openai.chat.completions.create({
                    messages: [{ role: 'user', content: coverPrompt }],
                    model: 'gpt-3.5-turbo',
                });
                let coverLetter = coverResp.choices[0].message.content;
                // Click Easy Apply
                await page.click(easyApplySelector);
                await new Promise(res => setTimeout(res, 5000));
                // Fill application form (simplified)
                // ... (form filling logic can be added here)
                // Submit application
                let submitSelector = await findSelectorsUsingAI(html, 'Find the selector for the submit application button');
                await page.click(submitSelector);
                await new Promise(res => setTimeout(res, 5000));
                appliedJobs.push({ jobTitle, jobDesc, coverLetter });
                console.log(`Applied to: ${jobTitle}`);
            } else {
                console.log(`Skipped: ${jobTitle} - Not a match.`);
            }
        }
        // Log applications and push to GitHub
        fs.writeFileSync('applied_jobs.json', JSON.stringify(appliedJobs, null, 2));
        // Push to GitHub
        const content = Buffer.from(JSON.stringify(appliedJobs, null, 2)).toString('base64');
        await octokit.repos.createOrUpdateFileContents({
            owner: GITHUB_REPO.split('/')[0],
            repo: GITHUB_REPO.split('/')[1],
            path: 'applied_jobs.json',
            message: 'Update applied jobs log',
            content,
            branch: GITHUB_BRANCH,
            committer: {
                name: 'Turbotic Bot',
                email: 'bot@turbotic.com',
            },
            author: {
                name: 'Turbotic Bot',
                email: 'bot@turbotic.com',
            },
        });
        console.log('Applied jobs log pushed to GitHub.');
        await browser.close();
    } catch (e) {
        if (browser) await browser.close();
        console.error(e);
        process.exit(1);
    }
}

main();
