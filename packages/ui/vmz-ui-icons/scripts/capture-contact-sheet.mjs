#!/usr/bin/env node
/**
 * Capture a full-page screenshot of the contact sheet at an exact CSS viewport width.
 *
 * Usage:
 *   node packages/ui/vmz-ui-icons/scripts/capture-contact-sheet.mjs <sheet.html> <output.png> [width]
 *
 * The script drives a headless Chrome over the DevTools protocol, because `--window-size`
 * on Windows headless Chrome refuses to go below the minimum browser window width and
 * silently yields a wider layout than the requested mobile viewport. `Emulation.setDeviceMetricsOverride`
 * keeps the layout viewport exact, then the screenshot is taken at twice the CSS density so
 * stroke joins and small ladder sizes can be inspected without blur.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [htmlArgument, outputArgument, widthArgument = '390'] = process.argv.slice(2);
if (!htmlArgument || !outputArgument) {
    console.error('usage: capture-contact-sheet.mjs <sheet.html> <output.png> [width]');
    process.exit(1);
}

const viewportWidth = Number(widthArgument);
const deviceScaleFactor = 2;
const chromePath =
    process.env.CHROME_PATH ?? path.join(process.env.ProgramFiles ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe');
const htmlPath = path.resolve(htmlArgument);
const outputPath = path.resolve(outputArgument);
const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-icons-capture-'));

const chrome = spawn(
    chromePath,
    [
        '--headless=new',
        '--remote-debugging-port=0',
        `--user-data-dir=${profileDirectory}`,
        '--no-first-run',
        '--disable-extensions',
        '--hide-scrollbars',
        'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true },
);

const portFile = path.join(profileDirectory, 'DevToolsActivePort');

async function waitForPortFile() {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        if (fs.existsSync(portFile)) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Chrome did not expose a DevTools port at ${portFile}`);
}

await waitForPortFile();
const [port] = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const pageTarget = targets.find((target) => target.type === 'page');
if (!pageTarget) throw new Error('no page target available');

const socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
});

let messageId = 0;
const pending = new Map();

socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
        const settle = pending.get(message.id);
        pending.delete(message.id);
        settle(message);
    }
});

function send(method, parameters = {}) {
    return new Promise((resolve, reject) => {
        const id = ++messageId;
        pending.set(id, (message) => {
            if (message.error) reject(new Error(`${method}: ${message.error.message}`));
            else resolve(message.result ?? {});
        });
        socket.send(JSON.stringify({ id, method, params: parameters }));
    });
}

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
    width: viewportWidth,
    height: 900,
    deviceScaleFactor,
    mobile: viewportWidth <= 560,
});
await send('Page.navigate', { url: pathToFileURL(htmlPath).href });
await new Promise((resolve) => setTimeout(resolve, 600));

const metrics = await send('Page.getLayoutMetrics');
const contentHeight = Math.ceil(metrics.cssContentSize.height);
await send('Emulation.setDeviceMetricsOverride', {
    width: viewportWidth,
    height: contentHeight,
    deviceScaleFactor,
    mobile: viewportWidth <= 560,
});
await new Promise((resolve) => setTimeout(resolve, 200));

const screenshot = await send('Page.captureScreenshot', { format: 'png' });
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, Buffer.from(screenshot.data, 'base64'));
const publishedWidth = await send('Runtime.evaluate', {
    expression: 'document.documentElement.scrollWidth + "x" + document.documentElement.clientWidth',
    returnByValue: true,
});
console.log(
    `${outputPath} ${viewportWidth}×${contentHeight} css (${viewportWidth * deviceScaleFactor}×${contentHeight * deviceScaleFactor} px), scroll ${publishedWidth.result.value}`,
);

socket.close();
chrome.kill();
