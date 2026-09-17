const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ARTIFACT_DIR = 'C:\\Users\\R Deepa Rathi\\.gemini\\antigravity-ide\\brain\\064c1a88-474a-464c-8f2f-8b3be34b71dd';

(async () => {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  const results = {};

  try {
    // 1. Landing Page
    console.log('Navigating to Landing page...');
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const landingPath = path.join(ARTIFACT_DIR, 'page_landing.png');
    await page.screenshot({ path: landingPath, fullPage: true });
    results.landing = { title: await page.title(), url: page.url(), screenshot: landingPath };

    // 2. Admin Login
    console.log('Navigating to Admin Login...');
    await page.goto('http://localhost:5173/admin-login', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const adminLoginPath = path.join(ARTIFACT_DIR, 'page_admin_login.png');
    await page.screenshot({ path: adminLoginPath });
    
    // Fill credentials and login
    console.log('Submitting Admin Login...');
    await page.fill('input[name="username"], input[type="text"]', 'admin');
    await page.fill('input[name="password"], input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);

    // 3. Admin Dashboard
    console.log('Capturing Admin Dashboard...');
    await page.waitForURL('**/admin-dashboard', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const adminDashPath = path.join(ARTIFACT_DIR, 'page_admin_dashboard.png');
    await page.screenshot({ path: adminDashPath, fullPage: true });
    results.adminDashboard = { title: await page.title(), url: page.url(), screenshot: adminDashPath };

    // 4. AI Agent Page
    console.log('Navigating to AI Agent...');
    await page.goto('http://localhost:5173/ai-agent', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const aiAgentPath = path.join(ARTIFACT_DIR, 'page_ai_agent.png');
    await page.screenshot({ path: aiAgentPath, fullPage: true });
    results.aiAgent = { title: await page.title(), url: page.url(), screenshot: aiAgentPath };

    // 5. Route Management
    console.log('Navigating to Route Management...');
    await page.goto('http://localhost:5173/routes', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const routesPath = path.join(ARTIFACT_DIR, 'page_routes.png');
    await page.screenshot({ path: routesPath, fullPage: true });
    results.routes = { title: await page.title(), url: page.url(), screenshot: routesPath };

    // 6. User Management
    console.log('Navigating to User Management...');
    await page.goto('http://localhost:5173/users', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const usersPath = path.join(ARTIFACT_DIR, 'page_users.png');
    await page.screenshot({ path: usersPath, fullPage: true });
    results.users = { title: await page.title(), url: page.url(), screenshot: usersPath };

    // 7. Vehicle Management
    console.log('Navigating to Vehicle Management...');
    await page.goto('http://localhost:5173/vehicles', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const vehiclesPath = path.join(ARTIFACT_DIR, 'page_vehicles.png');
    await page.screenshot({ path: vehiclesPath, fullPage: true });
    results.vehicles = { title: await page.title(), url: page.url(), screenshot: vehiclesPath };

    // 8. Schedule Management
    console.log('Navigating to Schedule Management...');
    await page.goto('http://localhost:5173/schedule', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const schedulePath = path.join(ARTIFACT_DIR, 'page_schedule.png');
    await page.screenshot({ path: schedulePath, fullPage: true });
    results.schedule = { title: await page.title(), url: page.url(), screenshot: schedulePath };

    // 9. Student Login & Dashboard
    console.log('Navigating to Student Login...');
    await page.goto('http://localhost:5173/student-login', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const studentLoginPath = path.join(ARTIFACT_DIR, 'page_student_login.png');
    await page.screenshot({ path: studentLoginPath });
    results.studentLogin = { title: await page.title(), url: page.url(), screenshot: studentLoginPath };

    console.log('Capture complete:', JSON.stringify(results, null, 2));
  } catch (err) {
    console.error('Error during capture:', err);
  } finally {
    await browser.close();
  }
})();
